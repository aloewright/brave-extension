import { afterEach, describe, expect, it, vi } from "vitest"
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it("passes through with a valid auth.fly.pm OAuth bearer token", async () => {
    const issuer = "https://auth.test"
    const clientId = "txt.fly.pm"
    const { token, jwk } = await createTestJwt({
      iss: issuer,
      azp: clientId,
      sub: "user_123",
      exp: Math.floor(Date.now() / 1000) + 300,
      scope: "openid profile email"
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { "content-type": "application/json" }
      })
    )

    const req = new Request("http://x/api/secret", { headers: { authorization: `Bearer ${token}` } })
    const res = await buildApp().fetch(req, { ...env, FLY_OAUTH_ISSUER: issuer, FLY_OAUTH_CLIENT_ID: clientId })

    expect(res.status).toBe(200)
  })

  it("rejects OAuth bearer tokens for a different client", async () => {
    const issuer = "https://auth.test"
    const { token, jwk } = await createTestJwt({
      iss: issuer,
      azp: "other-client",
      sub: "user_123",
      exp: Math.floor(Date.now() / 1000) + 300
    })
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ keys: [jwk] })))

    const req = new Request("http://x/api/secret", { headers: { authorization: `Bearer ${token}` } })
    const res = await buildApp().fetch(req, { ...env, FLY_OAUTH_ISSUER: issuer, FLY_OAUTH_CLIENT_ID: "txt.fly.pm" })

    expect(res.status).toBe(401)
  })
})

async function createTestJwt(payload: Record<string, unknown>): Promise<{ token: string; jwk: JsonWebKey }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  ) as CryptoKeyPair
  const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey) as JsonWebKey
  const jwk = { ...(exported as unknown as Record<string, unknown>), kid: "test-key", alg: "RS256" } as unknown as JsonWebKey
  const header = { alg: "RS256", kid: "test-key", typ: "JWT" }
  const encodedHeader = base64Url(JSON.stringify(header))
  const encodedPayload = base64Url(JSON.stringify(payload))
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  )
  return { token: `${encodedHeader}.${encodedPayload}.${base64Url(new Uint8Array(signature))}`, jwk }
}

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}
