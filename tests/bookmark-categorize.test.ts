import { describe, it, expect, vi } from "vitest"
import {
  MAX_BATCH,
  categorizeBookmarks,
  CategorizeError,
  type CategorizeRequestItem
} from "../src/lib/bookmark-categorize"

function makeFetch(impl: (req: Request) => Promise<Response>): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init)
    return impl(req)
  }) as typeof fetch
}

describe("categorizeBookmarks (ALO-469 client)", () => {
  it("short-circuits for an empty batch", async () => {
    const fetchSpy = vi.fn()
    const res = await categorizeBookmarks(
      { apiUrl: "https://x.example", apiToken: "tk", items: [] },
      fetchSpy as unknown as typeof fetch
    )
    expect(res.proposals).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("throws when items exceeds MAX_BATCH without making a request", async () => {
    const items: CategorizeRequestItem[] = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({
      id: `b${i}`,
      title: `t${i}`,
      url: `https://e/${i}`
    }))
    const fetchSpy = vi.fn()
    await expect(
      categorizeBookmarks(
        { apiUrl: "https://x.example", apiToken: "tk", items },
        fetchSpy as unknown as typeof fetch
      )
    ).rejects.toMatchObject({ name: "CategorizeError", code: "too_many_items" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("posts minimal fields and forwards the X-Sidebar-Token header", async () => {
    let observedReq: Request | null = null
    const fetchImpl = makeFetch(async (req) => {
      observedReq = req
      return new Response(
        JSON.stringify({
          proposals: [{ id: "b1", category: "Tech News", confidence: "high" }],
          model: "@cf/openai/gpt-oss-120b",
          gateway: "x"
        }),
        { headers: { "content-type": "application/json" } }
      )
    })
    const res = await categorizeBookmarks(
      {
        apiUrl: "https://sidebar.example/",
        apiToken: "tk",
        items: [
          { id: "b1", title: "Hacker News", url: "https://news.ycombinator.com", folder: "Tech" }
        ]
      },
      fetchImpl
    )
    expect(observedReq).not.toBeNull()
    expect(observedReq!.url).toBe("https://sidebar.example/api/bookmarks/categorize")
    expect(observedReq!.headers.get("X-Sidebar-Token")).toBe("tk")
    const body = (await observedReq!.json()) as {
      items: { id: string; title: string; url: string; folder?: string }[]
    }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toEqual({
      id: "b1",
      title: "Hacker News",
      url: "https://news.ycombinator.com",
      folder: "Tech",
      tags: undefined
    })
    expect(res.proposals[0]).toMatchObject({
      id: "b1",
      category: "Tech News",
      confidence: "high"
    })
  })

  it("wraps non-2xx responses as CategorizeError with status + code", async () => {
    const fetchImpl = makeFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: "too_many_items", message: "max 50, got 51" }
          }),
          { status: 413, headers: { "content-type": "application/json" } }
        )
    )
    await expect(
      categorizeBookmarks(
        {
          apiUrl: "https://x.example",
          apiToken: "tk",
          items: [{ id: "b1", title: "t", url: "u" }]
        },
        fetchImpl
      )
    ).rejects.toMatchObject({
      name: "CategorizeError",
      status: 413,
      code: "too_many_items",
      message: "max 50, got 51"
    })
  })

  it("falls through with a default message when the error body is unparseable", async () => {
    const fetchImpl = makeFetch(async () => new Response("kaboom", { status: 502 }))
    await expect(
      categorizeBookmarks(
        {
          apiUrl: "https://x.example",
          apiToken: "tk",
          items: [{ id: "b1", title: "t", url: "u" }]
        },
        fetchImpl
      )
    ).rejects.toMatchObject({
      name: "CategorizeError",
      status: 502,
      message: "categorize failed (502)"
    })
  })

  it("normalizes a trailing slash on apiUrl", async () => {
    let url = ""
    const fetchImpl = makeFetch(async (req) => {
      url = req.url
      return new Response(
        JSON.stringify({ proposals: [], model: "m", gateway: "x" }),
        { headers: { "content-type": "application/json" } }
      )
    })
    await categorizeBookmarks(
      {
        apiUrl: "https://x.example////",
        apiToken: "tk",
        items: [{ id: "b1", title: "t", url: "u" }]
      },
      fetchImpl
    )
    expect(url).toBe("https://x.example/api/bookmarks/categorize")
  })

  it("CategorizeError carries name 'CategorizeError'", () => {
    const err = new CategorizeError("nope", 401, "unauthorized")
    expect(err.name).toBe("CategorizeError")
    expect(err.status).toBe(401)
    expect(err.code).toBe("unauthorized")
  })
})
