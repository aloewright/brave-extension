import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getLink } from "../../src/db"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/links", () => {
  let env: Env

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 })
    env = makeEnv()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("POST creates a link and embeds title+description", async () => {
    const res = await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        title: "Example",
        description: "An example domain",
        tags: ["sample"],
        favicon: null
      })
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; created: boolean }
    expect(body.created).toBe(true)
    expect(env.VECTORS.upsert).toHaveBeenCalled()
  })

  it("POST with the same URL updates the existing row (200)", async () => {
    await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", title: "v1" })
    })
    const res = await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", title: "v2" })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; created: boolean }
    expect(body.created).toBe(false)
    expect((await getLink(env, body.id))?.title).toBe("v2")
  })

  it("GET /api/links lists rows newest-first", async () => {
    for (const u of ["https://a.com", "https://b.com", "https://c.com"]) {
      await authed(env, "/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u, title: u })
      })
      vi.advanceTimersByTime(2);
    }
    const res = await authed(env, "/api/links")
    const body = (await res.json()) as { links: { url: string }[] }
    expect(body.links.map((l) => l.url)).toEqual(["https://c.com", "https://b.com", "https://a.com"])
  })

  it("GET /api/links?tag=red filters by tag", async () => {
    await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://a.com", title: "a", tags: ["red"] })
    })
    await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://b.com", title: "b", tags: ["blue"] })
    })
    const res = await authed(env, "/api/links?tag=red")
    const body = (await res.json()) as { links: { url: string }[] }
    expect(body.links.map((l) => l.url)).toEqual(["https://a.com"])
  })

  it("GET /api/links/:id returns 404 when missing", async () => {
    const res = await authed(env, "/api/links/nope")
    expect(res.status).toBe(404)
  })

  it("DELETE removes the row and its vectors", async () => {
    const create = await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://x.com", title: "x" })
    })
    const { id } = (await create.json()) as { id: string }
    const res = await authed(env, `/api/links/${id}`, { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(await getLink(env, id)).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("rejects missing url with 400", async () => {
    const res = await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "no url" })
    })
    expect(res.status).toBe(400)
  })
})
