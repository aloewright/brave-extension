import { describe, expect, it, vi } from "vitest"
import { makeEnv } from "./helpers"
// buildApp is imported from ../src/app (not ../src/index): the entry module
// statically loads agents/hono-agents, which eagerly import `cloudflare:`
// modules that the plain-vitest node loader cannot resolve. ../src/app is the
// agents-free base app and is what the deployed entry builds on.
import { buildApp } from "../src/app"
import { insertMessage } from "../src/db"
import type { Env } from "../src/env"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret"
}

function withFakeAgent(env: Env): Env {
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (_id: { name: string }) => ({
      fetch: async (req: Request) => {
        const body = (await req.json()) as { sessionId: string; content: string }
        await insertMessage(env, {
          sessionId: body.sessionId,
          role: "user",
          content: body.content,
          model: null
        })
        const msg = await insertMessage(env, {
          sessionId: body.sessionId,
          role: "assistant",
          content: `echo: ${body.content}`,
          model: "echo"
        })
        return Response.json({ message: msg })
      }
    })
  }
  return { ...env, CHAT_AGENT: ns as unknown as Env["CHAT_AGENT"] }
}

describe("sessions routes", () => {
  it("creates a session", async () => {
    const env = makeEnv()
    const res = await buildApp().fetch(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { ...SVC, "content-type": "application/json" },
        body: JSON.stringify({ title: "Hello" })
      }),
      env
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { id: string; title: string } }
    expect(body.session.title).toBe("Hello")
  })

  it("sends a message and gets an echoed assistant reply", async () => {
    const env = withFakeAgent(makeEnv())
    const created = await buildApp().fetch(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { ...SVC, "content-type": "application/json" },
        body: JSON.stringify({ title: "chat" })
      }),
      env
    )
    const { session } = (await created.json()) as { session: { id: string } }

    const sent = await buildApp().fetch(
      new Request(`http://x/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { ...SVC, "content-type": "application/json" },
        body: JSON.stringify({ content: "ping" })
      }),
      env
    )
    expect(sent.status).toBe(200)
    const out = (await sent.json()) as { message: { role: string; content: string } }
    expect(out.message.role).toBe("assistant")
    expect(out.message.content).toBe("echo: ping")
  })

  it("401s without credentials", async () => {
    const res = await buildApp().fetch(
      new Request("http://x/api/sessions", { method: "POST" }),
      makeEnv()
    )
    expect(res.status).toBe(401)
  })
})
