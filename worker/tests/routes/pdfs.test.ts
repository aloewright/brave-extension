import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getPdf } from "../../src/db"
import { getBlob } from "../../src/r2"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

function buildMultipart(meta: Record<string, unknown>, fileBytes: Uint8Array, filename: string): { body: FormData } {
  const form = new FormData()
  form.set("metadata", JSON.stringify(meta))
  form.set("file", new Blob([fileBytes], { type: "application/pdf" }), filename)
  return { body: form }
}

describe("/api/pdfs", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("POST uploads multipart, writes R2, inserts D1 row with status=pending", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 fake")
    const { body } = buildMultipart(
      { id: "pdf1", filename: "doc.pdf", title: "My doc", source_url: "https://example.com/doc.pdf" },
      bytes, "doc.pdf"
    )
    const res = await authed(env, "/api/pdfs", { method: "POST", body })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string; status: string; r2_key: string; workflow_id: string | null }
    expect(json.id).toBe("pdf1")
    expect(json.status).toBe("pending")
    expect(json.r2_key).toBe("pdfs/pdf1.pdf")
    expect(json.workflow_id === null || typeof json.workflow_id === "string").toBe(true)

    const row = await getPdf(env, "pdf1")
    expect(row?.status).toBe("pending")
    expect(row?.size_bytes).toBe(bytes.byteLength)
    expect(row?.title).toBe("My doc")

    const obj = await getBlob(env, "pdfs/pdf1.pdf")
    expect(obj).not.toBeNull()
    expect(new TextDecoder().decode(await obj!.arrayBuffer())).toBe("%PDF-1.7 fake")
  })

  it("POST rejects non-multipart with 400", async () => {
    const res = await authed(env, "/api/pdfs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "x" })
    })
    expect(res.status).toBe(400)
  })

  it("POST without metadata field → 400", async () => {
    const form = new FormData()
    form.set("file", new Blob([new Uint8Array([1, 2])], { type: "application/pdf" }), "x.pdf")
    const res = await authed(env, "/api/pdfs", { method: "POST", body: form })
    expect(res.status).toBe(400)
  })

  it("POST without file field → 400", async () => {
    const form = new FormData()
    form.set("metadata", JSON.stringify({ id: "x", filename: "x.pdf" }))
    const res = await authed(env, "/api/pdfs", { method: "POST", body: form })
    expect(res.status).toBe(400)
  })

  it("GET lists newest-first", async () => {
    for (const id of ["a", "b", "c"]) {
      const { body } = buildMultipart(
        { id, filename: `${id}.pdf` },
        new Uint8Array([1, 2]), `${id}.pdf`
      )
      await authed(env, "/api/pdfs", { method: "POST", body })
      await new Promise((r) => setTimeout(r, 2))
    }
    const res = await authed(env, "/api/pdfs")
    const json = (await res.json()) as { pdfs: { id: string }[] }
    expect(json.pdfs.map((p) => p.id)).toEqual(["c", "b", "a"])
  })

  it("GET /:id returns the row; 404 when missing", async () => {
    const { body } = buildMultipart(
      { id: "pdf1", filename: "x.pdf" }, new Uint8Array([1, 2]), "x.pdf"
    )
    await authed(env, "/api/pdfs", { method: "POST", body })

    const ok = await authed(env, "/api/pdfs/pdf1")
    expect(ok.status).toBe(200)
    const missing = await authed(env, "/api/pdfs/nope")
    expect(missing.status).toBe(404)
  })

  it("GET /:id/blob streams R2 with application/pdf and inline disposition", async () => {
    const bytes = new TextEncoder().encode("pdf bytes")
    const { body } = buildMultipart(
      { id: "pdf1", filename: "my doc.pdf" }, bytes, "my doc.pdf"
    )
    await authed(env, "/api/pdfs", { method: "POST", body })

    const res = await authed(env, "/api/pdfs/pdf1/blob")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/pdf")
    expect(res.headers.get("content-disposition")).toContain("inline")
    expect(res.headers.get("content-disposition")).toContain("my doc.pdf")
    expect(await res.text()).toBe("pdf bytes")
  })

  it("GET /:id/blob returns 404 when row missing", async () => {
    const res = await authed(env, "/api/pdfs/nope/blob")
    expect(res.status).toBe(404)
  })

  it("DELETE removes D1 row + R2 blob (no vectors yet in Phase 3a)", async () => {
    const { body } = buildMultipart(
      { id: "pdf1", filename: "x.pdf" }, new Uint8Array([1, 2]), "x.pdf"
    )
    await authed(env, "/api/pdfs", { method: "POST", body })

    const res = await authed(env, "/api/pdfs/pdf1", { method: "DELETE" })
    expect(res.status).toBe(204)
    expect(await getPdf(env, "pdf1")).toBeNull()
    expect(await getBlob(env, "pdfs/pdf1.pdf")).toBeNull()
    expect(env.VECTORS.deleteByIds).not.toHaveBeenCalled()
  })

  it("requires the token", async () => {
    const res = await app.fetch(new Request("http://x/api/pdfs"), env)
    expect(res.status).toBe(401)
  })
})
