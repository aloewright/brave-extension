/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, createApiClient } from "../../web/src/api"

interface MockResponseInit { status?: number; body?: unknown }

function mockFetchOnce(responses: MockResponseInit[]): { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = []
  let i = 0
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(input), init })
    const r = responses[i++] ?? { status: 200, body: {} }
    const body = r.status === 204 ? null : JSON.stringify(r.body ?? null)
    return new Response(body, {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" }
    })
  }))
  return { calls }
}

describe("createApiClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("sends X-Sidebar-Token on every request", async () => {
    const { calls } = mockFetchOnce([{ status: 200, body: { ok: true } }])
    const client = createApiClient("tok")
    await client.health()
    expect(calls).toHaveLength(1)
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get("x-sidebar-token")).toBe("tok")
  })

  it("parses search results", async () => {
    const { calls } = mockFetchOnce([{
      status: 200,
      body: { results: [{ type: "link", id: "l1", chunkIndex: 0, score: 0.9, title: "t", snippet: "s", createdAt: 1 }] }
    }])
    const client = createApiClient("tok")
    const out = await client.search("hi", { types: ["link"], limit: 5 })
    expect(out.results).toHaveLength(1)
    expect(out.results[0]!.type).toBe("link")
    expect(calls[0]!.init.method).toBe("POST")
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get("content-type")).toBe("application/json")
  })

  it("throws ApiError on 401 with code=unauthorized", async () => {
    mockFetchOnce([{ status: 401, body: { error: { code: "unauthorized", message: "bad token" } } }])
    const client = createApiClient("bad")
    await expect(client.conversations.list()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      code: "unauthorized"
    })
  })

  it("encodes path parameters and query strings", async () => {
    const { calls } = mockFetchOnce([{ status: 200, body: {} }, { status: 200, body: { conversations: [] } }])
    const client = createApiClient("tok")
    await client.conversations.get("hello world/with slash")
    expect(calls[0]!.url).toBe("/api/conversations/hello%20world%2Fwith%20slash")
    await client.conversations.list({ backend: "claude", limit: 5 })
    expect(calls[1]!.url).toBe("/api/conversations?backend=claude&limit=5")
  })

  it("returns deterministic blobUrl strings", () => {
    const client = createApiClient("tok")
    expect(client.recordings.blobUrl("abc")).toBe("/api/recordings/abc/blob")
    expect(client.pdfs.blobUrl("xyz")).toBe("/api/pdfs/xyz/blob")
  })

  it("supports highlight list, update, and delete requests", async () => {
    const { calls } = mockFetchOnce([
      { status: 200, body: { highlights: [] } },
      { status: 200, body: { id: "h1", text: "updated" } },
      { status: 204, body: null }
    ])
    const client = createApiClient("tok")
    await client.highlights.list({ limit: 10 })
    await client.highlights.update("h1", { text: "updated", tags: ["note"] })
    await client.highlights.delete("h1")

    expect(calls[0]!.url).toBe("/api/highlights?limit=10")
    expect(calls[1]!.url).toBe("/api/highlights/h1")
    expect(calls[1]!.init.method).toBe("PATCH")
    expect(calls[2]!.init.method).toBe("DELETE")
  })

  it("supports scrape run and job requests", async () => {
    const { calls } = mockFetchOnce([
      { status: 200, body: { scrapes: [] } },
      { status: 200, body: { scrape: { id: "s1" } } },
      { status: 201, body: { scrape: { id: "s1" } } },
      { status: 200, body: { jobs: [] } },
      { status: 201, body: { job: { id: "j1" } } },
      { status: 200, body: { job: { id: "j1" }, scrape: { id: "s2" } } },
      { status: 204, body: null },
      { status: 204, body: null }
    ])
    const client = createApiClient("tok")

    await client.scrapes.listRuns({ limit: 12, jobId: "j1" })
    await client.scrapes.getRun("s1")
    await client.scrapes.runUrl("https://example.com")
    await client.scrapes.listJobs()
    await client.scrapes.createJob({ url: "https://example.com/feed", scheduleType: "cron", cron: "0 * * * *" })
    await client.scrapes.runJob("j1")
    await client.scrapes.deleteRun("s1")
    await client.scrapes.deleteJob("j1")

    expect(calls[0]!.url).toBe("/api/scrapes/runs?jobId=j1&limit=12")
    expect(calls[1]!.url).toBe("/api/scrapes/runs/s1")
    expect(calls[2]!.url).toBe("/api/scrapes/run")
    expect(calls[2]!.init.method).toBe("POST")
    expect(calls[3]!.url).toBe("/api/scrapes/jobs")
    expect(calls[4]!.init.method).toBe("POST")
    expect(calls[5]!.url).toBe("/api/scrapes/jobs/j1/run")
    expect(calls[6]!.url).toBe("/api/scrapes/runs/s1")
    expect(calls[6]!.init.method).toBe("DELETE")
    expect(calls[7]!.init.method).toBe("DELETE")
  })

  it("converts ApiError back to a plain Error subclass instance", () => {
    const err = new ApiError(500, "internal", "boom")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("ApiError")
    expect(err.code).toBe("internal")
    expect(err.status).toBe(500)
  })
})
