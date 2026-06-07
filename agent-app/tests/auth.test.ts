import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { requireAccess } from "../src/auth"
import type { Env } from "../src/env"
import { makeEnv } from "./helpers"

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>()
  app.use("/api/*", requireAccess())
  app.get("/api/health", (c) => c.json({ ok: true }))
  app.get("/api/whoami", (c) => c.json({ userId: c.get("userId") }))
  return app
}

describe("requireAccess", () => {
  const env = makeEnv()

  it("lets /api/health through unauthenticated", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/health"), env)
    expect(res.status).toBe(200)
  })

  it("401s a guarded route with no credentials", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/whoami"), env)
    expect(res.status).toBe(401)
  })

  it("accepts a valid service token and sets userId", async () => {
    const req = new Request("http://x/api/whoami", {
      headers: {
        "cf-access-client-id": "svc-client-id",
        "cf-access-client-secret": "svc-client-secret"
      }
    })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { userId: string }
    expect(body.userId).toBe("svc-client-id")
  })

  it("401s a wrong service-token secret", async () => {
    const req = new Request("http://x/api/whoami", {
      headers: {
        "cf-access-client-id": "svc-client-id",
        "cf-access-client-secret": "WRONG"
      }
    })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(401)
  })
})
