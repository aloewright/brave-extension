import { beforeEach, describe, expect, it, type Mock } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getConversation } from "../../src/db"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/conversations", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("POST creates a conversation, embeds it, and returns the id", async () => {
    const res = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        backend: "claude",
        title: "hello",
        content_text: "this is a chat about widgets",
        started_at: 100,
        message_count: 2
      })
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; chunkCount: number }
    expect(body.id).toMatch(/^[0-9A-Z]{26}$/)
    expect(body.chunkCount).toBeGreaterThan(0)

    const row = await getConversation(env, body.id)
    expect(row?.title).toBe("hello")
    expect(env.VECTORS.upsert).toHaveBeenCalled()
  })

  it("POST with existing id replays as an update", async () => {
    const create = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "v1", content_text: "x", started_at: 100, message_count: 1 })
    })
    const { id } = (await create.json()) as { id: string }

    const update = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, backend: "claude", title: "v2", content_text: "x", started_at: 100, message_count: 1 })
    })
    expect(update.status).toBe(200)
    expect((await getConversation(env, id))?.title).toBe("v2")
  })

  it("GET /api/conversations lists rows newest-first", async () => {
    for (let i = 1; i <= 3; i++) {
      await authed(env, "/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "claude", title: `t${i}`, content_text: "x", started_at: i, message_count: 1 })
      })
      // ensure updated_at differs
      await new Promise((r) => setTimeout(r, 2))
    }
    const res = await authed(env, "/api/conversations")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { conversations: { title: string }[] }
    expect(body.conversations.map((c) => c.title)).toEqual(["t3", "t2", "t1"])
  })

  it("GET /api/conversations/:id returns 404 when missing", async () => {
    const res = await authed(env, "/api/conversations/nope")
    expect(res.status).toBe(404)
  })

  it("PUT updates and re-embeds", async () => {
    const create = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "v1", content_text: "x", started_at: 1, message_count: 1 })
    })
    const { id } = (await create.json()) as { id: string }
    const before = (env.VECTORS.upsert as Mock).mock.calls.length

    const res = await authed(env, `/api/conversations/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "v2", content_text: "longer text now", message_count: 2 })
    })
    expect(res.status).toBe(200)
    expect((await getConversation(env, id))?.title).toBe("v2")
    expect((env.VECTORS.upsert as Mock).mock.calls.length).toBeGreaterThan(before)
  })

  it("DELETE removes the row and its vectors", async () => {
    const create = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "t", content_text: "x", started_at: 1, message_count: 1 })
    })
    const { id } = (await create.json()) as { id: string }

    const res = await authed(env, `/api/conversations/${id}`, { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(await getConversation(env, id)).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("returns 401 without a token", async () => {
    const res = await app.fetch(new Request("http://x/api/conversations"), env)
    expect(res.status).toBe(401)
  })

  it("validates required fields on POST", async () => {
    const res = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "missing backend" })
    })
    expect(res.status).toBe(400)
  })
})
