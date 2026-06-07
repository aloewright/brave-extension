import { beforeEach, describe, expect, it, vi } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getRecording } from "../../src/db"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/videos/import", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
    vi.restoreAllMocks()
  })

  it("POST imports cobalt tunnel response into R2 + D1", async () => {
    const mediaBytes = new TextEncoder().encode("video-bytes")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith("/api/") || url.endsWith("/api")) {
          return new Response(
            JSON.stringify({
              status: "tunnel",
              url: "https://cobalt-web.lazee.workers.dev/api/tunnel?id=test",
              filename: "clip.mp4",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          )
        }
        if (url.includes("/tunnel")) {
          return new Response(mediaBytes, {
            status: 200,
            headers: { "content-type": "video/mp4" },
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      }),
    )

    const res = await authed(env, "/api/videos/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/watch?v=1", id: "vid1" }),
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string; source: string; r2_key: string }
    expect(json.id).toBe("vid1")
    expect(json.source).toBe("cobalt")
    expect(json.r2_key).toBe("recordings/vid1.mp4")

    const row = await getRecording(env, "vid1")
    expect(row?.origin_url).toBe("https://example.com/watch?v=1")
    expect(row?.size_bytes).toBe(mediaBytes.byteLength)
  })

  it("POST without url → 400", async () => {
    const res = await authed(env, "/api/videos/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
  })
})
