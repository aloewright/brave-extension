/**
 * Shared install/uninstall helpers for the Brave Dev Extension native host.
 *
 * Pure functions (mergeMcpEntry, removeMcpEntry, addRcBlock, removeRcBlock,
 * buildClaudeEntry, buildWrapperScript) have no side effects and are unit
 * tested. The fs-touching helpers (writeWrapper, applyRcBlock, etc.) call
 * the pure helpers and then read/write files idempotently.
 *
 * Idempotency contract:
 *   - Running install N times converges to the same final state.
 *   - Running uninstall after install removes only what install added.
 *   - Toggling terminal-path on/off is a clean round-trip.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from "fs"
import { homedir } from "os"
import { join, dirname, resolve as resolvePath } from "path"
import { randomBytes } from "crypto"
import { spawnSync as defaultSpawnSync } from "child_process"

export const HOST_NAME = "com.aidev.sidebar"
export const MCP_SERVER_ID = "ai-dev-sidebar"
export const RC_MARKER_BEGIN = "# >>> ai-dev-sidebar terminal path >>>"
export const RC_MARKER_END = "# <<< ai-dev-sidebar terminal path <<<"

export function configDir(home = homedir()) {
  return join(home, ".config", "ai-dev-sidebar")
}
export function tokenPath(home = homedir()) {
  return join(configDir(home), "mcp-token")
}
export function envPath(home = homedir()) {
  return join(configDir(home), "env")
}
export function wrapperPath(home = homedir()) {
  return join(configDir(home), "claude")
}
export function resolveClaudeConfigPath(configPath = "~/.claude.json", home = homedir()) {
  const raw = typeof configPath === "string" && configPath.trim()
    ? configPath.trim()
    : "~/.claude.json"
  if (raw === "~") return home
  if (raw.startsWith("~/")) return join(home, raw.slice(2))
  return raw
}
export function claudeJsonPath(home = homedir(), configPath = "~/.claude.json") {
  return resolveClaudeConfigPath(configPath, home)
}

// ── ~/.claude.json merge helpers (pure) ──────────────────────────────────

/**
 * Build the canonical claude.json entry for our MCP server. The
 * `${AI_DEV_MCP_TOKEN}` placeholder is intentional — Claude Code expands env
 * refs in `headers` at connect time, so the token never lands in plaintext.
 */
export function buildClaudeEntry(port) {
  return {
    type: "sse",
    url: `http://127.0.0.1:${port}/sse`,
    headers: { Authorization: "Bearer ${AI_DEV_MCP_TOKEN}" }
  }
}

/**
 * Merge our entry into an existing parsed ~/.claude.json object, preserving
 * all sibling mcpServers and top-level keys. Returns a new object.
 */
export function mergeMcpEntry(existing, ourEntry, id = MCP_SERVER_ID) {
  const cfg = existing && typeof existing === "object" ? { ...existing } : {}
  cfg.mcpServers = { ...(cfg.mcpServers || {}) }
  cfg.mcpServers[id] = ourEntry
  return cfg
}

/**
 * Remove our entry from a parsed ~/.claude.json object, leaving siblings
 * untouched. If mcpServers ends up empty, drop it. Returns a new object.
 */
export function removeMcpEntry(existing, id = MCP_SERVER_ID) {
  if (!existing || typeof existing !== "object") return {}
  const cfg = { ...existing }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== "object") return cfg
  const next = { ...cfg.mcpServers }
  delete next[id]
  if (Object.keys(next).length === 0) {
    delete cfg.mcpServers
  } else {
    cfg.mcpServers = next
  }
  return cfg
}

// ── Shell rc block helpers (pure) ─────────────────────────────────────────

/**
 * The marker-guarded block content (without trailing newline).
 * Always identical so re-running install produces no diff.
 */
export function rcBlock(home = "$HOME") {
  return [
    RC_MARKER_BEGIN,
    `export PATH="${home}/.config/ai-dev-sidebar:$PATH"`,
    RC_MARKER_END
  ].join("\n")
}

/**
 * Add the marker-guarded block to file content if not already present.
 * Idempotent — running twice yields identical content.
 */
export function addRcBlock(content) {
  const block = rcBlock()
  if (content.includes(RC_MARKER_BEGIN) && content.includes(RC_MARKER_END)) {
    // Replace existing block (in case content drifted) with canonical.
    return replaceBlock(content, block)
  }
  // Ensure separation from prior content.
  const sep = content.length === 0 || content.endsWith("\n\n")
    ? ""
    : content.endsWith("\n") ? "\n" : "\n\n"
  return `${content}${sep}${block}\n`
}

