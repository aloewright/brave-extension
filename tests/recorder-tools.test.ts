import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { homedir } from "os"
import { join } from "path"

// Tests for the recorder MCP tool surface (ALO-249, M6).
//
//   - Schema registration in the host registry (4 tools).
//   - recorder_list / recorder_get host-side semantics.
//   - file:// URI helper shape.
//   - publishRecordings publisher fires on boot + on storage change (debounced).

describe("recorder MCP tool defs", () => {
  it("exposes 4 tools — start/stop bridged, list/get host-side", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const server = new (MCPServer as any)({ logger: () => {} })

    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    })
    const byName = new Map<string, any>(
      reply.result.tools.map((t: any) => [t.name, t])
    )

    for (const name of ["recorder_start", "recorder_stop", "recorder_list", "recorder_get"]) {
      const t = byName.get(name)
      expect(t, `tool ${name} missing`).toBeTruthy()
      expect(t.inputSchema).toBeTruthy()
      expect(t.inputSchema.type).toBe("object")
      expect(typeof t.description).toBe("string")
      expect(t.description.length).toBeGreaterThan(0)
    }

    // Bridged tools fail with the "extension bridge" error when no bridge wired.
    for (const name of ["recorder_start", "recorder_stop"]) {
      const r = await server._dispatch({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: {} }
      })
      expect(r.result.isError).toBe(true)
      expect(r.result.content[0].text).toContain("extension bridge")
    }

    // Host-side tools succeed with empty resource map.
    const list = await server._dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "recorder_list", arguments: {} }
    })
    expect(list.result.isError).toBe(false)
    expect(JSON.parse(list.result.content[0].text)).toEqual([])

    const miss = await server._dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "recorder_get", arguments: { id: "nope" } }
    })
    expect(miss.result.isError).toBe(true)
  })

  it("recorder_get returns metadata + file:// URI under ~/.config/ai-dev-sidebar/recordings/", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const { recordingsHostFileUri } = await import(
      "../native-host/tool-defs/recorder-tools.mjs"
    )
    const server = new (MCPServer as any)({ logger: () => {} })

    const meta = {
      id: "rec_abc",
      source: "tab",
      durationMs: 1234,
      sizeBytes: 5678,
      mimeType: "video/mp4",
      filename: "recording-fixture.mp4",
      createdAt: "2026-04-29T00:00:00Z"
    }
    server.upsertResource("ai-dev://recordings", {
      name: "Recordings",
      payload: [meta]
    })

    const got = await server._dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "recorder_get", arguments: { id: "rec_abc" } }
    })
    expect(got.result.isError).toBe(false)
    const parsed = JSON.parse(got.result.content[0].text)
    expect(parsed.metadata.id).toBe("rec_abc")
    expect(parsed.fileUri).toBe(
      `file://${join(homedir(), ".config", "ai-dev-sidebar", "recordings", "rec_abc.mp4")}`
    )
    // Helper agrees.
    expect(recordingsHostFileUri("rec_abc")).toBe(parsed.fileUri)
  })

  it("recorder_list honors limit and reads truncated payload shape", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const server = new (MCPServer as any)({ logger: () => {} })

    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `rec_${i}`,
      source: "tab",
      durationMs: 0,
      sizeBytes: 0,
      mimeType: "video/mp4",
      filename: `r${i}.mp4`,
      createdAt: ""
    }))
    server.upsertResource("ai-dev://recordings", {
      name: "Recordings",
      payload: { recordings: items, truncated: true }
    })

    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "recorder_list", arguments: { limit: 2 } }
    })
    const out = JSON.parse(reply.result.content[0].text)
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe("rec_0")
  })
})

describe("publishRecordings", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as any).chrome = {
      ...(globalThis as any).chrome,
      bookmarks: {
        getTree: vi.fn(async () => []),
        onCreated: { addListener: () => {}, removeListener: () => {} },
        onRemoved: { addListener: () => {}, removeListener: () => {} },
        onChanged: { addListener: () => {}, removeListener: () => {} },
        onMoved: { addListener: () => {}, removeListener: () => {} }
      },
      management: {
        getAll: vi.fn(async () => []),
        onInstalled: { addListener: () => {}, removeListener: () => {} },
        onUninstalled: { addListener: () => {}, removeListener: () => {} },
        onEnabled: { addListener: () => {}, removeListener: () => {} },
        onDisabled: { addListener: () => {}, removeListener: () => {} }
      },
      storage: {
        ...(globalThis as any).chrome.storage,
        onChanged: (() => {
          const ls: any[] = []
          return {
            addListener: (fn: any) => ls.push(fn),
            removeListener: (fn: any) => {
              const i = ls.indexOf(fn)
              if (i >= 0) ls.splice(i, 1)
            },
            __fire: (changes: any, area = "local") =>
              ls.forEach((fn) => fn(changes, area))
          }
        })()
      }
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("publishes ai-dev://recordings on boot", async () => {
    await chrome.storage.local.set({
      "recorder.recordings": [{ id: "x", filename: "x.mp4" }]
    })
    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: any[] = []
    startResourcePublishers({
      upsert: (uri, def) => upserts.push({ uri, payload: def.payload }),
      debounceMs: 10
    })
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    const rec = upserts.find((u) => u.uri === "ai-dev://recordings")
    expect(rec).toBeTruthy()
    expect(Array.isArray(rec.payload)).toBe(true)
    expect(rec.payload[0].id).toBe("x")
  })

  it("debounces a burst of recorder.recordings storage changes into one republish", async () => {
    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: string[] = []
    startResourcePublishers({
      upsert: (uri) => upserts.push(uri),
      debounceMs: 25
    })
    await vi.advanceTimersByTimeAsync(40)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const initial = upserts.filter((u) => u === "ai-dev://recordings").length
    expect(initial).toBe(1)

    const onCh = (chrome as any).storage.onChanged
    onCh.__fire({ "recorder.recordings": { newValue: [], oldValue: [] } }, "local")
    onCh.__fire({ "recorder.recordings": { newValue: [], oldValue: [] } }, "local")
    onCh.__fire({ "recorder.recordings": { newValue: [], oldValue: [] } }, "local")
    await vi.advanceTimersByTimeAsync(40)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    const after = upserts.filter((u) => u === "ai-dev://recordings").length
    expect(after).toBe(initial + 1)
  })
})
