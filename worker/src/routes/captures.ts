import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteCapture,
  getCapture,
  insertCapture,
  listCaptures,
  updateCapture,
  type CaptureKind,
  type CaptureRow
} from "../db"
import { deleteFor, search, upsertFor } from "../vectors"
import { deleteBlob, getBlob, keyFor, putBlob } from "../r2"
import { ocrImage } from "../ai"
import { extractPdfText } from "../pdf"

/**
 * Page Captures route (ALO-468).
 *
 * Single-Worker, synchronous pipeline:
 *   1. POST /api/captures
 *        - Body: raw image/png or application/pdf bytes.
 *        - Headers: X-Capture-Kind (screenshot|pdf),
 *                   X-Capture-Filename (utf-8 percent-encoded),
 *                   X-Capture-Page-Url / X-Capture-Page-Title (optional).
 *        - R2 PUT, extracted-text + Vectorize index in the same request.
 *   2. GET /api/captures           — list (kind/status filterable).
 *   3. GET /api/captures/:id       — metadata.
 *   4. GET /api/captures/:id/blob  — readable bytes.
 *   5. GET /api/captures/search?q  — Vectorize search restricted to capture.
 *   6. DELETE /api/captures/:id    — R2 + D1 + Vectorize.
 *
 * Sensitive extension/native-host data never lands in the AI prompt or
 * embedding — only the bytes the user uploaded plus the optional URL and
 * title that were already present on the captured page.
 */

const captures = new Hono<{ Bindings: Env }>()

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const MAX_BYTES = 25 * 1024 * 1024

function isCaptureKind(v: string): v is CaptureKind {
  return v === "screenshot" || v === "pdf"
}

function inferExt(kind: CaptureKind, filename: string, mime: string): string {
  if (kind === "screenshot") {
    if (/jpe?g/i.test(mime) || /\.jpe?g$/i.test(filename)) return "jpg"
    return "png"
  }
  return "pdf"
}

function decodeHeader(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

captures.post("/", async (c) => {
  const kindRaw = c.req.header("x-capture-kind")
  if (!kindRaw || !isCaptureKind(kindRaw)) {
    return c.json({ error: { code: "bad_request", message: "X-Capture-Kind must be 'screenshot' or 'pdf'" } }, 400)
  }
  const filename = decodeHeader(c.req.header("x-capture-filename"))
  if (!filename) {
    return c.json({ error: { code: "bad_request", message: "X-Capture-Filename header required" } }, 400)
  }
  const contentType = c.req.header("content-type") || (kindRaw === "screenshot" ? "image/png" : "application/pdf")
  const bytes = new Uint8Array(await c.req.arrayBuffer())
  if (bytes.byteLength === 0) {
    return c.json({ error: { code: "bad_request", message: "empty body" } }, 400)
  }
  if (bytes.byteLength > MAX_BYTES) {
    return c.json(
      { error: { code: "too_large", message: `capture exceeds ${MAX_BYTES} bytes (got ${bytes.byteLength})` } },
      413
    )
  }

  const id = newCaptureId()
  const ext = inferExt(kindRaw, filename, contentType)
  const r2Key = keyFor("capture", id, ext)
  await putBlob(c.env, r2Key, bytes, { contentType, size: bytes.byteLength })

  const sourceUrl = decodeHeader(c.req.header("x-capture-page-url"))
  const sourceTitle = decodeHeader(c.req.header("x-capture-page-title"))

  // Best-effort text extraction. We persist the row + R2 object regardless
  // of whether extraction or embedding succeeded, so the user keeps their
  // capture even if a downstream model is rate-limited.
  let extractedText = ""
  let status: "ready" | "failed" = "ready"
  let statusMessage: string | null = null
  try {
    if (kindRaw === "screenshot") {
      extractedText = (await ocrImage(c.env, bytes)).trim()
    } else {
      const pdf = await extractPdfText(c.env, bytes)
      extractedText = (pdf.text ?? "").trim()
    }
  } catch (err) {
    status = "failed"
    statusMessage = err instanceof Error ? err.message : String(err)
  }

  // Embed metadata + extracted text so the user can find the capture by
  // visible content OR by URL/title.
  const embedText = [filename, sourceTitle, sourceUrl, extractedText]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join("\n")

  let chunkCount = 0
  if (embedText.trim().length > 0) {
    try {
      const r = await upsertFor(c.env, "capture", id, embedText, {
        title: sourceTitle || filename,
        createdAt: Date.now()
      })
      chunkCount = r.chunkCount
    } catch (err) {
      status = "failed"
      statusMessage = (statusMessage ? statusMessage + "; " : "") + (err instanceof Error ? err.message : String(err))
    }
  }

  const now = Date.now()
  const row: CaptureRow = {
    id,
    kind: kindRaw,
    filename,
    source_url: sourceUrl,
    source_title: sourceTitle,
    mime_type: contentType,
    size_bytes: bytes.byteLength,
    r2_key: r2Key,
    extracted_text: extractedText.length > 0 ? extractedText : null,
    status,
    status_message: statusMessage,
    chunk_count: chunkCount,
    created_at: now,
    updated_at: now
  }
  await insertCapture(c.env, row)

  return c.json(
    {
      id,
      kind: kindRaw,
      filename,
      url: `/api/captures/${id}/blob`,
      sizeBytes: bytes.byteLength,
      createdAt: new Date(now).toISOString(),
      status,
      statusMessage
    },
    201
  )
})

captures.get("/", async (c) => {
  const kindParam = c.req.query("kind")
  const kind = kindParam && isCaptureKind(kindParam) ? kindParam : undefined
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const rows = await listCaptures(c.env, { kind, limit })
  return c.json({
    captures: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      filename: r.filename,
      sourceUrl: r.source_url,
      sourceTitle: r.source_title,
      sizeBytes: r.size_bytes,
      mimeType: r.mime_type,
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      blobUrl: `/api/captures/${r.id}/blob`
    }))
  })
})

