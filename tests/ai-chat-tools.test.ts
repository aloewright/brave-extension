import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock joplin-client.
const {
  createNoteMock,
  pingMock,
  getNoteMock,
  appendToNoteMock,
  searchNotesMock,
  listFoldersMock,
  listTagsMock,
  findOrCreateFolderMock,
  addTagToNoteByNameMock
} = vi.hoisted(() => ({
  createNoteMock: vi.fn(),
  pingMock: vi.fn(),
  getNoteMock: vi.fn(),
  appendToNoteMock: vi.fn(),
  searchNotesMock: vi.fn(),
  listFoldersMock: vi.fn(),
  listTagsMock: vi.fn(),
  findOrCreateFolderMock: vi.fn(),
  addTagToNoteByNameMock: vi.fn()
}))
vi.mock("../src/lib/joplin", () => ({
  createNote: createNoteMock,
  ping: pingMock,
  getNote: getNoteMock,
  appendToNote: appendToNoteMock,
  searchNotes: searchNotesMock,
  listFolders: listFoldersMock,
  listTags: listTagsMock,
  findOrCreateFolder: findOrCreateFolderMock,
  addTagToNoteByName: addTagToNoteByNameMock,
  JoplinClientError: class extends Error {
    constructor(message: string, public readonly status: number) {
      super(message)
    }
  }
}))

// Stub chrome.tabs.query
const baseChrome = (globalThis as { chrome?: unknown }).chrome as Record<string, unknown>
;(globalThis as { chrome?: unknown }).chrome = {
  ...baseChrome,
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
    getNoteMock.mockReset()
    appendToNoteMock.mockReset()
    searchNotesMock.mockReset()
    listFoldersMock.mockReset()
    listTagsMock.mockReset()
    findOrCreateFolderMock.mockReset()
    addTagToNoteByNameMock.mockReset()
  })

  it("returns the V1 tool catalog by name", () => {
    const tools = buildTools(async () => STUB_TOKEN)
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "joplin.createNote",
        "joplin.ping",
        "joplin.getNote",
        "joplin.appendToNote",
        "joplin.searchNotes",
        "joplin.listFolders",
        "joplin.listTags",
        "joplin.findOrCreateFolder",
        "joplin.addTagToNoteByName",
        "context.activeTab"
      ].sort()
    )
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
  beforeEach(async () => {
    ;((globalThis as unknown) as { chrome: { tabs: { query: ReturnType<typeof vi.fn> } } }).chrome.tabs.query.mockResolvedValue(
      [{ url: "http://a.test/", title: "A" }]
    )
    await chrome.storage.local.clear()
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
    await chrome.storage.local.set({
      "ai-dev-joplin-recent-clips": {
        clips: [
          {
            title: "Clip A",
            mode: "simplified",
            createdAt: "2026-05-27T00:00:00Z",
            joplinUrl: "joplin://x-callback-url/openNote?id=n1"
          }
        ]
      }
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
