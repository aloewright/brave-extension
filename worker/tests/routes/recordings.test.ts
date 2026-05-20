import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getRecording } from "../../src/db"
import { getBlob } from "../../src/r2"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

function buildMultipart(meta: Record<string, unknown>, fileBytes: Uint8Array, mime: string, filename: string): { body: FormData; headers: Record<string, string> } {
  const form = new FormData()
  form.set("metadata", JSON.stringify(meta))
  form.set("file", new Blob([fileBytes], { type: mime }), filename)
  return { body: form, headers: {} }
}

describe("/api/recordings", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("POST uploads multipart, writes R2, inserts D1 row with status=pending", async () => {
    const bytes = new TextEncoder().encode("fake mp4 bytes")
    const { body } = buildMultipart(
      { id: "rec1", filename: "rec1.mp4", duration_ms: 5000, source: "screen" },
      bytes, "video/mp4", "rec1.mp4"
    )
    const res = await authed(env, "/api/recordings", { method: "POST", body })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string; status: string; r2_key: string }
    expect(json).toEqual({ id: "rec1", status: "pending", r2_key: "recordings/rec1.mp4" })

    const row = await getRecording(env, "rec1")
    expect(row?.status).toBe("pending")
    expect(row?.size_bytes).toBe(bytes.byteLength)

    const obj = await getBlob(env, "recordings/rec1.mp4")
    expect(obj).not.toBeNull()
    expect(new TextDecoder().decode(await obj!.arrayBuffer())).toBe("fake mp4 bytes")
  })

  it("POST rejects non-multipart with 400", async () => {
    const res = await authed(env, "/api/recordings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x" })
    })
    expect(res.status).toBe(400)
  })

  it("POST without metadata field → 400", async () => {
    const form = new FormData()
    form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }), "x.mp4")
    const res = await authed(env, "/api/recordings", { method: "POST", body: form })
    expect(res.status).toBe(400)
  })

  it("POST without file field → 400", async () => {
    const form = new FormData()
    form.set("metadata", JSON.stringify({ id: "x", filename: "x.mp4" }))
    const res = await authed(env, "/api/recordings", { method: "POST", body: form })
    expect(res.status).toBe(400)
  })

  it("POST infers .mov key when filename ends in .mov", async () => {
    const { body } = buildMultipart(
      { id: "rec2", filename: "rec2.mov" },
      new Uint8Array([1, 2, 3]), "video/quicktime", "rec2.mov"
    )
    const res = await authed(env, "/api/recordings", { method: "POST", body })
    const json = (await res.json()) as { r2_key: string }
    expect(json.r2_key).toBe("recordings/rec2.mov")
  })

  it("GET lists newest-first", async () => {
    for (const id of ["a", "b", "c"]) {
      const { body } = buildMultipart(
        { id, filename: `${id}.mp4` },
        new Uint8Array([1, 2]), "video/mp4", `${id}.mp4`
      )
      await authed(env, "/api/recordings", { method: "POST", body })
      await new Promise((r) => setTimeout(r, 2))
    }
    const res = await authed(env, "/api/recordings")
    const json = (await res.json()) as { recordings: { id: string }[] }
    expect(json.recordings.map((r) => r.id)).toEqual(["c", "b", "a"])
  })

  it("GET /:id returns the row; 404 when missing", async () => {
    const { body } = buildMultipart(
      { id: "rec1", filename: "rec1.mp4" },
      new Uint8Array([1, 2]), "video/mp4", "rec1.mp4"
    )
    await authed(env, "/api/recordings", { method: "POST", body })

    const ok = await authed(env, "/api/recordings/rec1")
    expect(ok.status).toBe(200)
    const missing = await authed(env, "/api/recordings/nope")
    expect(missing.status).toBe(404)
  })

  it("GET /:id/blob streams R2 with inline Content-Disposition", async () => {
    const bytes = new TextEncoder().encode("video data")
    const { body } = buildMultipart(
      { id: "rec1", filename: "my video.mp4" },
      bytes, "video/mp4", "my video.mp4"
    )
    await authed(env, "/api/recordings", { method: "POST", body })

    const res = await authed(env, "/api/recordings/rec1/blob")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("video/mp4")
    expect(res.headers.get("content-disposition")).toContain("inline")
    expect(res.headers.get("content-disposition")).toContain("my video.mp4")
    const text = await res.text()
    expect(text).toBe("video data")
  })

  it("GET /:id/blob returns 404 when row missing", async () => {
    const res = await authed(env, "/api/recordings/nope/blob")
    expect(res.status).toBe(404)
  })

  it("DELETE removes D1 row + R2 blob (no vectors yet in Phase 3a)", async () => {
    const { body } = buildMultipart(
      { id: "rec1", filename: "rec1.mp4" },
      new Uint8Array([1, 2]), "video/mp4", "rec1.mp4"
    )
    await authed(env, "/api/recordings", { method: "POST", body })

    const res = await authed(env, "/api/recordings/rec1", { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(await getRecording(env, "rec1")).toBeNull()
    expect(await getBlob(env, "recordings/rec1.mp4")).toBeNull()
    // chunk_count=0 in Phase 3a; deleteByIds is correctly a no-op until 3b.
    expect(env.VECTORS.deleteByIds).not.toHaveBeenCalled()
  })

  it("requires the token", async () => {
    const res = await app.fetch(new Request("http://x/api/recordings"), env)
    expect(res.status).toBe(401)
  })
})