/**
 * Remove the marker-guarded block (and its trailing newline) from content.
 * Untouched if no markers present.
 */
export function removeRcBlock(content) {
  if (!content.includes(RC_MARKER_BEGIN) || !content.includes(RC_MARKER_END)) {
    return content
  }
  const start = content.indexOf(RC_MARKER_BEGIN)
  const endMarker = content.indexOf(RC_MARKER_END, start)
  if (start === -1 || endMarker === -1) return content
  // Cut from the start of the begin-marker line to the end of the end-marker
  // line plus the trailing newline (if any). Also collapse the gap so we
  // don't accumulate blank lines on repeated toggles.
  let blockStart = start
  // Walk back to start-of-line (don't eat preceding content).
  while (blockStart > 0 && content[blockStart - 1] === "\n") blockStart--
  const endLineEnd = content.indexOf("\n", endMarker)
  const blockEnd = endLineEnd === -1 ? content.length : endLineEnd + 1
  // Preserve a single newline between surrounding chunks.
  const before = content.slice(0, blockStart).replace(/\n+$/, "")
  const after = content.slice(blockEnd).replace(/^\n+/, "")
  if (!before) return after
  if (!after) return before + "\n"
  return `${before}\n${after}`
}

function replaceBlock(content, block) {
  const start = content.indexOf(RC_MARKER_BEGIN)
  const endMarker = content.indexOf(RC_MARKER_END, start)
  if (start === -1 || endMarker === -1) return content
  const endLineEnd = content.indexOf("\n", endMarker)
  const tail = endLineEnd === -1 ? "" : content.slice(endLineEnd)
  return `${content.slice(0, start)}${block}${tail}`
}

// ── Wrapper script (pure) ─────────────────────────────────────────────────

/**
 * The `claude` wrapper script that lives in ~/.config/ai-dev-sidebar.
 *
 * Cycle-prevention: we strip our own dir out of PATH before exec'ing claude,
 * so even if the user's PATH still has us in front, the inner lookup finds
 * the real claude binary instead of recursing into this wrapper.
 */
export function buildWrapperScript() {
  return `#!/usr/bin/env bash
# ai-dev-sidebar terminal wrapper
# Sources the env file (so AI_DEV_MCP_TOKEN/URL are present), then exec's the
# real \`claude\` binary. Cycle-prevention: drop our own dir from PATH before
# the lookup so the wrapper can't invoke itself.
set -e
ENV_FILE="$HOME/.config/ai-dev-sidebar/env"
if [ -f "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi
OUR_DIR="$HOME/.config/ai-dev-sidebar"
# POSIX-portable PATH filter: split on :, drop our dir, rejoin.
NEW_PATH=""
IFS=':'
for p in $PATH; do
  [ "$p" = "$OUR_DIR" ] && continue
  [ -z "$p" ] && continue
  NEW_PATH="\${NEW_PATH:+$NEW_PATH:}$p"
done
unset IFS
PATH="$NEW_PATH"
exec /usr/bin/env claude "$@"
`
}

// ── File-system helpers (side-effecting, idempotent) ─────────────────────

export function ensureDir(p) {
  mkdirSync(p, { recursive: true })
}

export function writeWrapper(home = homedir()) {
  ensureDir(configDir(home))
  const path = wrapperPath(home)
  const next = buildWrapperScript()
  if (existsSync(path)) {
    try {
      const cur = readFileSync(path, "utf-8")
      if (cur === next) {
        chmodSync(path, 0o755)
        return { path, changed: false }
      }
    } catch {}
  }
  writeFileSync(path, next, { mode: 0o755 })
  chmodSync(path, 0o755)
  return { path, changed: true }
}

export function removeWrapper(home = homedir()) {
  const path = wrapperPath(home)
  if (existsSync(path)) {
    try { unlinkSync(path) } catch {}
    return { path, changed: true }
  }
  return { path, changed: false }
}

export function applyRcBlock(rcFile, enable) {
  let cur = ""
  if (existsSync(rcFile)) {
    try { cur = readFileSync(rcFile, "utf-8") } catch { cur = "" }
  } else if (!enable) {
    return { path: rcFile, changed: false }
  }
  const next = enable ? addRcBlock(cur) : removeRcBlock(cur)
  if (next === cur) return { path: rcFile, changed: false }
  ensureDir(dirname(rcFile))
  writeFileSync(rcFile, next)
  return { path: rcFile, changed: true }
}

