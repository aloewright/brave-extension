import { beforeEach, describe, expect, it } from "vitest"
import app from "../src/index"
import type { Env } from "../src/env"
import { makeEnv } from "./helpers"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("integration: create → search", () => {
  let env: Env
  beforeEach(() => {
    env = makeEnv()
  })

  it("conversations are searchable end-to-end", async () => {
    const create = await authed(env, "/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        backend: "claude",
        title: "Widget design notes",
        content_text: "We talked about widget colors and ergonomics.",
        started_at: 100,
        message_count: 3
      })
    })
    expect(create.status).toBe(201)

    const search = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "widget colors" })
    })
    const body = (await search.json()) as { results: { type: string; title: string }[] }
    expect(body.results[0]!.type).toBe("conversation")
    expect(body.results[0]!.title).toBe("Widget design notes")
  })

  it("links are searchable end-to-end", async () => {
    const create = await authed(env, "/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/cf-workers",
        title: "Cloudflare Workers docs",
        description: "Edge runtime + bindings"
      })
    })
    expect(create.status).toBe(201)

    const search = await authed(env, "/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "cloudflare", types: ["link"] })
    })
    const body = (await search.json()) as { results: { type: string }[] }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results.every((r) => r.type === "link")).toBe(true)
  })
})
