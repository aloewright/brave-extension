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
    return new Response(JSON.stringify(r.body ?? null), {
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

  it("converts ApiError back to a plain Error subclass instance", () => {
    const err = new ApiError(500, "internal", "boom")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("ApiError")
    expect(err.code).toBe("internal")
    expect(err.status).toBe(500)
  })
})
