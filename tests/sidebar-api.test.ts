import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, createSidebarApiClient } from "../src/lib/sidebar-api"

interface MockResp { status?: number; body?: unknown }

function mockFetch(responses: MockResp[]): { calls: { url: string; init: RequestInit }[] } {
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

const BASE = "https://sidebar.pdx.software"

describe("sidebar-api client", () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it("strips trailing slashes from baseUrl and appends /api/...", async () => {
    const { calls } = mockFetch([{ body: { ok: true } }])
    const client = createSidebarApiClient("tok", `${BASE}///`)
    await client.health()
    expect(calls[0]!.url).toBe(`${BASE}/api/health`)
  })

  it("sends X-Sidebar-Token on every JSON request", async () => {
    const { calls } = mockFetch([{ body: { ok: true } }])
    const client = createSidebarApiClient("tok", BASE)
    await client.health()
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get("x-sidebar-token")).toBe("tok")
  })

  it("conversations.upsert posts JSON with content-type set", async () => {
    const { calls } = mockFetch([{ body: { id: "abc", chunkCount: 2 } }])
    const client = createSidebarApiClient("tok", BASE)
    const out = await client.conversations.upsert({
      backend: "claude",
      title: "t",
      content_text: "x",
      started_at: 1,
      message_count: 2
    })
    expect(out).toEqual({ id: "abc", chunkCount: 2 })
    expect(calls[0]!.url).toBe(`${BASE}/api/conversations`)
    expect(calls[0]!.init.method).toBe("POST")
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe("application/json")
  })

  it("bookmarks.snapshot fills pulledAt when omitted", async () => {
    const { calls } = mockFetch([{ body: { inserted: 1, updated: 0, deleted: 0, reembedded: 1 } }])
    const client = createSidebarApiClient("tok", BASE)
    await client.bookmarks.snapshot([{ id: "b1", url: "https://x", title: "x", category: "Unfiled" }])
    const body = JSON.parse(String(calls[0]!.init.body)) as { pulledAt: string }
    expect(typeof body.pulledAt).toBe("string")
    expect(body.pulledAt.length).toBeGreaterThan(0)
  })

  it("recordings.upload sends multipart/form-data with metadata + file", async () => {
    const { calls } = mockFetch([{ body: { id: "r1", status: "pending", r2_key: "recordings/r1.mp4", workflow_id: null } }])
    const client = createSidebarApiClient("tok", BASE)
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" })
    const out = await client.recordings.upload(blob, { id: "r1", filename: "r1.mp4", duration_ms: 5 })
    expect(out.id).toBe("r1")
    expect(calls[0]!.init.method).toBe("POST")
    expect(calls[0]!.init.body).toBeInstanceOf(FormData)
    const form = calls[0]!.init.body as FormData
    expect(typeof form.get("metadata")).toBe("string")
    expect(form.get("file")).toBeInstanceOf(Blob)
    // Token sent on multipart requests too.
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get("x-sidebar-token")).toBe("tok")
  })

  it("agent.chat posts a compact browser observation", async () => {
    const { calls } = mockFetch([
      {
        body: {
          session: { id: "s1", objective: "save", status: "planning", nextStep: "observe", compactSummary: "", tokenEstimate: 1, memoryRefs: [], lastObservation: null, pendingConsent: null, createdAt: "now", updatedAt: "now" },
          reply: "Plan",
          plan: { objective: "save", status: "planning", nextStep: "observe", stopCondition: "done" },
          provider: "worker-deterministic",
          compacted: false
        }
      }
    ])
    const client = createSidebarApiClient("tok", BASE)
    const out = await client.agent.chat({
      sessionId: "s1",
      message: "save",
      observation: { title: "Example", nodes: [] },
      cloudUse: { planning: true, vision: false, ocr: false }
    })
    expect(out.provider).toBe("worker-deterministic")
    expect(calls[0]!.url).toBe(`${BASE}/api/agent/chat`)
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      sessionId: "s1",
      message: "save",
      observation: { title: "Example" },
      cloudUse: { planning: true }
    })
  })

  it("agent.chat omits cloudUse from body when not provided (backward compat)", async () => {
    const { calls } = mockFetch([
      {
        body: {
          session: { id: "s1", objective: "save", status: "planning", nextStep: "observe", compactSummary: "", tokenEstimate: 1, memoryRefs: [], lastObservation: null, pendingConsent: null, createdAt: "now", updatedAt: "now" },
          reply: "Plan",
          plan: { objective: "save", status: "planning", nextStep: "observe", stopCondition: "done" },
          provider: "worker-deterministic",
          compacted: false
        }
      }
    ])
    const client = createSidebarApiClient("tok", BASE)
    await client.agent.chat({
      sessionId: "s2",
      message: "do something",
    })
    const sent = JSON.parse(String(calls[0]!.init.body))
    // cloudUse key should not be present when not passed
    expect(sent).not.toHaveProperty("cloudUse")
  })

  it("agent.chat sends cloudUse with all-false flags when explicitly provided", async () => {
    const { calls } = mockFetch([
      {
        body: {
          session: { id: "s1", objective: "save", status: "planning", nextStep: "observe", compactSummary: "", tokenEstimate: 1, memoryRefs: [], lastObservation: null, pendingConsent: null, createdAt: "now", updatedAt: "now" },
          reply: "Plan",
          plan: { objective: "save", status: "planning", nextStep: "observe", stopCondition: "done" },
          provider: "worker-deterministic",
          compacted: false
        }
      }
    ])
    const client = createSidebarApiClient("tok", BASE)
    await client.agent.chat({
      sessionId: "s3",
      message: "look around",
      cloudUse: { planning: false, vision: false, ocr: false },
    })
    const sent = JSON.parse(String(calls[0]!.init.body))
    expect(sent.cloudUse).toEqual({ planning: false, vision: false, ocr: false })
  })

  it("agent.chat forwards partial cloudUse object as-is", async () => {
    const { calls } = mockFetch([
      {
        body: {
          session: { id: "s1", objective: "save", status: "planning", nextStep: "observe", compactSummary: "", tokenEstimate: 1, memoryRefs: [], lastObservation: null, pendingConsent: null, createdAt: "now", updatedAt: "now" },
          reply: "Plan",
          plan: { objective: "save", status: "planning", nextStep: "observe", stopCondition: "done" },
          provider: "cloudflare-ai-gateway",
          compacted: false
        }
      }
    ])
    const client = createSidebarApiClient("tok", BASE)
    await client.agent.chat({
      sessionId: "s4",
      message: "check page",
      cloudUse: { planning: true },
    })
    const sent = JSON.parse(String(calls[0]!.init.body))
    expect(sent.cloudUse).toMatchObject({ planning: true })
  })

  it("agent.chat sends to /api/agent/chat regardless of cloudUse setting", async () => {
    const { calls } = mockFetch([
      {
        body: {
          session: { id: "s1", objective: "x", status: "planning", nextStep: "observe", compactSummary: "", tokenEstimate: 1, memoryRefs: [], lastObservation: null, pendingConsent: null, createdAt: "now", updatedAt: "now" },
          reply: "ok",
          plan: { objective: "x", status: "planning", nextStep: "observe", stopCondition: "done" },
          provider: "cloudflare-ai-gateway",
          compacted: false
        }
      }
    ])
    const client = createSidebarApiClient("tok", BASE)
    await client.agent.chat({ message: "ping", cloudUse: { planning: true, vision: true, ocr: true } })
    expect(calls[0]!.url).toBe(`${BASE}/api/agent/chat`)
    expect(calls[0]!.init.method).toBe("POST")
  })

  it("throws ApiError on non-2xx with the server's code/message", async () => {
    mockFetch([{ status: 401, body: { error: { code: "unauthorized", message: "bad token" } } }])
    const client = createSidebarApiClient("bad", BASE)
    await expect(client.health()).rejects.toMatchObject({
      name: "ApiError", status: 401, code: "unauthorized"
    })
  })

  it("ApiError is an Error subclass", () => {
    const err = new ApiError(500, "internal", "boom")
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe("internal")
  })
})