captures.get("/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? ""
  if (!q) return c.json({ q: "", hits: [] })
  const hits = await search(c.env, q, { types: ["capture"], limit: 20 })
  const ids = Array.from(new Set(hits.map((h) => h.metadata.id)))
  if (ids.length === 0) return c.json({ q, hits: [] })
  // Rehydrate the row for each hit so callers can render without an
  // extra round-trip per hit. We dedupe on capture id since a capture
  // can produce multiple chunk hits.
  const placeholders = ids.map(() => "?").join(",")
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, filename, source_url, source_title, mime_type, size_bytes, status, created_at
       FROM captures WHERE id IN (${placeholders})`
  ).bind(...ids).all<{
    id: string; kind: string; filename: string; source_url: string | null
    source_title: string | null; mime_type: string; size_bytes: number; status: string; created_at: number
  }>()
  const byId = new Map((results ?? []).map((r) => [r.id, r]))
  return c.json({
    q,
    hits: hits
      .map((h) => {
        const row = byId.get(h.metadata.id)
        if (!row) return null
        return {
          id: row.id,
          kind: row.kind,
          filename: row.filename,
          sourceUrl: row.source_url,
          sourceTitle: row.source_title,
          score: h.score,
          snippet: h.metadata.snippet,
          blobUrl: `/api/captures/${row.id}/blob`
        }
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
  })
})

captures.get("/:id", async (c) => {
  const row = await getCapture(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such capture" } }, 404)
  return c.json(row)
})

captures.get("/:id/blob", async (c) => {
  const row = await getCapture(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such capture" } }, 404)
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

captures.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getCapture(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "capture", id, existing.chunk_count)
  await deleteBlob(c.env, existing.r2_key)
  await deleteCapture(c.env, id)
  return c.body(null, 204)
})

export { captures as default }

/**
 * Time-sortable id generator. ULID-shaped (26 chars, Crockford base32)
 * so captures sort lexicographically by creation time. Identical surface
 * to the existing ulid helper, but inlined here so the route stays
 * dependency-light.
 */
function newCaptureId(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  const now = Date.now()
  const timePart = encodeTime(now, 10, alphabet)
  let random = ""
  for (let i = 0; i < 16; i++) {
    random += alphabet[Math.floor(Math.random() * 32)]
  }
  void ULID_REGEX
  void updateCapture
  return timePart + random
}

function encodeTime(t: number, len: number, alphabet: string): string {
  let s = ""
  let n = t
  for (let i = 0; i < len; i++) {
    s = alphabet[n % 32] + s
    n = Math.floor(n / 32)
  }
  return s
}
