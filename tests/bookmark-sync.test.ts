import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pushSnapshot } from "../src/background/bookmark-sync"
import { BOOKMARK_SNAPSHOT_KEY } from "../src/lib/bookmark-snapshot"
import { setSettings } from "../src/storage"

interface FakeNode {
  id: string
  title: string
  url?: string
  parentId?: string
  dateAdded?: number
  index?: number
  children?: FakeNode[]
}

function installChromeBookmarks(tree: FakeNode[]): void {
  ;(globalThis as unknown as { chrome: any }).chrome.bookmarks = {
    getTree: async () => tree
  }
}

function uninstallChromeBookmarks(): void {
  delete (globalThis as unknown as { chrome: any }).chrome.bookmarks
}

describe("pushSnapshot", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    uninstallChromeBookmarks()
  })

  it("skips when sidebar sync is disabled", async () => {
    installChromeBookmarks([])
    vi.stubGlobal("fetch", vi.fn())
    const r = await pushSnapshot()
    expect(r.pushed).toBe(false)
    expect(r.reason).toContain("disabled")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("skips when URL/token are not configured", async () => {
    installChromeBookmarks([])
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "",
      sidebarApiToken: ""
    })
    vi.stubGlobal("fetch", vi.fn())
    const r = await pushSnapshot()
    expect(r.pushed).toBe(false)
    expect(r.reason).toContain("not configured")
  })

  it("pulls the bookmark tree, flattens it, and POSTs /api/bookmarks/snapshot", async () => {
    installChromeBookmarks([
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            parentId: "0",
            title: "Bookmarks Bar",
            children: [
              { id: "b1", parentId: "1", title: "Example", url: "https://example.com", dateAdded: 100 }
            ]
          }
        ]
      }
    ])
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })

    const fetchMock = vi.fn(async (_url: RequestInfo | URL) =>
      new Response(JSON.stringify({ inserted: 1, updated: 0, deleted: 0, reembedded: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const r = await pushSnapshot()
    expect(r.pushed).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as unknown as [URL | RequestInfo, RequestInit]
    const url = call[0]
    const init = call[1]
    expect(String(url)).toBe("https://sidebar.pdx.software/api/bookmarks/snapshot")
    const body = JSON.parse(String(init.body)) as { bookmarks: { id: string; isFavorite?: boolean }[] }
    expect(body.bookmarks).toHaveLength(1)
    expect(body.bookmarks[0]!.id).toBe("b1")
    expect(body.bookmarks[0]!.isFavorite).toBe(true)  // under "Bookmarks Bar"
  })

  it("posts the extension's cached bookmark snapshot when one already exists", async () => {
    installChromeBookmarks([
      {
        id: "0",
        title: "",
        children: [
          { id: "browser-only", title: "Browser", url: "https://browser.example" }
        ]
      }
    ])
    await chrome.storage.local.set({
      [BOOKMARK_SNAPSHOT_KEY]: {
        pulledAt: "2026-06-14T12:00:00Z",
        bookmarks: [
          {
            id: "cached",
            url: "https://cached.example",
            title: "Cached",
            parentId: "1",
            category: "Synced",
            path: ["Synced"],
            isFavorite: false,
            dateAdded: 100,
            index: 0
          }
        ]
      }
    })
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })

    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ inserted: 1, updated: 0, deleted: 0, reembedded: 1 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    )
    vi.stubGlobal("fetch", fetchMock)

    const r = await pushSnapshot()
    expect(r.pushed).toBe(true)
    const call = fetchMock.mock.calls[0] as unknown as [URL | RequestInfo, RequestInit]
    const body = JSON.parse(String(call[1].body)) as { bookmarks: { id: string }[]; pulledAt: string }
    expect(body.pulledAt).toBe("2026-06-14T12:00:00Z")
    expect(body.bookmarks.map((bookmark) => bookmark.id)).toEqual(["cached"])
  })

  it("surfaces an error reason when the request fails", async () => {
    installChromeBookmarks([])
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "unauthorized", message: "bad" } }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    ))
    const r = await pushSnapshot()
    expect(r.pushed).toBe(false)
    expect(r.reason).toBeDefined()
  })
})
