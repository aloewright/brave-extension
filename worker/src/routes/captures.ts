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

  const displayFilename =
    kindRaw === "screenshot"
      ? filenameFromUrlAndVisibleText(filename, sourceUrl, extractedText, ext)
      : filename

  // Embed metadata + extracted text so the user can find the capture by
  // visible content OR by URL/title.
  const embedText = captureSearchText({
    filename: displayFilename,
    sourceTitle,
    sourceUrl,
    extractedText
  })

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
    filename: displayFilename,
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
      filename: displayFilename,
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

captures.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const row = await getCapture(c.env, id)
  if (!row) return c.json({ error: { code: "not_found", message: "no such capture" } }, 404)

  let payload: { filename?: unknown }
  try {
    payload = await c.req.json()
  } catch {
    return c.json({ error: { code: "bad_request", message: "JSON body required" } }, 400)
  }

  if (typeof payload.filename !== "string") {
    return c.json({ error: { code: "bad_request", message: "filename must be a string" } }, 400)
  }

  const filename = normalizeEditedFilename(payload.filename, row.filename, row.mime_type, row.kind)
  if (!filename) {
    return c.json({ error: { code: "bad_request", message: "filename must include visible text" } }, 400)
  }

  let chunkCount = row.chunk_count
  const embedText = captureSearchText({
    filename,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    extractedText: row.extracted_text ?? ""
  })
  if (embedText.trim().length > 0) {
    await deleteFor(c.env, "capture", id, row.chunk_count)
    const r = await upsertFor(c.env, "capture", id, embedText, {
      title: filename,
      createdAt: row.created_at
    })
    chunkCount = r.chunkCount
  }

  const now = Date.now()
  await updateCapture(c.env, id, { filename, chunk_count: chunkCount, updated_at: now })
  return c.json({
    id,
    kind: row.kind,
    filename,
    sourceUrl: row.source_url,
    sourceTitle: row.source_title,
    sizeBytes: row.size_bytes,
    mimeType: row.mime_type,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    blobUrl: `/api/captures/${id}/blob`
  })
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

function captureSearchText(input: {
  filename: string
  sourceTitle: string | null
  sourceUrl: string | null
  extractedText: string
}): string {
  return [input.filename, input.sourceTitle, input.sourceUrl, input.extractedText]
    .filter((s) => typeof s === "string" && s.length > 0)
    .join("\n")
}

function filenameFromUrlAndVisibleText(
  originalFilename: string,
  sourceUrl: string | null,
  visibleText: string,
  ext: string
): string {
  const urlPart = slugFromUrl(sourceUrl)
  const visualPart = slugFromVisibleText(visibleText)
  const stem = [urlPart, visualPart].filter(Boolean).join("-")
  if (!stem) return originalFilename
  return `${stem.slice(0, 96).replace(/-+$/g, "")}.${ext}`
}

function slugFromUrl(sourceUrl: string | null): string {
  if (!sourceUrl) return ""
  try {
    const url = new URL(sourceUrl)
    const host = url.hostname.replace(/^www\./i, "")
    const pathParts = url.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(-3)
    return slugify([host, ...pathParts].join(" "))
  } catch {
    return slugify(sourceUrl)
  }
}

function slugFromVisibleText(text: string): string {
  const stopWords = new Set([
    "and", "are", "but", "for", "from", "has", "have", "not", "the", "this",
    "that", "with", "you", "your"
  ])
  const words = text
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9'-]{2,}/g)
    ?.map((word) => word.replace(/['-]+/g, ""))
    .filter((word) => word.length >= 3 && !stopWords.has(word)) ?? []
  return Array.from(new Set(words)).slice(0, 6).join("-")
}

function normalizeEditedFilename(
  input: string,
  currentFilename: string,
  mimeType: string,
  kind: CaptureKind
): string | null {
  const cleaned = input
    .replace(/[\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null

  const currentExt = extensionFor(currentFilename, mimeType, kind)
  const hasExt = /\.[a-z0-9]{2,5}$/i.test(cleaned)
  const withExt = hasExt ? cleaned : `${cleaned}.${currentExt}`
  return withExt.replace(/[<>:"|?*\u0000-\u001f]/g, "").slice(0, 160).trim() || null
}

function extensionFor(filename: string, mimeType: string, kind: CaptureKind): string {
  const match = filename.match(/\.([a-z0-9]{2,5})$/i)
  if (match) return match[1]!.toLowerCase()
  return inferExt(kind, filename, mimeType)
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
