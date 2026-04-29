import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Tests for cookies + extensions + brave_search MCP tools (ALO-247).

beforeEach(() => {
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    cookies: {
      getAll: vi.fn(async () => []),
      set: vi.fn(async (d: any) => ({ name: d.name, value: d.value, domain: "x" })),
      remove: vi.fn(async (d: any) => ({ name: d.name, url: d.url }))
    },
    management: {
      getAll: vi.fn(async () => []),
      setEnabled: vi.fn(async () => undefined),
      uninstall: vi.fn(async () => undefined)
    },
    runtime: { id: "self-ext-id" }
  }
  // fetch stub
  ;(globalThis as any).fetch = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("MCP tools registry (ALO-247 surface)", () => {
  it("registers all 10 new tools with non-empty inputSchemas", async () => {
    const { MCPServer } = await import("../native-host/mcp-server.mjs")
    const server = new MCPServer({ logger: () => {} })
    const reply = await server._dispatch({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    const byName = new Map(reply.result.tools.map((t: any) => [t.name, t]))
    for (const n of [
      "cookies_get",
      "cookies_set",
      "cookies_remove",
      "cookies_clear",
      "extensions_list",
      "extensions_set_enabled",
      "extensions_uninstall",
      "profiles_apply",
      "groups_apply",
      "brave_search"
    ]) {
      const t = byName.get(n) as any
      expect(t, `missing ${n}`).toBeTruthy()
      expect(t.inputSchema?.type).toBe("object")
      expect(typeof t.description).toBe("string")
      expect(t.description.length).toBeGreaterThan(0)
    }
  })
})

describe("cookies tools (consent gate)", () => {
  it("returns error when consent gate is false", async () => {
    const { COOKIES_TOOL_HANDLERS } = await import("../src/background/cookies-tools")
    for (const name of ["cookies_get", "cookies_set", "cookies_remove", "cookies_clear"]) {
      const r = await COOKIES_TOOL_HANDLERS[name]({ url: "https://e", name: "x", value: "v" })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/consent/i)
    }
    expect((chrome as any).cookies.getAll).not.toHaveBeenCalled()
    expect((chrome as any).cookies.set).not.toHaveBeenCalled()
    expect((chrome as any).cookies.remove).not.toHaveBeenCalled()
  })

  it("calls chrome.cookies.* when gate is true", async () => {
    await chrome.storage.local.set({ "settings.cookies.allowAll": true })
    const { COOKIES_TOOL_HANDLERS } = await import("../src/background/cookies-tools")

    const got = await COOKIES_TOOL_HANDLERS.cookies_get({ domain: "example.com" })
    expect(got.isError).toBeFalsy()
    expect((chrome as any).cookies.getAll).toHaveBeenCalledWith({ domain: "example.com" })

    const setR = await COOKIES_TOOL_HANDLERS.cookies_set({
      url: "https://example.com",
      name: "n",
      value: "v",
      secure: true,
      sameSite: "lax"
    })
    expect(setR.isError).toBeFalsy()
    expect((chrome as any).cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com", name: "n", value: "v", secure: true, sameSite: "lax" })
    )

    const rmR = await COOKIES_TOOL_HANDLERS.cookies_remove({ url: "https://example.com", name: "n" })
    expect(rmR.isError).toBeFalsy()
    expect((chrome as any).cookies.remove).toHaveBeenCalled()
  })

  it("cookies_clear iterates getAll results and removes each", async () => {
    await chrome.storage.local.set({ "settings.cookies.allowAll": true })
    ;(chrome as any).cookies.getAll = vi.fn(async () => [
      { name: "a", domain: "example.com", path: "/", secure: false },
      { name: "b", domain: ".example.com", path: "/x", secure: true }
    ])
    const { COOKIES_TOOL_HANDLERS } = await import("../src/background/cookies-tools")
    const r = await COOKIES_TOOL_HANDLERS.cookies_clear({ domain: "example.com" })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).cookies.remove).toHaveBeenCalledTimes(2)
    const body = JSON.parse(r.content[0].text!)
    expect(body.scanned).toBe(2)
  })
})

