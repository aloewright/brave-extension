import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createWebAgentClient } from "../web/src/api"

function sse(deltas: string[]) {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(c) {
        for (const d of deltas) c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: d })}\n\n`))
        c.enqueue(enc.encode("data: [DONE]\n\n"))
        c.close()
      }
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  )
}

describe("web agent client", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it("lists models from same-origin /api", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ id: "m1", label: "M1", kind: "workers-ai" }] }), { status: 200 })
    )
    const models = await createWebAgentClient().listModels()
    expect(models[0]!.id).toBe("m1")
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/models")
  })

  it("streams deltas", async () => {
    fetchMock.mockResolvedValueOnce(sse(["Hel", "lo"]))
    const out: string[] = []
    for await (const d of createWebAgentClient().streamMessage("s1", { content: "hi" })) out.push(d)
    expect(out.join("")).toBe("Hello")
  })
})
