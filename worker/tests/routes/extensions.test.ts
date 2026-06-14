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

describe("/api/extensions", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("stores installed extension metadata and manager config snapshots", async () => {
    const res = await authed(env, "/api/extensions/snapshot", {
      method: "POST",
      body: JSON.stringify({
        pulledAt: "2026-06-14T12:00:00Z",
        extensions: [
          {
            id: "ext-a",
            name: "Extension A",
            enabled: true,
            type: "extension",
            version: "1.0.0",
            description: "A",
            installType: "normal",
            homepageUrl: "https://a.example",
            mayDisable: true,
            icons: [{ size: 48, url: "icon.png" }]
          },
          {
            id: "ext-b",
            name: "Extension B",
            enabled: false,
            type: "extension",
            version: "2.0.0"
          }
        ],
        profiles: [{ id: "work", name: "Work", extensionIds: ["ext-a"] }],
        groups: [{ id: "dev", name: "Dev", extensionIds: ["ext-b"], enabled: false }],
        settings: { activeProfileId: "work" },
        lastUsed: { "ext-a": "2026-06-14T11:00:00Z" }
      })
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ inserted: 2, updated: 0, deleted: 0 })

    const list = await authed(env, "/api/extensions")
    const body = (await list.json()) as {
      extensions: Array<{ id: string; name: string; enabled: boolean; icons: unknown[] }>
      config: { profiles: unknown[]; groups: unknown[]; settings: Record<string, unknown>; lastUsed: Record<string, string> }
    }
    expect(body.extensions.map((extension) => extension.id).sort()).toEqual(["ext-a", "ext-b"])
    expect(body.extensions.find((extension) => extension.id === "ext-a")).toMatchObject({
      name: "Extension A",
      enabled: true
    })
    expect(body.extensions.find((extension) => extension.id === "ext-a")?.icons).toHaveLength(1)
    expect(body.config.settings.activeProfileId).toBe("work")
    expect(body.config.lastUsed["ext-a"]).toBe("2026-06-14T11:00:00Z")
  })

  it("deletes extension rows that disappear from the next snapshot", async () => {
    await authed(env, "/api/extensions/snapshot", {
      method: "POST",
      body: JSON.stringify({
        extensions: [
          { id: "ext-a", name: "Extension A", enabled: true, type: "extension", version: "1" },
          { id: "ext-b", name: "Extension B", enabled: true, type: "extension", version: "1" }
        ]
      })
    })

    const res = await authed(env, "/api/extensions/snapshot", {
      method: "POST",
      body: JSON.stringify({
        extensions: [
          { id: "ext-a", name: "Extension A", enabled: false, type: "extension", version: "1" }
        ]
      })
    })

    await expect(res.json()).resolves.toMatchObject({ inserted: 0, updated: 1, deleted: 1 })
    const list = await authed(env, "/api/extensions")
    const body = (await list.json()) as { extensions: Array<{ id: string }> }
    expect(body.extensions.map((extension) => extension.id)).toEqual(["ext-a"])
  })

  it("requires authentication", async () => {
    const res = await app.fetch(new Request("http://x/api/extensions"), env)
    expect(res.status).toBe(401)
  })
})
