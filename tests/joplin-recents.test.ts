import { describe, it, expect, beforeEach, vi } from "vitest"
import type { RecentClip } from "../src/lib/joplin-types"

// Mock @plasmohq/storage. The real implementation persists to chrome.storage;
// for tests we back it with an in-memory map. Reset between tests.
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

import { getRecentClips, prependRecentClip, clearRecentClips } from "../src/lib/joplin-recents"

function makeClip(id: string, offsetSecs = 0): RecentClip {
  return {
    id,
    joplinNoteId: `note-${id}`,
    title: `Clip ${id}`,
    mode: "simplified",
    sourceUrl: `http://example/${id}`,
    createdAt: new Date(1_700_000_000_000 + offsetSecs * 1000).toISOString(),
    joplinUrl: `joplin://x-callback-url/openNote?id=note-${id}`
  }
}

describe("joplin-recents", () => {
  beforeEach(() => {
    mem.clear()
  })

  it("getRecentClips returns [] when storage is empty", async () => {
    expect(await getRecentClips()).toEqual([])
  })

  it("prependRecentClip stores the clip on first call", async () => {
    await prependRecentClip(makeClip("a"))
    expect((await getRecentClips()).map((c) => c.id)).toEqual(["a"])
  })

  it("prependRecentClip puts newest first", async () => {
    await prependRecentClip(makeClip("a"))
    await prependRecentClip(makeClip("b"))
    await prependRecentClip(makeClip("c"))
    expect((await getRecentClips()).map((c) => c.id)).toEqual(["c", "b", "a"])
  })

  it("prependRecentClip caps at 50, dropping the oldest", async () => {
    for (let i = 0; i < 60; i++) {
      await prependRecentClip(makeClip(`${i}`, i))
    }
    const stored = await getRecentClips()
    expect(stored.length).toBe(50)
    // Newest 50 retained — ids 59 down to 10. id "9" should NOT be present.
    expect(stored[0].id).toBe("59")
    expect(stored.find((c) => c.id === "9")).toBeUndefined()
  })

  it("clearRecentClips empties the list", async () => {
    await prependRecentClip(makeClip("a"))
    await clearRecentClips()
    expect(await getRecentClips()).toEqual([])
  })
})