export function shellRcFiles(home = homedir()) {
  return [join(home, ".zshrc"), join(home, ".bashrc")]
}

/**
 * Toggle the terminal-path block + wrapper. Idempotent.
 */
export function setTerminalPath(enabled, home = homedir()) {
  const results = []
  for (const rc of shellRcFiles(home)) {
    results.push(applyRcBlock(rc, enabled))
  }
  if (enabled) {
    results.push(writeWrapper(home))
  } else {
    results.push(removeWrapper(home))
  }
  return results
}

export function hasTerminalPath(home = homedir()) {
  let rcBlock = false
  for (const rc of shellRcFiles(home)) {
    if (!existsSync(rc)) continue
    try {
      const c = readFileSync(rc, "utf-8")
      if (c.includes(RC_MARKER_BEGIN) && c.includes(RC_MARKER_END)) {
        rcBlock = true
        break
      }
    } catch {}
  }
  return { hasRcBlock: rcBlock, hasWrapper: existsSync(wrapperPath(home)) }
}

// ── ~/.claude.json read-modify-write ─────────────────────────────────────

export function readClaudeJson(home = homedir(), configPath = "~/.claude.json") {
  const path = claudeJsonPath(home, configPath)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

export function writeClaudeJson(cfg, home = homedir(), configPath = "~/.claude.json") {
  const path = claudeJsonPath(home, configPath)
  ensureDir(dirname(path))
  writeFileSync(path, JSON.stringify(cfg, null, 2))
}

export function registerClaudeJson(port, home = homedir(), configPath = "~/.claude.json") {
  const cur = readClaudeJson(home, configPath) || {}
  const next = mergeMcpEntry(cur, buildClaudeEntry(port))
  writeClaudeJson(next, home, configPath)
  return next
}

export function unregisterClaudeJson(home = homedir(), configPath = "~/.claude.json") {
  const cur = readClaudeJson(home, configPath)
  if (!cur) return null
  const next = removeMcpEntry(cur)
  writeClaudeJson(next, home, configPath)
  return next
}

export function isRegistered(home = homedir(), configPath = "~/.claude.json") {
  const cur = readClaudeJson(home, configPath)
  return !!(cur && cur.mcpServers && cur.mcpServers[MCP_SERVER_ID])
}

// ── Token + env file ─────────────────────────────────────────────────────

export function generateToken() {
  return randomBytes(32).toString("hex")
}

export function writeTokenAndEnv(token, port, home = homedir()) {
  ensureDir(configDir(home))
  writeFileSync(tokenPath(home), token, { mode: 0o600 })
  try { chmodSync(tokenPath(home), 0o600) } catch {}
  writeFileSync(
    envPath(home),
    `AI_DEV_MCP_URL=http://127.0.0.1:${port}\nAI_DEV_MCP_TOKEN=${token}\n`,
    { mode: 0o600 }
  )
  try { chmodSync(envPath(home), 0o600) } catch {}
}

export function removeTokenAndEnv(home = homedir()) {
  for (const p of [tokenPath(home), envPath(home)]) {
    if (existsSync(p)) {
      try { unlinkSync(p) } catch {}
    }
  }
}

// ── macOS Gatekeeper / quarantine remediation (ALO-472) ──────────────────
//
// node-pty ships ad-hoc-signed `.node` and `spawn-helper` Mach-O bundles
// (no Developer ID). When pnpm extracts them from a downloaded tarball, the
// files can inherit the `com.apple.quarantine` xattr. Gatekeeper then
// shows "Apple could not verify '<random>.node' is free of malware…" the
// first time the dlopen happens — the popup blocks the user's first
// terminal session. The transient hash-prefixed filename in the popup is
// XProtect's internal scan-cache name; the actual file on disk is
// `prebuilds/darwin-{arm64,x64}/pty.node`.
//
// Fix: strip `com.apple.quarantine` from every Mach-O artifact the
// native-host depends on at install time. Idempotent — re-running converges.

/**
 * Names we always treat as native artifacts even without an extension. Add
 * here if a future dependency ships a binary helper with an unusual name.
 */
const NATIVE_HELPER_NAMES = new Set([
  "spawn-helper",
  // esbuild ships platform `@esbuild/darwin-*` Mach-O bins without a `.node` suffix.
  "esbuild",
  // chokidar/vitest optional dep — Gatekeeper popup names the file "fsevents.node".
  "fsevents.node",
  // SwiftPM helper invoked when the native host runs foundation-models-bridge.swift.
  "swift-manifest"
])

function isLikelyNativeFile(path) {
  if (path.endsWith(".node")) return true
  const base = path.split("/").pop() || ""
  return NATIVE_HELPER_NAMES.has(base)
}

/** pnpm package folder names for non-macOS optional native deps. */
function shouldSkipNativeDir(name, platform) {
  if (platform !== "darwin") return false
  if (/^@esbuild\+(?!darwin-)/.test(name)) return true
  if (/^@rollup\+rollup-(?!darwin-)/.test(name)) return true
  if (/^@swc\+core-(?!darwin-)/.test(name)) return true
  if (/^lightningcss-(?!darwin-)/.test(name)) return true
  return [
    "win32-arm64", "win32-x64", "win32-ia32",
    "linux-arm64", "linux-arm", "linux-x64", "linux-ia32", "linux-loong64",
    "linux-mips64el", "linux-ppc64", "linux-riscv64", "linux-s390x",
    "android-arm64", "android-arm", "android-x64",
    "freebsd-arm64", "freebsd-x64", "openbsd-arm64", "openbsd-x64",
    "openharmony-arm64", "sunos-x64", "aix-ppc64", "netbsd-arm64", "netbsd-x64"
  ].includes(name)
}

/** On macOS, skip optional native deps for other OSes (esbuild, rollup, …). */
export function isRelevantNativeArtifact(path, platform = process.platform) {
  if (platform !== "darwin") return true
  const lower = path.toLowerCase()
  if (lower.endsWith("/esbuild")) return lower.includes("darwin")
  if (lower.endsWith(".node")) {
    if (/\/prebuilds\/(win32|linux|freebsd|android|openbsd|sunos|aix|netbsd|openharmony)-/.test(lower)) {
      return false
    }
    if (/@esbuild\//.test(lower) && !/darwin/.test(lower)) return false
    if (/@rollup\/rollup-/.test(lower) && !/darwin/.test(lower)) return false
    if (/@swc\/core-/.test(lower) && !/darwin/.test(lower)) return false
    if (/lightningcss-/.test(lower) && !/darwin/.test(lower)) return false
  }
  return true
}

/**
 * Walk a tree and return every `.node` file plus known helper binaries.
 * Skips `node_modules/.bin` symlinks and any non-existent path.
 *
 * Exported for unit tests — pure modulo the filesystem.
 */
export function findNativeArtifacts(root, options = {}) {
  if (!existsSync(root)) return []
  const platform = options.platform ?? process.platform
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = join(dir, ent.name)
      // Skip pnpm's symlink farm so we don't walk the same tree twice.
      if (ent.isSymbolicLink()) continue
      if (ent.isDirectory()) {
        if (ent.name === ".bin") continue
        if (shouldSkipNativeDir(ent.name, platform)) continue
        stack.push(full)
      } else if (ent.isFile() && isLikelyNativeFile(full) && isRelevantNativeArtifact(full, platform)) {
        out.push(full)
      }
    }
  }
  return out.sort()
}

