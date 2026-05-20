import { beforeEach, describe, expect, it, type Mock } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getBookmark } from "../../src/db"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

function bm(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    url: `https://${id}.example`,
    title: `t-${id}`,
    parentId: null,
    path: [],
    category: "Unfiled",
    isFavorite: false,
    dateAdded: null,
    index: 0,
    ...overrides
  }
}

describe("/api/bookmarks", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("POST /snapshot inserts new bookmarks and embeds them", async () => {
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1"), bm("b2")], pulledAt: "2026-05-20T12:00:00Z" })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { inserted: number; reembedded: number; deleted: number }
    expect(body.inserted).toBe(2)
    expect(body.reembedded).toBe(2)
    expect(body.deleted).toBe(0)
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(2)
  })

  it("POST /snapshot is idempotent — re-sending identical payload re-embeds nothing", async () => {
    const payload = JSON.stringify({ bookmarks: [bm("b1")] })
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload
    })
    ;(env.VECTORS.upsert as Mock).mockClear()

    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload
    })
    const body = (await res.json()) as { reembedded: number; updated: number }
    expect(body.reembedded).toBe(0)
    expect(body.updated).toBe(1)
    expect(env.VECTORS.upsert).not.toHaveBeenCalled()
  })

  it("POST /snapshot re-embeds when title changes", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { title: "old" })] })
    })
    ;(env.VECTORS.upsert as Mock).mockClear()

    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { title: "new" })] })
    })
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(1)
    expect((await getBookmark(env, "b1"))?.title).toBe("new")
  })

  it("POST /snapshot re-embeds when url changes", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { url: "https://old.example" })] })
    })
    ;(env.VECTORS.upsert as Mock).mockClear()

    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { url: "https://new.example" })] })
    })
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(1)
    expect((await getBookmark(env, "b1"))?.url).toBe("https://new.example")
  })

  it("POST /snapshot deletes rows absent from the payload", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1"), bm("b2")] })
    })
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1")] })
    })
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(1)
    expect(await getBookmark(env, "b2")).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("GET /api/bookmarks?category=Work filters by category", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bookmarks: [bm("b1", { category: "Work" }), bm("b2", { category: "Personal" })]
      })
    })
    const res = await authed(env, "/api/bookmarks?category=Work")
    const body = (await res.json()) as { bookmarks: { id: string }[] }
    expect(body.bookmarks.map((b) => b.id)).toEqual(["b1"])
  })

  it("GET /api/bookmarks?favorite=true filters favorites", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        bookmarks: [bm("b1", { isFavorite: true }), bm("b2", { isFavorite: false })]
      })
    })
    const res = await authed(env, "/api/bookmarks?favorite=true")
    const body = (await res.json()) as { bookmarks: { id: string }[] }
    expect(body.bookmarks.map((b) => b.id)).toEqual(["b1"])
  })

  it("GET /api/bookmarks/:id returns 404 when missing", async () => {
    const res = await authed(env, "/api/bookmarks/nope")
    expect(res.status).toBe(404)
  })

  it("returns 400 on malformed payload", async () => {
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(400)
  })

  it("returns 400 when a bookmark entry is missing required fields", async () => {
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [{ id: "b1" }] })
    })
    expect(res.status).toBe(400)
  })

  it("requires the token", async () => {
    const res = await app.fetch(new Request("http://x/api/bookmarks/snapshot"), env)
    expect(res.status).toBe(401)
  })
})
