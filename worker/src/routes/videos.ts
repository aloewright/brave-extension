import { Hono } from "hono"
import type { Env } from "../env"
import { insertRecording, type RecordingRow, type RecordingStatus } from "../db"
import { keyFor, putBlob } from "../r2"
import { fetchCobaltMedia, requestCobaltDownload } from "../lib/cobalt"
import { kickIngest } from "../workflows/ingest"

const videos = new Hono<{ Bindings: Env }>()

interface ImportBody {
  url?: string
  id?: string
  filename?: string
  video_quality?: string
  download_mode?: string
}

function inferExt(filename: string, mime: string): string {
  if (/\.mov$/i.test(filename) || /quicktime/i.test(mime)) return "mov"
  if (/\.webm$/i.test(filename) || /webm/i.test(mime)) return "webm"
  return "mp4"
}

videos.post("/import", async (c) => {
  let body: ImportBody
  try {
    body = (await c.req.json()) as ImportBody
  } catch {
    return c.json({ error: { code: "bad_request", message: "invalid JSON body" } }, 400)
  }

  if (!body.url || typeof body.url !== "string") {
    return c.json({ error: { code: "bad_request", message: "url required" } }, 400)
  }

  const id = typeof body.id === "string" && body.id ? body.id : crypto.randomUUID()

  let cobalt
  try {
    cobalt = await requestCobaltDownload(c.env, body.url, {
      videoQuality: body.video_quality,
      downloadMode: body.download_mode,
    })
  } catch (err) {
    return c.json(
      {
        error: {
          code: "cobalt_unreachable",
          message: err instanceof Error ? err.message : "cobalt request failed",
        },
      },
      502,
    )
  }

  if (cobalt.status === "error") {
    return c.json(
      {
        error: {
          code: "cobalt_error",
          message: cobalt.error.code,
          context: cobalt.error.context ?? null,
        },
      },
      422,
    )
  }

  if (cobalt.status === "picker") {
    return c.json(
      { error: { code: "cobalt_picker", message: "page requires manual format selection" } },
      422,
    )
  }

  let bytes: Uint8Array
  let filename: string
  let mime: string
  try {
    ;({ bytes, filename, mime } = await fetchCobaltMedia(c.env, cobalt))
  } catch (err) {
    return c.json(
      {
        error: {
          code: "cobalt_media_fetch_failed",
          message: err instanceof Error ? err.message : "media download failed",
        },
      },
      502,
    )
  }
  const finalName = body.filename ?? filename
  const ext = inferExt(finalName, mime)
  const r2Key = keyFor("recording", id, ext)

  await putBlob(c.env, r2Key, bytes, { contentType: mime, size: bytes.byteLength })

  const now = Date.now()
  const row: RecordingRow = {
    id,
    filename: finalName,
    mime_type: mime,
    duration_ms: 0,
    size_bytes: bytes.byteLength,
    source: "tab",
    origin_url: body.url,
    r2_key: r2Key,
    transcript: null,
    status: "pending",
    status_message: null,
    workflow_id: null,
    chunk_count: 0,
    created_at: now,
    updated_at: now,
  }
  await insertRecording(c.env, row)
  const workflowId = await kickIngest(c.env, "recording", id)
  if (workflowId) {
    await c.env.DB.prepare("UPDATE recordings SET workflow_id = ?, updated_at = ? WHERE id = ?")
      .bind(workflowId, Date.now(), id)
      .run()
  }

  return c.json(
    {
      id,
      status: "pending" as RecordingStatus,
      r2_key: r2Key,
      workflow_id: workflowId,
      source: "cobalt",
      origin_url: body.url,
      size_bytes: bytes.byteLength,
    },
    201,
  )
})

export default videos