/**
 * Find files with exact basenames under `root` (used for swift-manifest in caches).
 */
export function findNamedBinariesUnder(root, names, options = {}) {
  if (!existsSync(root)) return []
  const want = new Set(names)
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.isSymbolicLink()) continue
      if (ent.isDirectory()) {
        stack.push(full)
      } else if (ent.isFile() && want.has(ent.name)) {
        out.push(full)
      }
    }
  }
  return out.sort()
}

/**
 * SwiftPM / `swift` script host binaries that live outside node_modules.
 * Gatekeeper often names `swift-manifest` when Foundation Models bridge runs.
 */
export function findSwiftToolchainArtifacts(options = {}) {
  if ((options.platform ?? process.platform) !== "darwin") return []
  const spawn = options.spawnSync ?? defaultSpawnSync
  const home = options.home ?? homedir()
  const repoRoot = options.repoRoot
  const nativeHostDir =
    options.nativeHostDir ?? (repoRoot ? join(repoRoot, "native-host") : null)
  const out = new Set()
  const add = (p) => {
    if (!p) return
    const resolved = resolvePath(p)
    if (existsSync(resolved)) out.add(resolved)
  }

  const xcr = spawn("xcrun", ["-f", "swift-manifest"], { encoding: "utf8" })
  if (xcr.status === 0 && typeof xcr.stdout === "string") {
    add(xcr.stdout.trim())
  }

  const which = spawn("which", ["swift"], { encoding: "utf8" })
  if (which.status === 0 && typeof which.stdout === "string") {
    const swiftBin = which.stdout.trim()
    const binDir = dirname(swiftBin)
    add(join(binDir, "swift-manifest"))
    add(join(binDir, "..", "libexec", "swift", "pm", "swift-manifest"))
    add(join(binDir, "..", "lib", "swift", "pm", "swift-manifest"))
    add(join(binDir, "..", "libexec", "swiftpm", "swift-manifest"))
  }

  for (const p of [
    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-manifest",
    "/Library/Developer/CommandLineTools/usr/bin/swift-manifest"
  ]) {
    add(p)
  }

  if (nativeHostDir) {
    for (const sub of [".build", ".swiftpm"]) {
      for (const p of findNamedBinariesUnder(join(nativeHostDir, sub), ["swift-manifest"], options)) {
        out.add(p)
      }
    }
  }

  for (const cache of [
    join(home, "Library", "Caches", "org.swift.swiftpm"),
    join(home, "Library", "Caches", "swift-build")
  ]) {
    for (const p of findNamedBinariesUnder(cache, ["swift-manifest"], options)) {
      out.add(p)
    }
  }

  return [...out].sort()
}