describe("extensions tools", () => {
  it("extensions_list shapes management.getAll output", async () => {
    ;(chrome as any).management.getAll = vi.fn(async () => [
      {
        id: "abc",
        name: "Foo",
        enabled: true,
        type: "extension",
        version: "1.2.3",
        description: "d",
        mayDisable: true
      }
    ])
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    const r = await EXTENSIONS_TOOL_HANDLERS.extensions_list({})
    expect(r.isError).toBeFalsy()
    const arr = JSON.parse(r.content[0].text!)
    expect(arr[0]).toEqual({
      id: "abc",
      name: "Foo",
      enabled: true,
      type: "extension",
      version: "1.2.3",
      description: "d"
    })
  })

  it("extensions_set_enabled requires id and boolean", async () => {
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    expect((await EXTENSIONS_TOOL_HANDLERS.extensions_set_enabled({})).isError).toBe(true)
    expect(
      (await EXTENSIONS_TOOL_HANDLERS.extensions_set_enabled({ id: "x" })).isError
    ).toBe(true)
    const ok = await EXTENSIONS_TOOL_HANDLERS.extensions_set_enabled({ id: "x", enabled: false })
    expect(ok.isError).toBeFalsy()
    expect((chrome as any).management.setEnabled).toHaveBeenCalledWith("x", false)
  })

  it("extensions_uninstall blocked when gate is false", async () => {
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    const r = await EXTENSIONS_TOOL_HANDLERS.extensions_uninstall({ id: "x" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/disabled in Settings/i)
    expect((chrome as any).management.uninstall).not.toHaveBeenCalled()
  })

  it("extensions_uninstall succeeds when gate is true", async () => {
    await chrome.storage.local.set({ "settings.allowExtensionUninstall": true })
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    const r = await EXTENSIONS_TOOL_HANDLERS.extensions_uninstall({ id: "abc" })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).management.uninstall).toHaveBeenCalledWith(
      "abc",
      expect.objectContaining({ showConfirmDialog: true })
    )
  })

  it("profiles_apply enables ids in profile, disables others", async () => {
    await chrome.storage.local.set({
      lx_profiles: [{ id: "p1", name: "Lean", extensionIds: ["a", "b"] }]
    })
    ;(chrome as any).management.getAll = vi.fn(async () => [
      { id: "a", enabled: false, type: "extension", mayDisable: true },
      { id: "b", enabled: true, type: "extension", mayDisable: true },
      { id: "c", enabled: true, type: "extension", mayDisable: true },
      { id: "theme1", enabled: true, type: "theme", mayDisable: true },
      { id: "self-ext-id", enabled: true, type: "extension", mayDisable: true }
    ])
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    const r = await EXTENSIONS_TOOL_HANDLERS.profiles_apply({ profileId: "p1" })
    expect(r.isError).toBeFalsy()
    const calls = ((chrome as any).management.setEnabled as any).mock.calls
    // a was disabled → enable; b was already enabled (skip); c was enabled → disable.
    // theme + self-ext-id skipped.
    const map = new Map(calls.map((c: any[]) => [c[0], c[1]]))
    expect(map.get("a")).toBe(true)
    expect(map.get("c")).toBe(false)
    expect(map.has("b")).toBe(false)
    expect(map.has("theme1")).toBe(false)
    expect(map.has("self-ext-id")).toBe(false)
  })

  it("profiles_apply errors on missing profile", async () => {
    await chrome.storage.local.set({ lx_profiles: [] })
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    const r = await EXTENSIONS_TOOL_HANDLERS.profiles_apply({ profileId: "nope" })
    expect(r.isError).toBe(true)
  })

  it("groups_apply flips listed extensions to group.enabled", async () => {
    await chrome.storage.local.set({
      lx_groups: [{ id: "g1", name: "Dev", extensionIds: ["x", "y"], enabled: false }]
    })
    const { EXTENSIONS_TOOL_HANDLERS } = await import("../src/background/extensions-tools")
    const r = await EXTENSIONS_TOOL_HANDLERS.groups_apply({ groupId: "g1" })
    expect(r.isError).toBeFalsy()
    expect((chrome as any).management.setEnabled).toHaveBeenCalledWith("x", false)
    expect((chrome as any).management.setEnabled).toHaveBeenCalledWith("y", false)
  })
})

describe("brave_search", () => {
  it("returns error when API key missing", async () => {
    const { SEARCH_TOOL_HANDLERS } = await import("../src/background/search-tools")
    const r = await SEARCH_TOOL_HANDLERS.brave_search({ query: "test" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/API key/i)
    expect((globalThis as any).fetch).not.toHaveBeenCalled()
  })

  it("hits the Brave HTTPS endpoint with X-Subscription-Token", async () => {
    await chrome.storage.local.set({ "settings.braveSearchApiKey": "sekret" })
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ web: { results: [{ title: "hi" }] } })
    }))
    const { SEARCH_TOOL_HANDLERS } = await import("../src/background/search-tools")
    const r = await SEARCH_TOOL_HANDLERS.brave_search({ query: "claude code", count: 5 })
    expect(r.isError).toBeFalsy()
    const call = ((globalThis as any).fetch as any).mock.calls[0]
    const url: string = call[0]
    expect(url).toContain("https://api.search.brave.com/res/v1/web/search")
    expect(url).toContain("q=claude+code")
    expect(url).toContain("count=5")
    expect(call[1].headers["X-Subscription-Token"]).toBe("sekret")
    expect(r.content[0].text).toContain("hi")
  })

  it("surfaces non-2xx as error", async () => {
    await chrome.storage.local.set({ "settings.braveSearchApiKey": "sekret" })
    ;(globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized"
    }))
    const { SEARCH_TOOL_HANDLERS } = await import("../src/background/search-tools")
    const r = await SEARCH_TOOL_HANDLERS.brave_search({ query: "x" })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/401/)
  })

  it("requires query", async () => {
    const { SEARCH_TOOL_HANDLERS } = await import("../src/background/search-tools")
    const r = await SEARCH_TOOL_HANDLERS.brave_search({})
    expect(r.isError).toBe(true)
  })
})
