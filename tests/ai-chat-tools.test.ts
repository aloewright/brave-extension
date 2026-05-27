import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock joplin-client and @plasmohq/storage.
const { createNoteMock, pingMock } = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  pingMock: vi.fn()
}))
vi.mock("../src/lib/joplin", () => ({
  createNote: createNoteMock,
  ping: pingMock,
  JoplinClientError: class extends Error {
    constructor(message: string, public readonly status: number) {
      super(message)
    }
  }
}))

const mem = new Map<string, unknown>()
vi.mock("@plasmohq/storage", () => ({
  Storage: class {
    async get<T>(key: string): Promise<T | undefined> {
      return mem.get(key) as T | undefined
    }
    async set(key: string, value: unknown): Promise<void> {
      mem.set(key, value)
    }
    async remove(key: string): Promise<void> {
      mem.delete(key)
    }
  }
}))

// Stub chrome.tabs.query
;(globalThis as { chrome?: unknown }).chrome = {
  tabs: {
    query: vi.fn(async () => [
      { url: "http://example.test/page", title: "Example" }
    ])
  }
}

import { buildTools, runTool, captureAmbient } from "../src/lib/ai-chat-tools"

const STUB_TOKEN = "stub-token"

describe("buildTools", () => {
  beforeEach(() => {
    createNoteMock.mockReset()
    pingMock.mockReset()
    mem.clear()
  })

  it("returns exactly the three V1 tools by name", () => {
    const tools = buildTools(async () => STUB_TOKEN)
    expect(tools.map((t) => t.name)).toEqual([
      "joplin.createNote",
      "joplin.ping",
      "context.activeTab"
    ])
  })

  it("joplin.createNote calls underlying createNote with args + token", async () => {
    createNoteMock.mockResolvedValue("note-abc")
    const tools = buildTools(async () => STUB_TOKEN)
    const tool = tools.find((t) => t.name === "joplin.createNote")!
    const out = await tool.execute({
      title: "T",
      body: "B",
      sourceUrl: "http://x"
    })
    expect(createNoteMock).toHaveBeenCalledWith(
      { title: "T", body: "B", sourceUrl: "http://x" },
      STUB_TOKEN
    )
    expect(out).toEqual({ ok: true, result: { id: "note-abc" } })
  })

  it("joplin.createNote returns ok:false when createNote throws", async () => {
    createNoteMock.mockRejectedValue(new Error("nope"))
    const tools = buildTools(async () => STUB_TOKEN)
    const tool = tools.find((t) => t.name === "joplin.createNote")!
    const out = await tool.execute({ title: "T", body: "B" })
    expect(out.ok).toBe(false)
    expect(out.error).toBe("nope")
  })

  it("joplin.ping returns { reachable: true } when ping resolves true", async () => {
    pingMock.mockResolvedValue(true)
    const tools = buildTools(async () => STUB_TOKEN)
    const tool = tools.find((t) => t.name === "joplin.ping")!
    const out = await tool.execute({})
    expect(out).toEqual({ ok: true, result: { reachable: true } })
  })

  it("joplin.ping returns ok:false when ping throws", async () => {
    pingMock.mockRejectedValue(new Error("boom"))
    const tools = buildTools(async () => STUB_TOKEN)
    const tool = tools.find((t) => t.name === "joplin.ping")!
    const out = await tool.execute({})
    expect(out.ok).toBe(false)
  })

  it("context.activeTab returns the active tab url/title", async () => {
    const tools = buildTools(async () => STUB_TOKEN)
    const tool = tools.find((t) => t.name === "context.activeTab")!
    const out = await tool.execute({})
    expect(out).toEqual({
      ok: true,
      result: { url: "http://example.test/page", title: "Example" }
    })
  })

  it("context.activeTab returns nulls when no active tab", async () => {
    ;((globalThis as unknown) as { chrome: { tabs: { query: ReturnType<typeof vi.fn> } } }).chrome.tabs.query.mockResolvedValue(
      []
    )
    const tools = buildTools(async () => STUB_TOKEN)
    const tool = tools.find((t) => t.name === "context.activeTab")!
    const out = await tool.execute({})
    expect(out).toEqual({ ok: true, result: { url: null, title: null } })
  })
})

describe("runTool", () => {
  it("returns ok:false for unknown tool name", async () => {
    const tools = buildTools(async () => STUB_TOKEN)
    const out = await runTool(tools, "no.such.tool", "{}")
    expect(out.ok).toBe(false)
    expect(out.error).toContain("Unknown tool")
  })

  it("returns ok:false on malformed JSON arguments", async () => {
    const tools = buildTools(async () => STUB_TOKEN)
    const out = await runTool(tools, "joplin.ping", "{not json")
    expect(out.ok).toBe(false)
    expect(out.error).toMatch(/arguments did not parse/i)
  })

  it("treats '' as empty args ({})", async () => {
    pingMock.mockResolvedValue(true)
    const tools = buildTools(async () => STUB_TOKEN)
    const out = await runTool(tools, "joplin.ping", "")
    expect(out).toEqual({ ok: true, result: { reachable: true } })
  })
})

describe("captureAmbient", () => {
  beforeEach(() => {
    ;((globalThis as unknown) as { chrome: { tabs: { query: ReturnType<typeof vi.fn> } } }).chrome.tabs.query.mockResolvedValue(
      [{ url: "http://a.test/", title: "A" }]
    )
    mem.clear()
  })

  it("returns ambient with activeTab when tabs.query resolves", async () => {
    const out = await captureAmbient()
    expect(out.activeTab).toEqual({ url: "http://a.test/", title: "A" })
  })

  it("swallows tabs.query errors and returns ambient without activeTab", async () => {
    ;((globalThis as unknown) as { chrome: { tabs: { query: ReturnType<typeof vi.fn> } } }).chrome.tabs.query.mockRejectedValue(
      new Error("denied")
    )
    const out = await captureAmbient()
    expect(out.activeTab).toBeUndefined()
  })

  it("attaches mostRecentClip when joplin recents storage has one", async () => {
    mem.set("ai-dev-joplin-recent-clips", {
      clips: [
        {
          title: "Clip A",
          mode: "simplified",
          createdAt: "2026-05-27T00:00:00Z",
          joplinUrl: "joplin://x-callback-url/openNote?id=n1"
        }
      ]
    })
    const out = await captureAmbient()
    expect(out.mostRecentClip).toEqual({
      title: "Clip A",
      mode: "simplified",
      createdAt: "2026-05-27T00:00:00Z",
      joplinUrl: "joplin://x-callback-url/openNote?id=n1"
    })
  })
})
