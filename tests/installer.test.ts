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
  claudeJsonPath
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
