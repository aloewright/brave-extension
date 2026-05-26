import { describe, it, expect, beforeEach } from "vitest"
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import {
  mergeMcpEntry,
  removeMcpEntry,
  addRcBlock,
  removeRcBlock,
  buildClaudeEntry,
  buildWrapperScript,
  RC_MARKER_BEGIN,
  RC_MARKER_END,
  applyRcBlock,
  setTerminalPath,
  hasTerminalPath,
  registerClaudeJson,
  unregisterClaudeJson,
  isRegistered,
  writeTokenAndEnv,
  removeTokenAndEnv,
  tokenPath,
  envPath,
  wrapperPath,
  claudeJsonPath,
  resolveClaudeConfigPath,
  findNativeArtifacts,
  findNamedBinariesUnder,
  findSwiftToolchainArtifacts,
  resolveNodePtyNativePaths,
  assessNativeExecutable,
  prepareNodePtyForGatekeeper,
  scrubQuarantine,
  scrubQuarantineAll,
  repoNodeModuleRoots,
  inspectNativeArtifact
} from "../native-host/installer.mjs"

describe("installer pure helpers", () => {
  describe("mergeMcpEntry / removeMcpEntry", () => {
    it("merges into empty config", () => {
      const out = mergeMcpEntry({}, buildClaudeEntry(8473))
      expect(out.mcpServers["ai-dev-sidebar"]).toEqual({
        type: "sse",
        url: "http://127.0.0.1:8473/sse",
        headers: { Authorization: "Bearer ${AI_DEV_MCP_TOKEN}" }
      })
    })

    it("preserves siblings on merge", () => {
      const existing = {
        someTopKey: "x",
        mcpServers: { other: { type: "stdio", command: "foo" } }
      }
      const out = mergeMcpEntry(existing, buildClaudeEntry(8473))
      expect(out.someTopKey).toBe("x")
      expect(out.mcpServers.other).toEqual({ type: "stdio", command: "foo" })
      expect(out.mcpServers["ai-dev-sidebar"]).toBeDefined()
    })

    it("does not mutate input on merge", () => {
      const existing = { mcpServers: { other: { command: "x" } } }
      const snap = JSON.stringify(existing)
      mergeMcpEntry(existing, buildClaudeEntry(8473))
      expect(JSON.stringify(existing)).toBe(snap)
    })

    it("strips ours from removeMcpEntry, preserving siblings", () => {
      const existing = {
        topKey: 1,
        mcpServers: {
          other: { command: "foo" },
          "ai-dev-sidebar": buildClaudeEntry(8473)
        }
      }
      const out = removeMcpEntry(existing)
      expect(out.topKey).toBe(1)
      expect(out.mcpServers.other).toBeDefined()
      expect(out.mcpServers["ai-dev-sidebar"]).toBeUndefined()
    })

    it("drops empty mcpServers after removal", () => {
      const existing = { mcpServers: { "ai-dev-sidebar": {} }, foo: 1 }
      const out = removeMcpEntry(existing)
      expect(out.mcpServers).toBeUndefined()
      expect(out.foo).toBe(1)
    })

    it("handles missing/invalid input safely", () => {
      expect(removeMcpEntry(null)).toEqual({})
      expect(removeMcpEntry(undefined)).toEqual({})
      expect(removeMcpEntry({ foo: 1 })).toEqual({ foo: 1 })
    })
  })

  describe("addRcBlock / removeRcBlock", () => {
    it("addRcBlock appends marker block to empty content", () => {
      const out = addRcBlock("")
      expect(out).toContain(RC_MARKER_BEGIN)
      expect(out).toContain(RC_MARKER_END)
      expect(out).toContain('export PATH="$HOME/.config/ai-dev-sidebar:$PATH"')
    })

    it("addRcBlock is idempotent", () => {
      const once = addRcBlock("")
      const twice = addRcBlock(once)
      expect(twice).toBe(once)
    })

    it("addRcBlock preserves prior content", () => {
      const prior = "# my zshrc\nalias g=git\n"
      const out = addRcBlock(prior)
      expect(out.startsWith(prior)).toBe(true)
      expect(out).toContain(RC_MARKER_BEGIN)
    })

    it("removeRcBlock removes only the block, preserving siblings", () => {
      const prior = "alias g=git\n"
      const withBlock = addRcBlock(prior)
      const removed = removeRcBlock(withBlock)
      expect(removed).not.toContain(RC_MARKER_BEGIN)
      expect(removed).not.toContain(RC_MARKER_END)
      expect(removed).toContain("alias g=git")
    })

    it("removeRcBlock is idempotent on content without block", () => {
      const orig = "alias g=git\n"
      expect(removeRcBlock(orig)).toBe(orig)
    })

    it("addRcBlock + removeRcBlock round-trips cleanly (no junk left)", () => {
      const orig = "# existing rc\nalias g=git\nexport FOO=bar\n"
      const cycled = removeRcBlock(addRcBlock(orig))
      // Allow some whitespace normalization but core content preserved.
      expect(cycled).toContain("alias g=git")
      expect(cycled).toContain("export FOO=bar")
      expect(cycled).not.toContain(RC_MARKER_BEGIN)
    })
  })

  describe("buildWrapperScript", () => {
    it("includes cycle-prevention PATH stripping", () => {
      const script = buildWrapperScript()
      expect(script).toMatch(/^#!\/usr\/bin\/env bash/)
      expect(script).toContain("OUR_DIR=")
      expect(script).toContain('exec /usr/bin/env claude "$@"')
      // Cycle prevention: drop our dir from PATH before exec.
      expect(script).toContain('[ "$p" = "$OUR_DIR" ] && continue')
    })
  })
})

describe("installer fs helpers (sandboxed home)", () => {
  let fakeHome: string

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "aids-installer-"))
  })

  it("registerClaudeJson + unregisterClaudeJson round-trip", () => {
    // pre-existing siblings should survive.
    writeFileSync(
      claudeJsonPath(fakeHome),
      JSON.stringify({ mcpServers: { other: { command: "x" } }, top: 1 }, null, 2)
    )
    registerClaudeJson(8473, fakeHome)
    expect(isRegistered(fakeHome)).toBe(true)
    const cfg1 = JSON.parse(readFileSync(claudeJsonPath(fakeHome), "utf-8"))
    expect(cfg1.mcpServers.other).toBeDefined()
    expect(cfg1.mcpServers["ai-dev-sidebar"].url).toContain(":8473/sse")
    expect(cfg1.top).toBe(1)

    unregisterClaudeJson(fakeHome)
    expect(isRegistered(fakeHome)).toBe(false)
    const cfg2 = JSON.parse(readFileSync(claudeJsonPath(fakeHome), "utf-8"))
    expect(cfg2.mcpServers.other).toBeDefined()
    expect(cfg2.top).toBe(1)
  })

  it("registers MCP in any configured Claude config path", () => {
    const customConfig = "~/Library/Application Support/Claude/claude_desktop_config.json"
    const resolved = resolveClaudeConfigPath(customConfig, fakeHome)
    mkdirSync(join(fakeHome, "Library/Application Support/Claude"), { recursive: true })
    writeFileSync(
      resolved,
      JSON.stringify({ mcpServers: { sibling: { command: "node" } } }, null, 2)
    )

    registerClaudeJson(8474, fakeHome, customConfig)
    expect(isRegistered(fakeHome, customConfig)).toBe(true)
    expect(isRegistered(fakeHome)).toBe(false)
    const cfg = JSON.parse(readFileSync(resolved, "utf-8"))
    expect(cfg.mcpServers.sibling).toEqual({ command: "node" })
    expect(cfg.mcpServers["ai-dev-sidebar"].url).toContain(":8474/sse")

    unregisterClaudeJson(fakeHome, customConfig)
    const removed = JSON.parse(readFileSync(resolved, "utf-8"))
    expect(removed.mcpServers.sibling).toEqual({ command: "node" })
    expect(removed.mcpServers["ai-dev-sidebar"]).toBeUndefined()
  })

  it("re-running register is idempotent", () => {
    registerClaudeJson(8473, fakeHome)
    const a = readFileSync(claudeJsonPath(fakeHome), "utf-8")
    registerClaudeJson(8473, fakeHome)
    const b = readFileSync(claudeJsonPath(fakeHome), "utf-8")
    expect(a).toBe(b)
  })

  it("setTerminalPath(true) writes wrapper + rc blocks", () => {
    writeFileSync(join(fakeHome, ".zshrc"), "alias g=git\n")
    setTerminalPath(true, fakeHome)
    const zsh = readFileSync(join(fakeHome, ".zshrc"), "utf-8")
    expect(zsh).toContain(RC_MARKER_BEGIN)
    expect(existsSync(wrapperPath(fakeHome))).toBe(true)
    const status = hasTerminalPath(fakeHome)
    expect(status.hasRcBlock).toBe(true)
    expect(status.hasWrapper).toBe(true)
  })

  it("setTerminalPath round-trip leaves rc clean", () => {
    writeFileSync(join(fakeHome, ".zshrc"), "alias g=git\n")
    setTerminalPath(true, fakeHome)
    setTerminalPath(false, fakeHome)
    const zsh = readFileSync(join(fakeHome, ".zshrc"), "utf-8")
    expect(zsh).toContain("alias g=git")
    expect(zsh).not.toContain(RC_MARKER_BEGIN)
    expect(existsSync(wrapperPath(fakeHome))).toBe(false)
  })

  it("setTerminalPath(true) twice is idempotent (no duplicate blocks)", () => {
    writeFileSync(join(fakeHome, ".zshrc"), "alias g=git\n")
    setTerminalPath(true, fakeHome)
    const a = readFileSync(join(fakeHome, ".zshrc"), "utf-8")
    setTerminalPath(true, fakeHome)
    const b = readFileSync(join(fakeHome, ".zshrc"), "utf-8")
    expect(a).toBe(b)
    // Ensure marker only appears once.
    const matches = (b.match(new RegExp(RC_MARKER_BEGIN.replace(/[>\\]/g, "\\$&"), "g")) || []).length
    expect(matches).toBe(1)
  })

  it("applyRcBlock skips creating a non-existent rc when disabling", () => {
    const path = join(fakeHome, ".zshrc")
    const r = applyRcBlock(path, false)
    expect(r.changed).toBe(false)
    expect(existsSync(path)).toBe(false)
  })

  it("writeTokenAndEnv + removeTokenAndEnv round-trip", () => {
    writeTokenAndEnv("deadbeef", 8473, fakeHome)
    expect(readFileSync(tokenPath(fakeHome), "utf-8")).toBe("deadbeef")
    expect(readFileSync(envPath(fakeHome), "utf-8")).toContain("AI_DEV_MCP_TOKEN=deadbeef")
    removeTokenAndEnv(fakeHome)
    expect(existsSync(tokenPath(fakeHome))).toBe(false)
    expect(existsSync(envPath(fakeHome))).toBe(false)
  })

  it("removeTokenAndEnv is safe when files absent", () => {
    expect(() => removeTokenAndEnv(fakeHome)).not.toThrow()
  })
})

