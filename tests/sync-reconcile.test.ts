import { describe, it, expect, vi } from "vitest"
import {
  reconcileLinks,
  bookmarkTombstoneAdditions,
  runSyncReconcile,
  type LocalLink,
  type ServerLink,
  type SyncDeps
} from "../src/lib/sync-reconcile"

describe("reconcileLinks", () => {
  it("removes a previously-synced local link that the server deleted", () => {
    const local: LocalLink[] = [{ id: "a", url: "https://a", title: "A" }]
    const server: ServerLink[] = []
    const plan = reconcileLinks(local, server)
    expect(plan.removeLocally).toEqual([{ id: "a", url: "https://a", title: "A" }])
    expect(plan.keepLocal).toEqual([])
    expect(plan.pushUp).toEqual([])
  })

  it("pushes up local-only links (no id) and keeps them", () => {
    const local: LocalLink[] = [{ url: "https://new", title: "New" }]
    const plan = reconcileLinks(local, [])
    expect(plan.pushUp).toEqual([{ url: "https://new", title: "New" }])
    expect(plan.keepLocal).toEqual([{ url: "https://new", title: "New" }])
    expect(plan.removeLocally).toEqual([])
  })

  it("adds server-only items to keepLocal", () => {
    const server: ServerLink[] = [{ id: "s1", url: "https://s", title: "S", tags: ["x"] }]
    const plan = reconcileLinks([], server)
    expect(plan.keepLocal).toContainEqual({ id: "s1", url: "https://s", title: "S", tags: ["x"] })
    expect(plan.removeLocally).toEqual([])
    expect(plan.pushUp).toEqual([])
  })

  it("keeps a matched item once (no duplicates)", () => {
    const local: LocalLink[] = [{ id: "m", url: "https://m", title: "M" }]
    const server: ServerLink[] = [{ id: "m", url: "https://m", title: "M" }]
    const plan = reconcileLinks(local, server)
    expect(plan.keepLocal).toEqual([{ id: "m", url: "https://m", title: "M" }])
    expect(plan.removeLocally).toEqual([])
    expect(plan.pushUp).toEqual([])
  })
})

describe("bookmarkTombstoneAdditions", () => {
  it("returns lastSynced ids missing from server and nothing else", () => {
    expect(bookmarkTombstoneAdditions(["a", "b", "c"], ["a", "c"])).toEqual(["b"])
    expect(bookmarkTombstoneAdditions(["a"], ["a"])).toEqual([])
    expect(bookmarkTombstoneAdditions([], ["a"])).toEqual([])
  })
})

describe("runSyncReconcile", () => {
  function makeDeps(over: Partial<SyncDeps>): SyncDeps {
    return {
      getLocalLinks: vi.fn(async () => []),
      setLocalLinks: vi.fn(async () => {}),
      listServerLinks: vi.fn(async () => []),
      upsertLink: vi.fn(async () => ({ id: "generated" })),
      removeServerLink: vi.fn(async () => {}),
      getBrowserBookmarkIds: vi.fn(async () => []),
      listServerBookmarkIds: vi.fn(async () => []),
      getLastSyncedBookmarkIds: vi.fn(async () => []),
      setLastSyncedBookmarkIds: vi.fn(async () => {}),
      addBookmarkTombstones: vi.fn(async () => {}),
      ...over
    }
  }

  it("removes server-deleted links, upserts local-only links, and adds tombstones", async () => {
    const setLocalLinks = vi.fn(async (_links: LocalLink[]) => {})
    const upsertLink = vi.fn(async (_l: LocalLink) => ({ id: "new-id" }))
    const addBookmarkTombstones = vi.fn(async (_ids: string[]) => {})
    const deps = makeDeps({
      getLocalLinks: async () => [
        { id: "gone", url: "https://gone", title: "Gone" },
        { url: "https://local", title: "Local" }
      ],
      listServerLinks: async () => [],
      setLocalLinks,
      upsertLink,
      listServerBookmarkIds: async () => ["keep"],
      getLastSyncedBookmarkIds: async () => ["keep", "deleted"],
      addBookmarkTombstones
    })

    await runSyncReconcile(deps)

    expect(upsertLink).toHaveBeenCalledWith({ url: "https://local", title: "Local" })
    const saved = setLocalLinks.mock.calls[0]![0]
    expect(saved.find((l) => l.id === "gone")).toBeUndefined()
    expect(saved).toContainEqual({ id: "new-id", url: "https://local", title: "Local" })
    expect(addBookmarkTombstones).toHaveBeenCalledWith(["deleted"])
  })
})
