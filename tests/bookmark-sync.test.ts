import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { pushSnapshot } from "../src/background/bookmark-sync"
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
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe("https://sidebar.pdx.software/api/bookmarks/snapshot")
    const body = JSON.parse(String((init as RequestInit).body)) as { bookmarks: { id: string; isFavorite?: boolean }[] }
    expect(body.bookmarks).toHaveLength(1)
    expect(body.bookmarks[0]!.id).toBe("b1")
    expect(body.bookmarks[0]!.isFavorite).toBe(true)  // under "Bookmarks Bar"
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
