import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

const observation = {
  url: "https://example.com",
  title: "Example",
  timestamp: 1,
  nodes: [{ ref: "e1", role: "button", name: "Save", selector: "#save", rect: { x: 0, y: 0, w: 40, h: 20 }, state: {} }],
  limits: { nodesTruncated: false }
}

describe("/api/agent", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("creates a session and returns persisted state", async () => {
    const res = await authed(env, "/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "click save", observation })
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { session: { id: string; objective: string; lastObservation: any } }
    expect(body.session.objective).toBe("click save")
    expect(body.session.lastObservation.title).toBe("Example")

    const get = await authed(env, `/api/agent/sessions/${body.session.id}`)
    expect(get.status).toBe(200)
  })

  it("chat appends messages and returns a plan-first reply", async () => {
    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "click save", observation })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { id: string; nextStep: string }; reply: string; provider: string }
    expect(body.provider).toBe("worker-deterministic")
    expect(body.reply).toContain("Objective: click save")
    expect(body.session.nextStep).toContain("observed")
  })

  it("stores and searches session memory", async () => {
    const create = await authed(env, "/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "remember checkout" })
    })
    const { session } = (await create.json()) as { session: { id: string } }
    const remember = await authed(env, `/api/agent/sessions/${session.id}/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "checkout", value: "Reached payment step" })
    })
    expect(remember.status).toBe(201)

    const search = await authed(env, `/api/agent/sessions/${session.id}/memory/search?q=payment`)
    const body = (await search.json()) as { results: Array<{ key: string }> }
    expect(body.results[0]?.key).toBe("checkout")
  })

  it("requires auth", async () => {
    const res = await app.fetch(new Request("http://x/api/agent/sessions"), env)
    expect(res.status).toBe(401)
  })
})