/**
 * Strip `com.apple.quarantine` from explicit paths. Injectable spawn for tests.
 */
export function scrubQuarantinePaths(paths, options = {}) {
  if ((options.platform ?? process.platform) !== "darwin") {
    return { scrubbed: [], errors: [] }
  }
  const spawn = options.spawnSync ?? defaultSpawnSync
  const scrubbed = []
  const errors = []
  for (const path of paths) {
    const res = spawn("xattr", ["-d", "com.apple.quarantine", path], {
      stdio: "ignore"
    })
    if (res.error) {
      errors.push({ path, message: res.error.message })
      continue
    }
    scrubbed.push(path)
    const base = path.split("/").pop()
    if (base === "spawn-helper") {
      try { chmodSync(path, 0o755) } catch { /* best effort */ }
    }
  }
  return { scrubbed, errors }
}

/**
 * Strip `com.apple.quarantine` from every native artifact found under
 * `root`. On non-darwin platforms this is a no-op so callers don't need
 * to platform-gate at the call site.
 */
export function scrubQuarantine(root, options = {}) {
  if ((options.platform ?? process.platform) !== "darwin") {
    return { scrubbed: [], errors: [] }
  }
  return scrubQuarantinePaths(findNativeArtifacts(root, options), options)
}

/** Scrub `swift-manifest` and other Swift toolchain Mach-O helpers. */
export function scrubSwiftToolchain(options = {}) {
  return scrubQuarantinePaths(findSwiftToolchainArtifacts(options), options)
}

/**
 * node-pty `pty.node` + `spawn-helper` for the current platform/arch.
 * Gatekeeper popups often show XProtect's scan-cache name
 * (e.g. `.99bfbbed9bcd5adb-00000000.node`) but the file on disk is
 * `prebuilds/darwin-{arm64,x64}/pty.node`.
 */
export function resolveNodePtyNativePaths(nativeHostDir, options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  if (platform !== "darwin") return []
  const nm = join(nativeHostDir, "node_modules")
  if (!existsSync(nm)) return []
  const needle = `/prebuilds/${platform}-${arch}/`
  return findNativeArtifacts(nm, { platform }).filter(
    (p) => p.includes("/node-pty/") && p.includes(needle)
  )
}

/** Run `spctl --assess` for a Mach-O executable. */
export function assessNativeExecutable(path, options = {}) {
  if ((options.platform ?? process.platform) !== "darwin") {
    return { path, status: "skipped", detail: "non-darwin" }
  }
  if (!existsSync(path)) {
    return { path, status: "missing", detail: "file not found" }
  }
  const spawn = options.spawnSync ?? defaultSpawnSync
  const res = spawn("spctl", ["-a", "-vv", "-t", "execute", path], {
    encoding: "utf8"
  })
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim()
  if (res.status === 0) {
    return { path, status: "allowed", detail: out || "accepted" }
  }
  if (/rejected/i.test(out)) {
    return { path, status: "rejected", detail: out }
  }
  return { path, status: "unknown", detail: out || `spctl exit ${res.status}` }
}

