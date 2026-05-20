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

import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { randomBytes } from "crypto"

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
export function claudeJsonPath(home = homedir()) {
  return join(home, ".claude.json")
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

export function readClaudeJson(home = homedir()) {
  const path = claudeJsonPath(home)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

export function writeClaudeJson(cfg, home = homedir()) {
  const path = claudeJsonPath(home)
  ensureDir(dirname(path))
  writeFileSync(path, JSON.stringify(cfg, null, 2))
}

export function registerClaudeJson(port, home = homedir()) {
  const cur = readClaudeJson(home) || {}
  const next = mergeMcpEntry(cur, buildClaudeEntry(port))
  writeClaudeJson(next, home)
  return next
}

export function unregisterClaudeJson(home = homedir()) {
  const cur = readClaudeJson(home)
  if (!cur) return null
  const next = removeMcpEntry(cur)
  writeClaudeJson(next, home)
  return next
}

export function isRegistered(home = homedir()) {
  const cur = readClaudeJson(home)
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
