import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Bookmarks + library tools (ALO-246). The chrome.storage shim from
// tests/setup.ts is reset per test; we layer chrome.bookmarks on top.

beforeEach(() => {
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    bookmarks: {
      search: vi.fn(async (q: string) => [
        { id: "b1", title: `Match for ${q}`, url: "https://example.com", parentId: "0" }
      ]),
      create: vi.fn(async (d: any) => ({ id: "new-id", ...d })),
      remove: vi.fn(async () => undefined),
      removeTree: vi.fn(async () => undefined),
      move: vi.fn(async (id: string, dest: any) => ({ id, ...dest }))
    }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("MCP server library tools registration", () => {
  it("registers all 9 library tools with non-empty inputSchema", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const server = new MCPServer({ logger: () => {} })
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list"
    })
    const names = new Set(reply.result.tools.map((t: any) => t.name))
    for (const n of [
      "bookmarks_search",
      "bookmarks_create",
      "bookmarks_remove",
      "bookmarks_move",
      "links_list",
      "links_add",
      "links_remove",
      "captures_list",
      "captures_get"
    ]) {
      expect(names.has(n), `missing ${n}`).toBe(true)
      const t = reply.result.tools.find((x: any) => x.name === n)
      expect(t.inputSchema?.type).toBe("object")
    }
  })

  it("bookmarks_search forwards through the bridge", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const server = new MCPServer({ logger: () => {} })
    let received: any = null
    server.setToolRequestBridge(async (name: string, args: any) => {
      received = { name, args }
      return {
        content: [
          { type: "text", text: JSON.stringify([{ id: "b1", title: "x", url: "https://e" }]) }
        ],
        isError: false
      }
    })
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "bookmarks_search", arguments: { query: "foo", maxResults: 10 } }
    })
    expect(received).toEqual({
      name: "bookmarks_search",
      args: { query: "foo", maxResults: 10 }
    })
    expect(reply.result.isError).toBe(false)
    expect(reply.result.content[0].text).toContain("b1")
  })
})

