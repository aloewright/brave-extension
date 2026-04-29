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

beforeEach(() => {
  vi.useFakeTimers()
  bm = makeBookmarksMock()
  onCh = makeStorageOnChanged()
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    bookmarks: bm.api,
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
  it("publishes all 3 resources on startup with correct URIs", async () => {
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
      "ai-dev://library/captures",
      "ai-dev://library/links"
    ])
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
