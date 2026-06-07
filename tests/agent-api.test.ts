import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createAgentApiClient } from "../src/lib/agent-api"

const cfg = { baseUrl: "https://agent.test", clientId: "cid", clientSecret: "csec" }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}
function sseResponse(deltas: string[]) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const d of deltas) c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: d })}\n\n`))
      c.enqueue(enc.encode("data: [DONE]\n\n"))
      c.close()
    }
  })
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
}

describe("agent-api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("sends Access headers and lists models", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ id: "m1", label: "M1", kind: "workers-ai" }] }))
    const client = createAgentApiClient(cfg)
    const models = await client.listModels()
    expect(models[0]!.id).toBe("m1")
    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init.headers)
    expect(headers.get("cf-access-client-id")).toBe("cid")
    expect(headers.get("cf-access-client-secret")).toBe("csec")
  })

  it("creates a session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ session: { id: "s1", title: "t" } }))
    const client = createAgentApiClient(cfg)
    const s = await client.createSession("t")
    expect(s.id).toBe("s1")
  })

  it("streams message deltas via async iterator", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(["Hel", "lo"]))
    const client = createAgentApiClient(cfg)
    const out: string[] = []
    for await (const delta of client.streamMessage("s1", { content: "hi" })) out.push(delta)
    expect(out.join("")).toBe("Hello")
  })

  it("throws on non-ok", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }))
    const client = createAgentApiClient(cfg)
    await expect(client.listModels()).rejects.toThrow()
  })
})
