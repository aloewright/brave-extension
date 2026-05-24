import { beforeEach, describe, expect, it, vi } from "vitest"
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
    const body = (await res.json()) as { session: { id: string; nextStep: string; lastObservation: unknown }; reply: string; provider: string }
    expect(body.provider).toBe("worker-deterministic")
    expect(body.reply).toContain("Objective: click save")
    expect(body.session.lastObservation).toBeNull()
    expect(body.session.nextStep).toContain("collect more page context")
  })

  it("uses AI Gateway planning only after explicit cloud planning opt-in", async () => {
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        status: "planning",
        nextStep: "Click the Save button.",
        stopCondition: "The draft is saved.",
        reply: "Cloud plan: click Save."
      })
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "click save",
        observation: { ...observation, visibleText: "private page text" },
        cloudUse: { planning: true, vision: false, ocr: false }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { lastObservation: any }; reply: string; provider: string; cloudUse: unknown; model: string; gateway: string }
    expect(body.provider).toBe("cloudflare-ai-gateway")
    expect(body.reply).toBe("Cloud plan: click Save.")
    expect(body.session.lastObservation.visibleText).toBe("private page text")
    expect(body.cloudUse).toEqual({ planning: true, vision: false, ocr: false })
    expect(aiRun).toHaveBeenCalledOnce()
    expect(JSON.stringify(aiRun.mock.calls[0])).toContain("private page text")
  })

  it("preserves AI Gateway reply newlines while normalizing internal plan fields", async () => {
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        status: "planning\nwith detail",
        nextStep: "Click Save\nthen observe.",
        stopCondition: "Saved\nor blocked.",
        reply: "Cloud plan:\n\n1. Click Save.\n2. Observe again."
      })
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "click save",
        observation,
        cloudUse: { planning: true, vision: false, ocr: false }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { status: string; nextStep: string }; reply: string }
    expect(body.reply).toBe("Cloud plan:\n\n1. Click Save.\n2. Observe again.")
    expect(body.session.status).toBe("planning with detail")
    expect(body.session.nextStep).toBe("Click Save then observe.")
  })

  it("does not call AI Gateway or store raw observation when cloud planning is disabled", async () => {
    const aiRun = vi.fn(async () => {
      throw new Error("AI Gateway should not be called")
    })
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "click save",
        observation: { ...observation, visibleText: "secret account content" },
        cloudUse: { planning: false, vision: false, ocr: false }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { id: string; lastObservation: unknown }; provider: string }
    expect(body.provider).toBe("worker-deterministic")
    expect(body.session.lastObservation).toBeNull()
    expect(aiRun).not.toHaveBeenCalled()

    const get = await authed(env, `/api/agent/sessions/${body.session.id}`)
    const sessionBody = (await get.json()) as { messages: Array<{ content: string; observation: unknown }> }
    expect(JSON.stringify(sessionBody)).not.toContain("secret account content")
    expect(sessionBody.messages[0]?.observation).toBeNull()
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

  it("escapes wildcard and backslash characters in memory search", async () => {
    const create = await authed(env, "/api/agent/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "remember path" })
    })
    const { session } = (await create.json()) as { session: { id: string } }
    await authed(env, `/api/agent/sessions/${session.id}/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "plain", value: "payment step" })
    })
    await authed(env, `/api/agent/sessions/${session.id}/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "path", value: "C:\\Users\\Aloe" })
    })

    const wildcard = await authed(env, `/api/agent/sessions/${session.id}/memory/search?q=%`)
    expect(((await wildcard.json()) as { results: unknown[] }).results).toEqual([])

    const backslash = await authed(env, `/api/agent/sessions/${session.id}/memory/search?q=${encodeURIComponent("\\")}`)
    const body = (await backslash.json()) as { results: Array<{ key: string }> }
    expect(body.results.map((r) => r.key)).toEqual(["path"])
  })

  it("requires auth", async () => {
    const res = await app.fetch(new Request("http://x/api/agent/sessions"), env)
    expect(res.status).toBe(401)
  })
})
