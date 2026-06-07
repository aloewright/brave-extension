import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/search", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("returns [] for empty query", async () => {
    const res = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[] }
    expect(body.results).toEqual([])
  })

  it("finds an indexed conversation", async () => {
    await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        backend: "claude",
        title: "widgets",
        content_text: "talking about widgets",
        started_at: 1,
        message_count: 1
      })
    })
    const res = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "widgets" })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: { type: string; title: string }[] }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results[0]!.type).toBe("conversation")
  })

  it("respects the types filter", async () => {
    await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "c", content_text: "x", started_at: 1, message_count: 1 })
    })
    await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", title: "L" })
    })

    const res = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x", types: ["link"] })
    })
    const body = (await res.json()) as { results: { type: string }[] }
    for (const r of body.results) expect(r.type).toBe("link")
  })

  it("accepts highlight type filters", async () => {
    await authed(env, "/api/highlights", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "h1", text: "memorable highlighted text" })
    })

    const res = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "highlighted", types: ["highlight"] })
    })
    const body = (await res.json()) as { results: { type: string }[] }
    expect(body.results.length).toBeGreaterThan(0)
    for (const r of body.results) expect(r.type).toBe("highlight")
  })

  it("rejects malformed body with 400", async () => {
    const res = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json"
    })
    expect(res.status).toBe(400)
  })
})
