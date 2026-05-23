import { Hono } from "hono"
import type { Env } from "../env"
import {
  deletePdf, getPdf, insertPdf, listPdfs, updatePdf,
  type PdfRow, type PdfStatus
} from "../db"
import { deleteFor } from "../vectors"
import { deleteBlob, getBlob, keyFor, putBlob } from "../r2"
import { kickIngest } from "../workflows/ingest"

const pdfs = new Hono<{ Bindings: Env }>()

interface MetadataPayload {
  id?: string
  filename?: string
  title?: string | null
  source_url?: string | null
}

pdfs.post("/", async (c) => {
  const ct = c.req.header("content-type") ?? ""
  if (!ct.startsWith("multipart/form-data")) {
    return c.json({ error: { code: "bad_request", message: "expected multipart/form-data" } }, 400)
  }

  let form: FormData
  try {
    form = await c.req.formData()
  } catch {
    return c.json({ error: { code: "bad_request", message: "could not parse form data" } }, 400)
  }

  const metaRaw = form.get("metadata")
  const fileRaw = form.get("file") as unknown as Blob | string | null
  if (typeof metaRaw !== "string" || fileRaw === null || typeof fileRaw === "string") {
    return c.json({ error: { code: "bad_request", message: "metadata (string) + file (blob) required" } }, 400)
  }
  const file: Blob = fileRaw

  let meta: MetadataPayload
  try {
    meta = JSON.parse(metaRaw) as MetadataPayload
  } catch {
    return c.json({ error: { code: "bad_request", message: "metadata must be valid JSON" } }, 400)
  }

  if (typeof meta.id !== "string" || !meta.id || typeof meta.filename !== "string" || !meta.filename) {
    return c.json({ error: { code: "bad_request", message: "metadata.id and metadata.filename required" } }, 400)
  }

  const r2Key = keyFor("pdf", meta.id, "pdf")
  const bytes = new Uint8Array(await file.arrayBuffer())
  await putBlob(c.env, r2Key, bytes, { contentType: "application/pdf", size: bytes.byteLength })

  const now = Date.now()
  const row: PdfRow = {
    id: meta.id,
    filename: meta.filename,
    title: meta.title ?? null,
    source_url: meta.source_url ?? null,
    size_bytes: bytes.byteLength,
    page_count: null,
    r2_key: r2Key,
    text_content: null,
    status: "pending",
    status_message: null,
    workflow_id: null,
    chunk_count: 0,
    created_at: now,
    updated_at: now
  }
  await insertPdf(c.env, row)
  const workflowId = await kickIngest(c.env, "pdf", meta.id)
  if (workflowId) {
    await c.env.DB.prepare("UPDATE pdfs SET workflow_id = ?, updated_at = ? WHERE id = ?")
      .bind(workflowId, Date.now(), meta.id)
      .run()
  }

  return c.json({ id: meta.id, status: "pending" as PdfStatus, r2_key: r2Key, workflow_id: workflowId }, 201)
})

pdfs.get("/", async (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const statusParam = c.req.query("status")
  const status = (statusParam as PdfStatus | undefined) ?? undefined
  const rows = await listPdfs(c.env, { limit, status })
  return c.json({ pdfs: rows })
})

pdfs.get("/:id", async (c) => {
  const row = await getPdf(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such pdf" } }, 404)
  return c.json(row)
})

pdfs.get("/:id/blob", async (c) => {
  const row = await getPdf(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such pdf" } }, 404)
  const obj = await getBlob(c.env, row.r2_key)
  if (!obj) return c.json({ error: { code: "not_found", message: "blob missing" } }, 404)
  const safeName = row.filename.replace(/"/g, "")
  return new Response(obj.body, {
    headers: {
      "content-type": "application/pdf",
      "content-length": String(row.size_bytes),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, max-age=3600"
    }
  })
})

pdfs.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getPdf(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "pdf", id, existing.chunk_count)
  await deleteBlob(c.env, existing.r2_key)
  await deletePdf(c.env, id)
  return c.body(null, 204)
})

pdfs.post("/:id/reingest", async (c) => {
  const id = c.req.param("id")
  const existing = await getPdf(c.env, id)
  if (!existing) return c.json({ error: { code: "not_found", message: "no such pdf" } }, 404)

  await deleteFor(c.env, "pdf", id, existing.chunk_count)
  await updatePdf(c.env, id, {
    text_content: null,
    page_count: null,
    chunk_count: 0,
    status: "pending",
    status_message: null,
    workflow_id: null,
    updated_at: Date.now()
  })
  const workflowId = await kickIngest(c.env, "pdf", id)
  if (workflowId) {
    await updatePdf(c.env, id, { workflow_id: workflowId, updated_at: Date.now() })
  }
  return c.json({ id, status: "pending" as PdfStatus, workflow_id: workflowId })
})

export default pdfs