// ALO-472 — Gatekeeper / quarantine remediation
describe("native artifact discovery + quarantine scrub", () => {
  let fakeRoot: string

  beforeEach(() => {
    fakeRoot = mkdtempSync(join(tmpdir(), "aids-quarantine-"))
  })

  it("findNativeArtifacts returns every .node and spawn-helper, sorted", () => {
    // Mimic the node-pty tree we'd see in native-host/node_modules.
    mkdirSync(join(fakeRoot, "node-pty/prebuilds/darwin-arm64"), { recursive: true })
    mkdirSync(join(fakeRoot, "node-pty/prebuilds/darwin-x64"), { recursive: true })
    mkdirSync(join(fakeRoot, "other-helper/.bin"), { recursive: true })
    writeFileSync(join(fakeRoot, "node-pty/prebuilds/darwin-arm64/pty.node"), "x")
    writeFileSync(join(fakeRoot, "node-pty/prebuilds/darwin-arm64/spawn-helper"), "x")
    writeFileSync(join(fakeRoot, "node-pty/prebuilds/darwin-x64/pty.node"), "x")
    writeFileSync(join(fakeRoot, "node-pty/prebuilds/darwin-x64/spawn-helper"), "x")
    writeFileSync(join(fakeRoot, "other-helper/something.node"), "x")
    // Junk that should be ignored.
    writeFileSync(join(fakeRoot, "other-helper/README.md"), "x")
    writeFileSync(join(fakeRoot, "other-helper/.bin/symlink-only"), "x")

    const found = findNativeArtifacts(fakeRoot)
    expect(found).toHaveLength(5)
    expect(found.every((p: string) => p.endsWith(".node") || p.endsWith("spawn-helper"))).toBe(true)
    // Sorted output is stable for diagnostic display.
    expect(found).toEqual([...found].sort())
    // .bin contents are excluded.
    expect(found.some((p: string) => p.includes("/.bin/"))).toBe(false)
  })

  it("findNativeArtifacts returns empty for a missing root", () => {
    expect(findNativeArtifacts(join(fakeRoot, "does-not-exist"))).toEqual([])
  })

  it("findNativeArtifacts includes fsevents.node (chokidar/vitest optional dep)", () => {
    mkdirSync(join(fakeRoot, "fsevents"), { recursive: true })
    writeFileSync(join(fakeRoot, "fsevents/fsevents.node"), "x")

    const found = findNativeArtifacts(fakeRoot, { platform: "darwin" })
    expect(found).toEqual([join(fakeRoot, "fsevents/fsevents.node")])
  })

  it("findNativeArtifacts includes esbuild Mach-O bins and rollup prebuilds", () => {
    mkdirSync(join(fakeRoot, "@esbuild/darwin-arm64/bin"), { recursive: true })
    mkdirSync(join(fakeRoot, "@rollup/rollup-darwin-arm64"), { recursive: true })
    mkdirSync(join(fakeRoot, "fsevents"), { recursive: true })
    writeFileSync(join(fakeRoot, "@esbuild/darwin-arm64/bin/esbuild"), "x")
    writeFileSync(join(fakeRoot, "@rollup/rollup-darwin-arm64/rollup.darwin-arm64.node"), "x")
    writeFileSync(join(fakeRoot, "fsevents/fsevents.node"), "x")

    const found = findNativeArtifacts(fakeRoot)
    expect(found).toHaveLength(3)
    expect(found.some((p: string) => p.endsWith("/bin/esbuild"))).toBe(true)
    expect(found.some((p: string) => p.endsWith("rollup.darwin-arm64.node"))).toBe(true)
    expect(found.some((p: string) => p.endsWith("fsevents.node"))).toBe(true)
  })

  it("resolveNodePtyNativePaths returns pty.node and spawn-helper for current arch", () => {
    mkdirSync(join(fakeRoot, "node_modules/node-pty/prebuilds/darwin-arm64"), { recursive: true })
    writeFileSync(join(fakeRoot, "node_modules/node-pty/prebuilds/darwin-arm64/pty.node"), "x")
    writeFileSync(join(fakeRoot, "node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper"), "x")
    mkdirSync(join(fakeRoot, "node_modules/node-pty/prebuilds/darwin-x64"), { recursive: true })
    writeFileSync(join(fakeRoot, "node_modules/node-pty/prebuilds/darwin-x64/pty.node"), "x")

    const found = resolveNodePtyNativePaths(fakeRoot, { platform: "darwin", arch: "arm64" })
    expect(found).toHaveLength(2)
    expect(found.every((p: string) => p.includes("darwin-arm64"))).toBe(true)
  })

  it("assessNativeExecutable maps spctl output to allowed/rejected", () => {
    const path = join(fakeRoot, "bin")
    mkdirSync(path, { recursive: true })
    writeFileSync(join(path, "tool"), "x")
    const allowed = assessNativeExecutable(join(path, "tool"), {
      platform: "darwin",
      spawnSync: () => ({ status: 0, stdout: "accepted\n", stderr: "" })
    })
    expect(allowed.status).toBe("allowed")
    const rejected = assessNativeExecutable(join(path, "tool"), {
      platform: "darwin",
      spawnSync: () => ({ status: 3, stdout: "", stderr: "rejected\nsource=Unnotarized Developer ID\n" })
    })
    expect(rejected.status).toBe("rejected")
  })

  it("findNamedBinariesUnder finds swift-manifest in a cache tree", () => {
    mkdirSync(join(fakeRoot, "org.swift.swiftpm", "artifacts"), { recursive: true })
    writeFileSync(join(fakeRoot, "org.swift.swiftpm", "artifacts", "swift-manifest"), "x")
    writeFileSync(join(fakeRoot, "org.swift.swiftpm", "artifacts", "other-tool"), "x")

    const found = findNamedBinariesUnder(join(fakeRoot, "org.swift.swiftpm"), ["swift-manifest"])
    expect(found).toHaveLength(1)
    expect(found[0].endsWith("swift-manifest")).toBe(true)
  })

  it("findSwiftToolchainArtifacts discovers swift-manifest next to swift", () => {
    mkdirSync(join(fakeRoot, "bin"), { recursive: true })
    writeFileSync(join(fakeRoot, "bin", "swift"), "x")
    writeFileSync(join(fakeRoot, "bin", "swift-manifest"), "x")

    const found = findSwiftToolchainArtifacts({
      platform: "darwin",
      spawnSync: (cmd: string, args: string[]) => {
        if (cmd === "which" && args[0] === "swift") {
          return { status: 0, stdout: join(fakeRoot, "bin", "swift") + "\n" }
        }
        if (cmd === "xcrun" && args[0] === "-f") {
          return { status: 1, stdout: "" }
        }
        return { status: 1 }
      }
    })
    expect(found.some((p: string) => p.endsWith("/bin/swift-manifest"))).toBe(true)
  })

  it("scrubQuarantineAll walks every existing repo node_modules root", () => {
    const repo = mkdtempSync(join(tmpdir(), "aids-repo-"))
    const roots = [
      join(repo, "node_modules"),
      join(repo, "native-host", "node_modules"),
      join(repo, "worker", "node_modules")
    ]
    for (const root of roots) {
      mkdirSync(join(root, "fsevents"), { recursive: true })
      writeFileSync(join(root, "fsevents/fsevents.node"), "x")
    }
    const calls: string[] = []
    const result = scrubQuarantineAll(repo, {
      platform: "darwin",
      spawnSync: (_cmd: string, args: string[]) => {
        calls.push(args[2])
        return { status: 0 }
      }
    })
    expect(result.roots).toHaveLength(3)
    expect(result.scrubbed.length).toBeGreaterThanOrEqual(3)
    expect(calls.filter((p) => p?.includes("fsevents.node"))).toHaveLength(3)
  })

  it("findNativeArtifacts skips non-darwin optional deps on macOS", () => {
    mkdirSync(join(fakeRoot, "@esbuild+darwin-arm64@0.25.12/node_modules/@esbuild/darwin-arm64/bin"), { recursive: true })
    mkdirSync(join(fakeRoot, "@esbuild+linux-x64@0.25.12/node_modules/@esbuild/linux-x64/bin"), { recursive: true })
    writeFileSync(join(fakeRoot, "@esbuild+darwin-arm64@0.25.12/node_modules/@esbuild/darwin-arm64/bin/esbuild"), "x")
    writeFileSync(join(fakeRoot, "@esbuild+linux-x64@0.25.12/node_modules/@esbuild/linux-x64/bin/esbuild"), "x")

    const found = findNativeArtifacts(fakeRoot, { platform: "darwin" })
    expect(found).toHaveLength(1)
    expect(found[0]).toContain("darwin-arm64")
  })

  it("scrubQuarantine is a no-op on non-darwin platforms", () => {
    mkdirSync(join(fakeRoot, "pkg"), { recursive: true })
    writeFileSync(join(fakeRoot, "pkg/pty.node"), "x")
    const calls: any[] = []
    const result = scrubQuarantine(fakeRoot, {
      platform: "linux",
      spawnSync: (...args: any[]) => {
        calls.push(args)
        return { status: 0 }
      }
    })
    expect(result.scrubbed).toEqual([])
    expect(calls).toEqual([])
  })

  it("scrubQuarantine runs xattr -d com.apple.quarantine for every native artifact", () => {
    mkdirSync(join(fakeRoot, "node-pty/prebuilds/darwin-arm64"), { recursive: true })
    writeFileSync(join(fakeRoot, "node-pty/prebuilds/darwin-arm64/pty.node"), "x")
    writeFileSync(join(fakeRoot, "node-pty/prebuilds/darwin-arm64/spawn-helper"), "x")
    const calls: { cmd: string; args: string[] }[] = []
    const result = scrubQuarantine(fakeRoot, {
      platform: "darwin",
      spawnSync: (cmd: string, args: string[]) => {
        calls.push({ cmd, args })
        return { status: 0 }
      }
    })
    expect(result.scrubbed).toHaveLength(2)
    expect(result.errors).toEqual([])
    expect(calls).toHaveLength(2)
    for (const c of calls) {
      expect(c.cmd).toBe("xattr")
      expect(c.args.slice(0, 2)).toEqual(["-d", "com.apple.quarantine"])
    }
  })

  it("scrubQuarantine surfaces spawn errors per-file without aborting the rest", () => {
    mkdirSync(join(fakeRoot, "a"), { recursive: true })
    mkdirSync(join(fakeRoot, "b"), { recursive: true })
    writeFileSync(join(fakeRoot, "a/pty.node"), "x")
    writeFileSync(join(fakeRoot, "b/other.node"), "x")
    const result = scrubQuarantine(fakeRoot, {
      platform: "darwin",
      spawnSync: (_cmd: string, args: string[]) => {
        if (args[2].endsWith("a/pty.node")) {
          return { error: new Error("xattr missing"), status: null }
        }
        return { status: 0 }
      }
    })
    expect(result.scrubbed).toHaveLength(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toBe("xattr missing")
  })

  it("inspectNativeArtifact reports adhoc + quarantine state from spawn output", () => {
    mkdirSync(join(fakeRoot, "n"), { recursive: true })
    const path = join(fakeRoot, "n/pty.node")
    writeFileSync(path, "x")
    const info = inspectNativeArtifact(path, {
      platform: "darwin",
      spawnSync: (cmd: string) => {
        if (cmd === "xattr") {
          return { status: 0, stdout: "com.apple.quarantine\ncom.apple.metadata:foo\n" }
        }
        if (cmd === "codesign") {
          return {
            status: 0,
            stdout: "",
            stderr:
              "Executable=" + path + "\n" +
              "Identifier=pty.node\n" +
              "Format=Mach-O thin (arm64)\n" +
              "Signature=adhoc\n" +
              "TeamIdentifier=not set\n"
          }
        }
        return { status: 1 }
      }
    })
    expect(info.exists).toBe(true)
    expect(info.signing).toBe("adhoc")
    expect(info.hasQuarantine).toBe(true)
    expect(info.identifier).toBe("pty.node")
    expect(info.xattrs).toContain("com.apple.quarantine")
  })

  it("inspectNativeArtifact reports `exists: false` for a missing path", () => {
    const info = inspectNativeArtifact(join(fakeRoot, "missing.node"))
    expect(info).toEqual({ path: join(fakeRoot, "missing.node"), exists: false })
  })
})
