import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/newtab", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("stores and returns the latest new tab customization snapshot", async () => {
    const res = await authed(env, "/api/newtab/snapshot", {
      method: "POST",
      body: JSON.stringify({
        quickLinks: [{ id: "q1", label: "Docs", url: "https://docs.example" }],
        customApps: [{ name: "Local", url: "https://local.example" }],
        hiddenApps: ["https://hide.example"],
        appOrder: ["https://local.example", "https://docs.example"],
        appIconOverrides: { "https://local.example": "github" }
      })
    })

    expect(res.status).toBe(200)
    const write = (await res.json()) as { ok: boolean; syncedAt: number }
    expect(write.ok).toBe(true)
    expect(write.syncedAt).toBeGreaterThan(0)

    const read = await authed(env, "/api/newtab/snapshot")
    const body = (await read.json()) as {
      snapshot: {
        quickLinks: Array<{ id: string }>
        customApps: Array<{ name: string }>
        hiddenApps: string[]
        appOrder: string[]
        appIconOverrides: Record<string, string>
      }
    }
    expect(body.snapshot.quickLinks).toEqual([{ id: "q1", label: "Docs", url: "https://docs.example" }])
    expect(body.snapshot.customApps).toEqual([{ name: "Local", url: "https://local.example" }])
    expect(body.snapshot.hiddenApps).toEqual(["https://hide.example"])
    expect(body.snapshot.appOrder).toEqual(["https://local.example", "https://docs.example"])
    expect(body.snapshot.appIconOverrides["https://local.example"]).toBe("github")
  })

  it("returns null before any snapshot exists", async () => {
    const res = await authed(env, "/api/newtab/snapshot")
    await expect(res.json()).resolves.toEqual({ snapshot: null })
  })

  it("requires authentication", async () => {
    const res = await app.fetch(new Request("http://x/api/newtab/snapshot"), env)
    expect(res.status).toBe(401)
  })
})
