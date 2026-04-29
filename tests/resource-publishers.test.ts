import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Resource publishers (ALO-246). We mock chrome.bookmarks + reuse the
// chrome.storage shim. We assert: initial publishes happen, debounce
// coalesces bursts, and listeners fire on bookmark/storage events.

interface BmListener {
  (...args: any[]): void
}

function makeBookmarksMock() {
  const listeners: Record<string, BmListener[]> = {
    onCreated: [],
    onRemoved: [],
    onChanged: [],
    onMoved: []
  }
  const mk = (k: keyof typeof listeners) => ({
    addListener: (fn: BmListener) => listeners[k].push(fn),
    removeListener: (fn: BmListener) => {
      const i = listeners[k].indexOf(fn)
      if (i >= 0) listeners[k].splice(i, 1)
    }
  })
  return {
    api: {
      getTree: vi.fn(async () => [
        { id: "0", title: "", children: [{ id: "1", title: "Bar", url: "https://x" }] }
      ]),
      onCreated: mk("onCreated"),
      onRemoved: mk("onRemoved"),
      onChanged: mk("onChanged"),
      onMoved: mk("onMoved")
    },
    fire: (k: keyof typeof listeners) => listeners[k].forEach((fn) => fn())
  }
}

function makeManagementMock() {
  const listeners: Record<string, BmListener[]> = {
    onInstalled: [],
    onUninstalled: [],
    onEnabled: [],
    onDisabled: []
  }
  const mk = (k: keyof typeof listeners) => ({
    addListener: (fn: BmListener) => listeners[k].push(fn),
    removeListener: (fn: BmListener) => {
      const i = listeners[k].indexOf(fn)
      if (i >= 0) listeners[k].splice(i, 1)
    }
  })
  return {
    api: {
      getAll: vi.fn(async () => [
        { id: "a", name: "A", enabled: true, type: "extension", version: "1", description: "" }
      ]),
      onInstalled: mk("onInstalled"),
      onUninstalled: mk("onUninstalled"),
      onEnabled: mk("onEnabled"),
      onDisabled: mk("onDisabled")
    },
    fire: (k: keyof typeof listeners) => listeners[k].forEach((fn) => fn())
  }
}

function makeStorageOnChanged() {
  const ls: any[] = []
  return {
    api: {
      addListener: (fn: any) => ls.push(fn),
      removeListener: (fn: any) => {
        const i = ls.indexOf(fn)
        if (i >= 0) ls.splice(i, 1)
      }
    },
    fire: (changes: any, area = "local") => ls.forEach((fn) => fn(changes, area))
  }
}

let bm: ReturnType<typeof makeBookmarksMock>
let onCh: ReturnType<typeof makeStorageOnChanged>
let mgmt: ReturnType<typeof makeManagementMock>

beforeEach(() => {
  vi.useFakeTimers()
  bm = makeBookmarksMock()
  onCh = makeStorageOnChanged()
  mgmt = makeManagementMock()
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    bookmarks: bm.api,
    management: mgmt.api,
    storage: {
      ...(globalThis as any).chrome.storage,
      onChanged: onCh.api
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("resource publishers", () => {
  it("publishes all 4 resources on startup with correct URIs", async () => {
    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: any[] = []
    startResourcePublishers({
      upsert: (uri, def) => upserts.push({ uri, name: def.name, payload: def.payload }),
      debounceMs: 10
    })
    await vi.advanceTimersByTimeAsync(20)
    // microtask flush
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    const uris = upserts.map((u) => u.uri).sort()
    expect(uris).toEqual([
      "ai-dev://bookmarks",
      "ai-dev://extensions",
      "ai-dev://library/captures",
      "ai-dev://library/links"
    ])
  })

  it("republishes ai-dev://extensions on management lifecycle events", async () => {
    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: string[] = []
    startResourcePublishers({
      upsert: (uri) => upserts.push(uri),
      debounceMs: 10
    })
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const initial = upserts.filter((u) => u === "ai-dev://extensions").length
    expect(initial).toBe(1)

    // Burst of 4 events should debounce into a single republish.
    mgmt.fire("onInstalled")
    mgmt.fire("onEnabled")
    mgmt.fire("onDisabled")
    mgmt.fire("onUninstalled")
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const after = upserts.filter((u) => u === "ai-dev://extensions").length
    expect(after).toBe(initial + 1)
  })

  it("debounces a burst of bookmark events into a single republish", async () => {
    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: any[] = []
    startResourcePublishers({
      upsert: (uri) => upserts.push(uri),
      debounceMs: 50
    })
    await vi.advanceTimersByTimeAsync(60)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const initialBookmarkPublishes = upserts.filter((u) => u === "ai-dev://bookmarks").length
    expect(initialBookmarkPublishes).toBe(1)

    // Fire 5 rapid events — debounce should coalesce to 1 extra publish.
    bm.fire("onCreated")
    bm.fire("onChanged")
    bm.fire("onMoved")
    bm.fire("onRemoved")
    bm.fire("onCreated")
    await vi.advanceTimersByTimeAsync(60)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    const total = upserts.filter((u) => u === "ai-dev://bookmarks").length
    expect(total).toBe(2)
  })

  it("trim note reports the original (untrimmed) bookmark size", async () => {
    // Build a deeply nested bookmark tree large enough to exceed the 64KB cap.
    const buildDeep = (depth: number, fanout: number): any => {
      if (depth === 0) {
        return { id: `leaf-${Math.random()}`, title: "L".repeat(200), url: "https://e" }
      }
      return {
        id: `n-${depth}-${Math.random()}`,
        title: "N",
        children: Array.from({ length: fanout }, () => buildDeep(depth - 1, fanout))
      }
    }
    const big = [{ id: "0", title: "", children: [buildDeep(5, 4)] }]
    const expectedOriginalSize = JSON.stringify(big).length
    bm.api.getTree = vi.fn(async () => big)

    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: Array<{ uri: string; description?: string }> = []
    startResourcePublishers({
      upsert: (uri, def) => upserts.push({ uri, description: def.description }),
      debounceMs: 10
    })
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    const bookmarkPub = upserts.find((u) => u.uri === "ai-dev://bookmarks")
    expect(bookmarkPub).toBeTruthy()
    expect(bookmarkPub!.description).toContain("trimmed")
    expect(bookmarkPub!.description).toContain(`${expectedOriginalSize}B`)
  })

  it("republishes links when lx_collectedLinks changes", async () => {
    const { startResourcePublishers } = await import(
      "../src/background/resource-publishers"
    )
    const upserts: any[] = []
    startResourcePublishers({
      upsert: (uri) => upserts.push(uri),
      debounceMs: 10
    })
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const initial = upserts.filter((u) => u === "ai-dev://library/links").length

    onCh.fire({ lx_collectedLinks: { newValue: [], oldValue: [] } }, "local")
    await vi.advanceTimersByTimeAsync(20)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
    const after = upserts.filter((u) => u === "ai-dev://library/links").length
    expect(after).toBe(initial + 1)

    // Unrelated key change → no extra link publish.
    onCh.fire({ unrelated: { newValue: 1 } }, "local")
    await vi.advanceTimersByTimeAsync(20)
    expect(upserts.filter((u) => u === "ai-dev://library/links").length).toBe(after)
  })
})
