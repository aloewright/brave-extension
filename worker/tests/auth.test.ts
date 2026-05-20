import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { requireToken } from "../src/auth"
import type { Env } from "../src/env"
import { makeEnv } from "./helpers"

function buildApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.use("/api/*", requireToken())
  app.get("/api/health", (c) => c.json({ ok: true }))
  app.get("/api/secret", (c) => c.json({ secret: 42 }))
  return app
}

describe("requireToken", () => {
  const env = makeEnv()

  it("lets /api/health through without a token", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/health"), env)
    expect(res.status).toBe(200)
  })

  it("returns 401 when token is missing on a guarded route", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/secret"), env)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns 401 when token is wrong", async () => {
    const req = new Request("http://x/api/secret", { headers: { "x-sidebar-token": "nope" } })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(401)
  })

  it("passes through when token matches", async () => {
    const req = new Request("http://x/api/secret", { headers: { "x-sidebar-token": "test-token" } })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { secret: number }
    expect(body.secret).toBe(42)
  })

  it("is case-insensitive on the header name", async () => {
    const req = new Request("http://x/api/secret", { headers: { "X-Sidebar-Token": "test-token" } })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(200)
  })
})
