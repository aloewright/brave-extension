import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { getHighlight } from "../../src/db"
import { makeEnv } from "../helpers"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/highlights", () => {
  let env: Env

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    env = makeEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("POST creates a highlight with source metadata and vectors", async () => {
    const res = await authed(env, "/api/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "h1",
        text: "Useful highlighted text from a page",
        sourceUrl: "https://example.com/article",
        sourceTitle: "Example Article",
        tags: ["research"],
        createdAt: 900_000
      })
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; created: boolean; chunkCount: number }
    expect(body).toMatchObject({ id: "h1", created: true })
    expect(body.chunkCount).toBeGreaterThan(0)
    const row = await getHighlight(env, "h1")
    expect(row?.source_host).toBe("example.com")
    expect(row?.created_at).toBe(900_000)
    expect(env.VECTORS.upsert).toHaveBeenCalled()
  })

  it("GET lists highlights newest-first", async () => {
    for (const id of ["h1", "h2", "h3"]) {
      await authed(env, "/api/highlights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, text: `Highlight ${id}` })
      })
      vi.advanceTimersByTime(2)
    }

    const res = await authed(env, "/api/highlights")
    const body = (await res.json()) as { highlights: { id: string }[] }
    expect(body.highlights.map((h) => h.id)).toEqual(["h3", "h2", "h1"])
  })

  it("PATCH updates editable fields and reindexes", async () => {
    await authed(env, "/api/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "h1", text: "Original highlight", sourceUrl: "https://a.com" })
    })

    const res = await authed(env, "/api/highlights/h1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "Updated highlight",
        note: "saved note",
        tags: ["edited"],
        sourceUrl: "https://b.com/post",
        sourceTitle: "Updated source"
      })
    })

    expect(res.status).toBe(200)
    const row = await getHighlight(env, "h1")
    expect(row).toMatchObject({
      text: "Updated highlight",
      note: "saved note",
      source_host: "b.com",
      source_title: "Updated source"
    })
    expect(JSON.parse(row!.tags)).toEqual(["edited"])
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(2)
  })

  it("DELETE removes the row and its vectors", async () => {
    await authed(env, "/api/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "h1", text: "Delete this highlight" })
    })

    const res = await authed(env, "/api/highlights/h1", { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(await getHighlight(env, "h1")).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("rejects missing or empty text", async () => {
    const res = await authed(env, "/api/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceUrl: "https://x.com" })
    })
    expect(res.status).toBe(400)
  })
})