describe("library tool handlers (background side)", () => {
  it("links_add → links_list → links_remove roundtrip", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")

    const empty = await LIBRARY_TOOL_HANDLERS.links_list({})
    expect(empty.isError).toBeFalsy()
    expect(JSON.parse(empty.content[0].text!)).toEqual([])

    const add = await LIBRARY_TOOL_HANDLERS.links_add({
      url: "https://example.com/a",
      title: "A",
      tags: ["x"]
    })
    expect(add.isError).toBeFalsy()
    const added = JSON.parse(add.content[0].text!)
    expect(added.url).toBe("https://example.com/a")
    expect(added.tags).toEqual(["x"])

    const after = await LIBRARY_TOOL_HANDLERS.links_list({})
    const list = JSON.parse(after.content[0].text!)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(added.id)

    const rm = await LIBRARY_TOOL_HANDLERS.links_remove({ id: added.id })
    expect(rm.isError).toBeFalsy()

    const final = await LIBRARY_TOOL_HANDLERS.links_list({})
    expect(JSON.parse(final.content[0].text!)).toEqual([])
  })

  it("bookmarks_search calls chrome.bookmarks.search and shapes the result", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const result = await LIBRARY_TOOL_HANDLERS.bookmarks_search({ query: "foo" })
    expect(result.isError).toBeFalsy()
    const arr = JSON.parse(result.content[0].text!)
    expect(arr[0]).toEqual({
      id: "b1",
      title: "Match for foo",
      url: "https://example.com",
      parentId: "0"
    })
  })

  it("serializes concurrent links_add calls (no read-modify-write race)", async () => {
    const { LIBRARY_TOOL_HANDLERS, LX_LINKS_KEY } = await import(
      "../src/background/library-tools"
    )
    // Fire two adds in parallel — without the lock the second read would
    // observe the empty list and overwrite the first add.
    const [r1, r2] = await Promise.all([
      LIBRARY_TOOL_HANDLERS.links_add({ url: "https://example.com/a", title: "A" }),
      LIBRARY_TOOL_HANDLERS.links_add({ url: "https://example.com/b", title: "B" })
    ])
    expect(r1.isError).toBeFalsy()
    expect(r2.isError).toBeFalsy()
    const stored = await chrome.storage.local.get(LX_LINKS_KEY)
    const list = (stored as any)[LX_LINKS_KEY] as Array<{ url: string }>
    expect(list).toHaveLength(2)
    const urls = list.map((l) => l.url).sort()
    expect(urls).toEqual(["https://example.com/a", "https://example.com/b"])
  })

  it("bookmarks_create rejects non-numeric parentId", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_create({
      title: "X",
      url: "https://e",
      parentId: "not-a-number"
    })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/invalid parentId/i)
    expect((chrome as any).bookmarks.create).not.toHaveBeenCalled()
  })

  it("bookmarks_create accepts numeric-string parentId", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_create({
      title: "X",
      url: "https://e",
      parentId: "42"
    })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).bookmarks.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: "42" })
    )
  })

  it("captures_get truncates HTML body above the cap", async () => {
    const { LIBRARY_TOOL_HANDLERS, LX_CAPTURES_KEY } = await import(
      "../src/background/library-tools"
    )
    const big = "x".repeat(300 * 1024)
    await chrome.storage.local.set({
      [LX_CAPTURES_KEY]: [
        {
          id: "cap1",
          url: "https://e",
          title: "t",
          capturedAt: "2026-01-01",
          html: big
        }
      ]
    })
    const r = await LIBRARY_TOOL_HANDLERS.captures_get({ id: "cap1" })
    expect(r.isError).toBeFalsy()
    const body = JSON.parse(r.content[0].text!)
    expect(body.truncated).toBe(true)
    expect(body.html.length).toBe(256 * 1024)
    expect(body.originalByteSize).toBe(300 * 1024)
  })

  // bookmarks_move tests — the PR changed the `dest` type to
  // chrome.bookmarks.BookmarkDestinationArg (was an inline object type).
  // These tests cover the function's runtime behaviour.

  it("bookmarks_move calls chrome.bookmarks.move with valid id and parentId", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "5", parentId: "2" })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).bookmarks.move).toHaveBeenCalledWith("5", { parentId: "2" })
    const result = JSON.parse(r.content[0].text!)
    expect(result.id).toBe("5")
    expect(result.parentId).toBe("2")
  })

  it("bookmarks_move calls chrome.bookmarks.move with valid id and index", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "7", index: 3 })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).bookmarks.move).toHaveBeenCalledWith("7", { index: 3 })
  })

  it("bookmarks_move passes both parentId and index when both provided", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "9", parentId: "1", index: 0 })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).bookmarks.move).toHaveBeenCalledWith("9", { parentId: "1", index: 0 })
  })

  it("bookmarks_move rejects a non-numeric id", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "not-a-number", parentId: "2" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/invalid id/i)
    expect((chrome as any).bookmarks.move).not.toHaveBeenCalled()
  })

  it("bookmarks_move rejects a non-numeric parentId", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "5", parentId: "abc" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/invalid parentId/i)
    expect((chrome as any).bookmarks.move).not.toHaveBeenCalled()
  })

  it("bookmarks_move with no dest fields still calls chrome.bookmarks.move with empty dest", async () => {
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "3" })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).bookmarks.move).toHaveBeenCalledWith("3", {})
  })

  it("bookmarks_move surfaces chrome.bookmarks.move errors as isError results", async () => {
    ;(globalThis as any).chrome.bookmarks.move = vi.fn(async () => {
      throw new Error("Cannot move to that location")
    })
    const { LIBRARY_TOOL_HANDLERS } = await import("../src/background/library-tools")
    const r = await LIBRARY_TOOL_HANDLERS.bookmarks_move({ id: "5", parentId: "2" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/cannot move/i)
  })
})
