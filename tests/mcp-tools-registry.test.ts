import { afterEach, beforeEach, describe, expect, it } from "vitest"

let MCPServer: any
let server: any

beforeEach(async () => {
  MCPServer = (await import("../native-host/mcp-server.mjs")).MCPServer
  server = new MCPServer({ logger: () => {} })
})

afterEach(() => {
  try {
    server.stop()
  } catch {
    /* ignore */
  }
})

const EXPECTED_TOOLS = [
  "echo",
  "tabs_list",
  "query_selector",
  "click",
  "type",
  "scroll_to",
  "wait_for_selector",
  "screenshot",
  "screenshot_element",
  "get_dom",
  "eval_js",
  "list_references",
  "get_reference",
  "clear_references",
  "bookmarks_search",
  "bookmarks_create",
  "bookmarks_remove",
  "bookmarks_move",
  "links_list",
  "links_add",
  "links_remove",
  "captures_list",
  "captures_get",
  "cookies_get",
  "cookies_set",
  "cookies_remove",
  "cookies_clear",
  "extensions_list",
  "extensions_set_enabled",
  "extensions_uninstall",
  "profiles_list",
  "profiles_apply",
  "groups_list",
  "groups_apply",
  "brave_search"
]

describe("MCP tools registry", () => {
  it("tools/list includes every expected tool with a non-empty inputSchema", async () => {
    const reply = await server._dispatch({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    const byName = new Map(reply.result.tools.map((t: any) => [t.name, t]))
    for (const name of EXPECTED_TOOLS) {
      const t = byName.get(name) as any
      expect(t, `tool ${name} missing`).toBeTruthy()
      expect(t.inputSchema).toBeTruthy()
      expect(t.inputSchema.type).toBe("object")
      expect(typeof t.description).toBe("string")
      expect(t.description.length).toBeGreaterThan(0)
    }
  })

  it("query_selector forwards args through the bridge and returns its result", async () => {
    const calls: any[] = []
    server.setToolRequestBridge(async (name: string, args: any) => {
      calls.push({ name, args })
      return { content: [{ type: "text", text: `ok:${name}` }], isError: false }
    })
    const reply = await server._dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "query_selector", arguments: { selector: "h1", all: true } }
    })
    expect(calls).toEqual([
      { name: "query_selector", args: { selector: "h1", all: true } }
    ])
    expect(reply.result.isError).toBe(false)
    expect(reply.result.content[0].text).toBe("ok:query_selector")
  })

  it("wait_for_selector forwards timeoutMs through the bridge", async () => {
    let received: any = null
    server.setToolRequestBridge(async (_name: string, args: any) => {
      received = args
      return { content: [{ type: "text", text: "found" }], isError: false }
    })
    await server._dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "wait_for_selector",
        arguments: { selector: ".loaded", timeoutMs: 1234 }
      }
    })
    expect(received).toEqual({ selector: ".loaded", timeoutMs: 1234 })
  })

  it("list_references / get_reference / clear_references operate on host resources", async () => {
    server.upsertResource("ai-dev://reference/abc", {
      name: "Abc Ref",
      description: "fixture",
      payload: { hello: "world" }
    })
    server.upsertResource("ai-dev://other/xyz", {
      name: "Other",
      payload: { not: "a reference" }
    })

    // list_references — only ai-dev://reference/* entries.
    const list = await server._dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "list_references", arguments: {} }
    })
    const refs = JSON.parse(list.result.content[0].text)
    expect(refs).toHaveLength(1)
    expect(refs[0].id).toBe("abc")

    // get_reference — by bare id.
    const got = await server._dispatch({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_reference", arguments: { id: "abc" } }
    })
    expect(got.result.isError).toBe(false)
    expect(got.result.content[0].text).toContain("hello")

    // get_reference — by full uri.
    const got2 = await server._dispatch({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "get_reference", arguments: { id: "ai-dev://reference/abc" } }
    })
    expect(got2.result.isError).toBe(false)

    // get_reference — missing.
    const miss = await server._dispatch({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_reference", arguments: { id: "nope" } }
    })
    expect(miss.result.isError).toBe(true)

    // clear_references — only removes the references; "other" survives.
    const cleared = await server._dispatch({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "clear_references", arguments: {} }
    })
    expect(cleared.result.isError).toBe(false)
    expect(cleared.result.content[0].text).toMatch(/cleared 1 reference/)
    expect(server.resources.has("ai-dev://reference/abc")).toBe(false)
    expect(server.resources.has("ai-dev://other/xyz")).toBe(true)
  })
})
