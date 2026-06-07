import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { buildApp } from "../src/app"
import { createSession } from "../src/db"
import type { Env } from "../src/env"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret",
  "content-type": "application/json"
}

function withStreamingAgent(env: Env): Env {
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async (req: Request) => {
        const { content } = (await req.json()) as { content: string }
        const enc = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: "echo: " + content })}\n\n`))
            c.enqueue(enc.encode("data: [DONE]\n\n"))
            c.close()
          }
        })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      }
    })
  }
  return { ...env, CHAT_AGENT: ns as unknown as Env["CHAT_AGENT"] }
}

describe("streaming send-message", () => {
  it("streams SSE deltas from the DO", async () => {
    const env = withStreamingAgent(makeEnv())
    const session = await createSession(env, "svc-client-id", "chat")
    const res = await buildApp().fetch(
      new Request(`http://x/api/sessions/${session.id}/messages/stream`, {
        method: "POST",
        headers: SVC,
        body: JSON.stringify({ content: "ping" })
      }),
      env
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const text = await res.text()
    expect(text).toContain('"delta":"echo: ping"')
    expect(text).toContain("[DONE]")
  })
})
