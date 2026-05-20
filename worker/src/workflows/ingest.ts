import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import type { Env } from "../env"
import { transcribeAudio } from "../ai"
import { extractPdfText } from "../pdf"
import { getBlob } from "../r2"
import {
  getPdf, getRecording, updatePdf, updateRecording,
  type PdfRow, type RecordingRow
} from "../db"
import { deleteFor, upsertFor } from "../vectors"

export type IngestType = "recording" | "pdf"

export interface IngestParams {
  type: IngestType
  id: string
}

export interface IngestResult {
  status: "ready" | "failed"
  chunkCount: number
  textLength: number
  message?: string
}

/**
 * Durable ingest pipeline. Runs the same steps for recordings and PDFs:
 *   1. Load the D1 row (early return when already ready).
 *   2. Mark in-progress.
 *   3. Fetch the blob from R2.
 *   4. Extract content (whisper transcript / pdfjs text + OCR fallback).
 *   5. Persist the extracted text.
 *   6. Chunk + embed + upsert into Vectorize.
 *   7. Mark ready (or failed on any thrown error).
 *
 * The function is pure-ish — it only touches the bindings on `env`. The
 * IngestWorkflow class wraps each numbered step in `step.do` so Cloudflare
 * Workflows can replay it. The reingest endpoint calls runIngest directly
 * when running inline.
 */
export async function runIngest(env: Env, type: IngestType, id: string): Promise<IngestResult> {
  const row = await loadRow(env, type, id)
  if (!row) return { status: "failed", chunkCount: 0, textLength: 0, message: "row missing" }
  if (row.status === "ready") {
    return { status: "ready", chunkCount: row.chunk_count, textLength: textLengthOf(row) }
  }

  try {
    await setStatus(env, type, id, type === "recording" ? "transcribing" : "extracting")

    const blob = await getBlob(env, row.r2_key)
    if (!blob) throw new Error(`blob missing at ${row.r2_key}`)
    const bytes = new Uint8Array(await blob.arrayBuffer())

    const extracted = await extractFor(env, type, bytes)

    if (type === "recording") {
      await updateRecording(env, id, { transcript: extracted.text, status: "embedding", updated_at: Date.now() })
    } else {
      await updatePdf(env, id, {
        text_content: extracted.text,
        page_count: extracted.pageCount,
        status: "embedding",
        updated_at: Date.now()
      })
    }

    const title = type === "recording" ? (row as RecordingRow).filename : ((row as PdfRow).title ?? (row as PdfRow).filename)

    if (!extracted.text.trim()) {
      // Nothing to embed; row is still useful (file is in R2) so mark ready.
      await markReady(env, type, id, 0)
      return { status: "ready", chunkCount: 0, textLength: 0, message: "no extractable text" }
    }

    // Drop any stale vectors before re-embedding (matters on reingest).
    if (row.chunk_count > 0) await deleteFor(env, type, id, row.chunk_count)

    const { chunkCount } = await upsertFor(env, type, id, extracted.text, {
      title,
      createdAt: row.created_at
    })

    await markReady(env, type, id, chunkCount)
    return { status: "ready", chunkCount, textLength: extracted.text.length }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    await markFailed(env, type, id, message)
    return { status: "failed", chunkCount: 0, textLength: 0, message }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────
async function loadRow(env: Env, type: IngestType, id: string): Promise<RecordingRow | PdfRow | null> {
  return type === "recording" ? getRecording(env, id) : getPdf(env, id)
}

function textLengthOf(row: RecordingRow | PdfRow): number {
  return ("transcript" in row ? row.transcript : (row as PdfRow).text_content)?.length ?? 0
}

async function setStatus(env: Env, type: IngestType, id: string, status: RecordingRow["status"] | PdfRow["status"]): Promise<void> {
  const updated_at = Date.now()
  if (type === "recording") {
    await updateRecording(env, id, { status: status as RecordingRow["status"], status_message: null, updated_at })
  } else {
    await updatePdf(env, id, { status: status as PdfRow["status"], status_message: null, updated_at })
  }
}

async function markReady(env: Env, type: IngestType, id: string, chunkCount: number): Promise<void> {
  const updated_at = Date.now()
  if (type === "recording") {
    await updateRecording(env, id, { status: "ready", status_message: null, chunk_count: chunkCount, updated_at })
  } else {
    await updatePdf(env, id, { status: "ready", status_message: null, chunk_count: chunkCount, updated_at })
  }
}

async function markFailed(env: Env, type: IngestType, id: string, message: string): Promise<void> {
  const updated_at = Date.now()
  if (type === "recording") {
    await updateRecording(env, id, { status: "failed", status_message: message, updated_at })
  } else {
    await updatePdf(env, id, { status: "failed", status_message: message, updated_at })
  }
}

async function extractFor(
  env: Env,
  type: IngestType,
  bytes: Uint8Array
): Promise<{ text: string; pageCount: number | null }> {
  if (type === "recording") {
    const text = await transcribeAudio(env, bytes)
    return { text, pageCount: null }
  }
  const r = await extractPdfText(env, bytes)
  return { text: r.text, pageCount: r.pageCount }
}

/**
 * Cloudflare Workflows entrypoint. Wraps {@link runIngest} in a single
 * `step.do` so the run is durable and replayable. The Worker exports this
 * class so the runtime can instantiate it via the [[workflows]] binding.
 */
export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep): Promise<IngestResult> {
    const { type, id } = event.payload
    return await step.do(`ingest-${type}-${id}`, async () => {
      return await runIngest(this.env, type, id)
    })
  }
}

/**
 * Kick off the ingest workflow if the binding is available. Returns the
 * workflow instance id, or null when no Workflows binding is present.
 *
 * When INGEST is missing (tests, local-dev without the binding), the row
 * stays `status='pending'` and the caller can trigger work explicitly via
 * `POST /api/{recordings,pdfs}/:id/reingest`.
 */
export async function kickIngest(env: Env, type: IngestType, id: string): Promise<string | null> {
  if (!env.INGEST) return null
  const instance = await env.INGEST.create({ params: { type, id } })
  return instance.id
}