/**
 * Scrub quarantine on node-pty Mach-O helpers and return Gatekeeper assessment.
 * Quarantine removal alone does not satisfy Gatekeeper for linker-signed
 * prebuilds — the user must approve once via the dialog or Allow Anyway.
 */
export function prepareNodePtyForGatekeeper(nativeHostDir, options = {}) {
  const paths = resolveNodePtyNativePaths(nativeHostDir, options)
  const scrub = scrubQuarantinePaths(paths, options)
  const assessments = paths.map((p) => assessNativeExecutable(p, options))
  return { paths, scrub, assessments }
}

export const NODE_PTY_GATEKEEPER_HINT =
  "If macOS shows '.<hex>-00000000.node Not Opened', that is node-pty's pty.node " +
  "during XProtect scan. Click Open (not Cancel), or use System Settings → " +
  "Privacy & Security → Allow Anyway once per node-pty version."

/**
 * Default `node_modules` trees in this monorepo that may ship Mach-O addons
 * (node-pty, esbuild, rollup, fsevents, @swc/core, lightningcss, …).
 */
export function repoNodeModuleRoots(repoRoot) {
  return [
    join(repoRoot, "node_modules"),
    join(repoRoot, "native-host", "node_modules"),
    join(repoRoot, "worker", "node_modules")
  ].filter((p) => existsSync(p))
}

/** Scrub quarantine across every repo `node_modules` tree. Idempotent. */
export function scrubQuarantineAll(repoRoot, options = {}) {
  const roots = options.roots ?? repoNodeModuleRoots(repoRoot)
  const scrubbed = []
  const errors = []
  for (const root of roots) {
    const result = scrubQuarantine(root, options)
    scrubbed.push(...result.scrubbed)
    errors.push(...result.errors)
  }
  const swift = scrubSwiftToolchain({
    ...options,
    repoRoot,
    nativeHostDir: join(repoRoot, "native-host")
  })
  scrubbed.push(...swift.scrubbed)
  errors.push(...swift.errors)
  return { scrubbed, errors, roots }
}

/**
 * Inspect a single native artifact and return a diagnostic record. Used by
 * `scripts/diagnose-native-host.mjs`. spawn is injectable for tests.
 */
export function inspectNativeArtifact(path, options = {}) {
  const spawn = options.spawnSync ?? defaultSpawnSync
  const exists = existsSync(path)
  if (!exists) return { path, exists: false }
  let sizeBytes = 0
  try { sizeBytes = statSync(path).size } catch { /* leave 0 */ }
  let xattrs = []
  if ((options.platform ?? process.platform) === "darwin") {
    const xr = spawn("xattr", [path], { encoding: "utf8" })
    if (xr.status === 0 && typeof xr.stdout === "string") {
      xattrs = xr.stdout.split("\n").map((s) => s.trim()).filter(Boolean)
    }
  }
  let signing = "unknown"
  let identifier = null
  let teamIdentifier = null
  if ((options.platform ?? process.platform) === "darwin") {
    const cs = spawn("codesign", ["-dvv", path], { encoding: "utf8" })
    const out = (cs.stdout ?? "") + (cs.stderr ?? "")
    if (/code object is not signed/i.test(out)) {
      signing = "unsigned"
    } else if (/Signature=adhoc/i.test(out)) {
      signing = "adhoc"
    } else if (/TeamIdentifier=(?!not set)/i.test(out)) {
      signing = "developer-id"
      const teamMatch = out.match(/TeamIdentifier=(\S+)/)
      teamIdentifier = teamMatch?.[1] ?? null
    } else if (/Signature=/i.test(out)) {
      signing = "other"
    }
    const idMatch = out.match(/Identifier=(\S+)/)
    identifier = idMatch?.[1] ?? null
  }
  const gatekeeper =
    exists && (options.platform ?? process.platform) === "darwin"
      ? assessNativeExecutable(path, options)
      : null
  return {
    path,
    exists: true,
    sizeBytes,
    xattrs,
    hasQuarantine: xattrs.includes("com.apple.quarantine"),
    signing,
    identifier,
    teamIdentifier,
    gatekeeperStatus: gatekeeper?.status ?? null,
    gatekeeperDetail: gatekeeper?.detail ?? null
  }
}
