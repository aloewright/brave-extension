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

  it("falls back to deterministic plan when AI Gateway throws", async () => {
    const aiRun = vi.fn(async () => {
      throw new Error("AI Gateway unavailable")
    })
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
    const body = (await res.json()) as { provider: string; reply: string }
    // When AI Gateway fails, fallback to worker-deterministic
    expect(body.provider).toBe("worker-deterministic")
    expect(body.reply).toContain("Objective: click save")
    expect(aiRun).toHaveBeenCalledOnce()
  })

  it("normalizes absent cloudUse to all-false and uses deterministic plan", async () => {
    const aiRun = vi.fn(async () => {
      throw new Error("AI should not be called without cloudUse")
    })
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "click save", observation })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cloudUse: { planning: boolean; vision: boolean; ocr: boolean }; provider: string }
    expect(body.provider).toBe("worker-deterministic")
    expect(body.cloudUse).toEqual({ planning: false, vision: false, ocr: false })
    expect(aiRun).not.toHaveBeenCalled()
  })

  it("normalizes partial cloudUse — unset fields default to false", async () => {
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        status: "planning",
        nextStep: "click save",
        stopCondition: "saved",
        reply: "Cloud plan OK"
      })
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "click save",
        observation,
        cloudUse: { planning: true }  // vision and ocr are absent
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { cloudUse: { planning: boolean; vision: boolean; ocr: boolean } }
    expect(body.cloudUse).toEqual({ planning: true, vision: false, ocr: false })
  })

  it("response includes model and gateway fields when cloud plan succeeds", async () => {
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        status: "planning",
        nextStep: "Proceed.",
        stopCondition: "Done.",
        reply: "Cloud reply."
      })
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "click save",
        observation: { ...observation, visibleText: "cloud model page" },
        cloudUse: { planning: true, vision: false, ocr: false }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { model: string; gateway: string; provider: string }
    expect(body.provider).toBe("cloudflare-ai-gateway")
    expect(typeof body.model).toBe("string")
    expect(body.model.length).toBeGreaterThan(0)
    expect(typeof body.gateway).toBe("string")
    expect(body.gateway.length).toBeGreaterThan(0)
  })

  it("response model and gateway are absent when deterministic plan is used", async () => {
    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "click save" })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { model?: string; gateway?: string; provider: string }
    expect(body.provider).toBe("worker-deterministic")
    expect(body.model).toBeUndefined()
    expect(body.gateway).toBeUndefined()
  })

  it("AI Gateway receives the full observation JSON in the prompt when planning is enabled", async () => {
    const aiRun = vi.fn(async () => ({
      choices: [
        { message: { content: JSON.stringify({ status: "planning", nextStep: "click", stopCondition: "done", reply: "ok" }) } }
      ]
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const sensitiveObservation = { ...observation, visibleText: "unique-marker-xyz-789" }
    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "read page",
        observation: sensitiveObservation,
        cloudUse: { planning: true }
      })
    })
    expect(res.status).toBe(200)
    // The AI was called and the observation text was included in the prompt
    expect(aiRun).toHaveBeenCalledOnce()
    const callArgs = JSON.stringify(aiRun.mock.calls[0])
    expect(callArgs).toContain("unique-marker-xyz-789")
  })

  it("uses choices[0].message.content format from AI response when response field absent", async () => {
    const aiRun = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: "planning",
              nextStep: "type in search box",
              stopCondition: "search results shown",
              reply: "Choices-format reply."
            })
          }
        }
      ]
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "search for item",
        observation,
        cloudUse: { planning: true }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reply: string; provider: string }
    expect(body.provider).toBe("cloudflare-ai-gateway")
    expect(body.reply).toBe("Choices-format reply.")
  })

  it("uses result field from AI response when response and choices fields are absent", async () => {
    const aiRun = vi.fn(async () => ({
      result: JSON.stringify({
        status: "planning",
        nextStep: "scroll down",
        stopCondition: "element visible",
        reply: "Result-field reply."
      })
    }))
    env = makeEnv({ AI: { run: aiRun } as unknown as Ai })

    const res = await authed(env, "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "scroll to footer",
        observation,
        cloudUse: { planning: true }
      })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { reply: string; provider: string }
    expect(body.provider).toBe("cloudflare-ai-gateway")
    expect(body.reply).toBe("Result-field reply.")
  })

  it("stores and searches session memory", async () => {
    const create = await authed(env, "/api/agent/sessions", {
      method: "POST",

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
