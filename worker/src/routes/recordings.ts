import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteRecording, getRecording, insertRecording, listRecordings,
  type RecordingRow, type RecordingStatus
} from "../db"
import { deleteFor } from "../vectors"
import { deleteBlob, getBlob, keyFor, putBlob } from "../r2"
import { kickIngest } from "../workflows/ingest"

const recordings = new Hono<{ Bindings: Env }>()

interface MetadataPayload {
  id?: string
  filename?: string
  mime_type?: string
  duration_ms?: number
  source?: "tab" | "screen" | "camera"
  origin_url?: string | null
}

function inferExt(filename: string, mime: string): string {
  if (/\.mov$/i.test(filename) || /quicktime/i.test(mime)) return "mov"
  return "mp4"
}

recordings.post("/", async (c) => {
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
  // CF Workers types declare get() as `string | null`, but the runtime returns
  // Blob/File for binary parts. Cast to a permissive union for narrowing.
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

  const mime = meta.mime_type ?? (file.type || "video/mp4")
  const ext = inferExt(meta.filename, mime)
  const r2Key = keyFor("recording", meta.id, ext)

  const bytes = new Uint8Array(await file.arrayBuffer())
  await putBlob(c.env, r2Key, bytes, { contentType: mime, size: bytes.byteLength })

  const now = Date.now()
  const row: RecordingRow = {
    id: meta.id,
    filename: meta.filename,
    mime_type: mime,
    duration_ms: meta.duration_ms ?? 0,
    size_bytes: bytes.byteLength,
    source: meta.source ?? "screen",
    origin_url: meta.origin_url ?? null,
    r2_key: r2Key,
    transcript: null,
    status: "pending",
    status_message: null,
    workflow_id: null,
    chunk_count: 0,
    created_at: now,
    updated_at: now
  }
  await insertRecording(c.env, row)
  const workflowId = await kickIngest(c.env, "recording", meta.id)
  if (workflowId) {
    await c.env.DB.prepare("UPDATE recordings SET workflow_id = ?, updated_at = ? WHERE id = ?")
      .bind(workflowId, Date.now(), meta.id)
      .run()
  }

  return c.json({ id: meta.id, status: "pending" as RecordingStatus, r2_key: r2Key, workflow_id: workflowId }, 201)
})

recordings.get("/", async (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const statusParam = c.req.query("status")
  const status = (statusParam as RecordingStatus | undefined) ?? undefined
  const rows = await listRecordings(c.env, { limit, status })
  return c.json({ recordings: rows })
})

recordings.get("/:id", async (c) => {
  const row = await getRecording(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such recording" } }, 404)
  return c.json(row)
})

recordings.get("/:id/blob", async (c) => {
  const row = await getRecording(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such recording" } }, 404)
  const obj = await getBlob(c.env, row.r2_key)
  if (!obj) return c.json({ error: { code: "not_found", message: "blob missing" } }, 404)
  const safeName = row.filename.replace(/"/g, "")
  return new Response(obj.body, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(row.size_bytes),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, max-age=3600"
    }
  })
})

recordings.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getRecording(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "recording", id, existing.chunk_count)
  await deleteBlob(c.env, existing.r2_key)
  await deleteRecording(c.env, id)
  return c.body(null, 204)
})

export default recordings
