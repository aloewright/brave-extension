import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { uploadRecording } from "../src/background/recorder-upload"
import { syncLink, changedLinks } from "../src/background/link-sync"
import { syncHighlight } from "../src/background/highlight-sync"
import { setSettings } from "../src/storage"

describe("uploadRecording", () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it("no-ops when sidebar sync is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const r = await uploadRecording(new Blob([new Uint8Array([1])]), { id: "x", filename: "x.mp4" })
    expect(r.uploaded).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts multipart to /api/recordings when configured", async () => {
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ id: "r1", status: "pending", r2_key: "k", workflow_id: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ))
    const r = await uploadRecording(new Blob([new Uint8Array([1, 2])]), { id: "r1", filename: "r1.mp4" })
    expect(r.uploaded).toBe(true)
    expect(r.id).toBe("r1")
    expect(r.status).toBe("pending")
  })

  it("returns a reason when the upload errors out", async () => {
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "internal", message: "boom" } }), {
        status: 500,
        headers: { "content-type": "application/json" }
      })
    ))
    const r = await uploadRecording(new Blob([new Uint8Array([1])]), { id: "x", filename: "x.mp4" })
    expect(r.uploaded).toBe(false)
    expect(r.reason).toBe("boom")
  })
})

describe("syncLink", () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it("no-ops when sidebar sync is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const r = await syncLink({ url: "https://x", title: "x" })
    expect(r).toMatchObject({ uploaded: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts JSON to /api/links when configured", async () => {
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ id: "l1", created: true, chunkCount: 1 }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    ))
    const r = await syncLink({ id: "l1", url: "https://x", title: "x", tags: ["a"] })
    expect(r).toMatchObject({ uploaded: true, id: "l1", created: true })
  })
})

describe("syncHighlight", () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.unstubAllGlobals() })

  it("no-ops when sidebar sync is disabled", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const r = await syncHighlight({ id: "h1", text: "selected text" })
    expect(r).toMatchObject({ uploaded: false })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("posts JSON to /api/highlights when configured", async () => {
    await setSettings({
      sidebarSyncEnabled: true,
      sidebarApiUrl: "https://sidebar.pdx.software",
      sidebarApiToken: "tok"
    })
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ id: "h1", created: true, chunkCount: 1 }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    ))
    const r = await syncHighlight({
      id: "h1",
      text: "selected text",
      sourceUrl: "https://example.com/post",
      sourceTitle: "Example",
      createdAt: 1_000
    })
    expect(r).toMatchObject({ uploaded: true, id: "h1", created: true })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(url).toBe("https://sidebar.pdx.software/api/highlights")
    expect(JSON.parse(String(init.body))).toMatchObject({
      text: "selected text",
      sourceUrl: "https://example.com/post",
      sourceTitle: "Example",
      source: "extension",
      createdAt: 1_000
    })
  })
})

describe("changedLinks", () => {
  it("flags new and modified links", () => {
    const prev = [{ id: "1", url: "https://a", title: "A" }, { id: "2", url: "https://b", title: "B" }]
    const next = [
      { id: "1", url: "https://a", title: "A" },           // unchanged
      { id: "2", url: "https://b-new", title: "B" },        // url changed
      { id: "3", url: "https://c", title: "C" }             // new
    ]
    const c = changedLinks(prev, next)
    expect(c.map((l) => l.id)).toEqual(["2", "3"])
  })

  it("treats links with no id as new", () => {
    const c = changedLinks([], [{ url: "https://x", title: "X" }])
    expect(c).toHaveLength(1)
  })
})
