import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  document.body.innerHTML = `
    <main>
      <h1>Example Page</h1>
      <button id="save">Save changes</button>
      <input id="name" aria-label="Name" value="Aloe" />
      <a href="https://example.com/docs">Docs</a>
    </main>
  `
  Object.defineProperty(HTMLElement.prototype, "innerText", {
    configurable: true,
    get() {
      return this.textContent || ""
    }
  })
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    width: 100,
    height: 30,
    top: 20,
    left: 10,
    right: 110,
    bottom: 50,
    toJSON: () => ({})
  })) as any
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    tabs: {
      query: vi.fn(async () => [{ id: 42, url: "https://example.com", title: "Example", windowId: 7 }]),
      get: vi.fn(async () => ({ id: 42, url: "https://example.com", title: "Example", windowId: 7 })),
      update: vi.fn(async (_id: number, patch: any) => ({ id: 42, ...patch })),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn()
      }
    },
    scripting: {
      executeScript: vi.fn(async ({ func, args }: any) => [{ result: (func as any).apply(null, args || []) }])
    }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("browser_observe", () => {
  it("returns capped visible page nodes with refs and selectors", async () => {
    const { DOM_TOOL_HANDLERS } = await import("../src/background/dom-tools")
    const result = await DOM_TOOL_HANDLERS.browser_observe({ tabId: 42, maxNodes: 2, maxText: 80 })
    expect(result.isError).toBe(false)
    const observation = JSON.parse(result.content[0]!.text || "{}")
    expect(observation.url).toBe("https://example.com")
    expect(observation.title).toBe("Example")
    expect(observation.nodes).toHaveLength(2)
    expect(observation.nodes[0]).toMatchObject({
      ref: "e1",
      role: "heading"
    })
    expect(observation.limits.nodesTruncated).toBe(true)
    expect(observation.visibleText).toContain("Example Page")
  })

  it("returns a post-action observation for click", async () => {
    const { DOM_TOOL_HANDLERS } = await import("../src/background/dom-tools")
    const result = await DOM_TOOL_HANDLERS.click({ tabId: 42, selector: "#save" })
    expect(result.isError).toBe(false)
    const body = JSON.parse(result.content[0]!.text || "{}")
    expect(body.ok).toBe(true)
    expect(body.observation.nodes.length).toBeGreaterThan(0)
  })
})
