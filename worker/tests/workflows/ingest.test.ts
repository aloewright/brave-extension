import { beforeEach, describe, expect, it, vi } from "vitest"
import { makeEnv } from "../helpers"
import type { Env } from "../../src/env"
import {
  insertRecording, insertPdf, getRecording, getPdf,
  type RecordingRow, type PdfRow
} from "../../src/db"
import { putBlob } from "../../src/r2"
import { runIngest } from "../../src/workflows/ingest"

function recordingRow(id: string, overrides: Partial<RecordingRow> = {}): RecordingRow {
  return {
    id, filename: `${id}.mp4`, mime_type: "video/mp4",
    duration_ms: 1000, size_bytes: 5,
    source: "screen", origin_url: null,
    r2_key: `recordings/${id}.mp4`,
    transcript: null,
    status: "pending", status_message: null, workflow_id: null,
    chunk_count: 0, created_at: 1, updated_at: 1,
    ...overrides
  }
}

function pdfRow(id: string, overrides: Partial<PdfRow> = {}): PdfRow {
  return {
    id, filename: `${id}.pdf`, title: null, source_url: null,
    size_bytes: 5, page_count: null,
    r2_key: `pdfs/${id}.pdf`,
    text_content: null,
    status: "pending", status_message: null, workflow_id: null,
    chunk_count: 0, created_at: 1, updated_at: 1,
    ...overrides
  }
}

describe("runIngest — recordings", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv({
      AI: { run: vi.fn(async (model: string, payload: any) => {
        if (String(model).includes("bge-base")) {
          return { data: (payload?.text ?? []).map(() => new Array(768).fill(0.1)) }
        }
        if (String(model).includes("whisper")) {
          return { text: "hello from whisper transcript content one two three" }
        }
        return {}
      }) } as unknown as Ai
    })
  })

  it("transcribes, embeds, and marks ready", async () => {
    await putBlob(env, "recordings/r1.mp4", new Uint8Array([1, 2, 3]), { contentType: "video/mp4" })
    await insertRecording(env, recordingRow("r1"))

    const result = await runIngest(env, "recording", "r1")
    expect(result.status).toBe("ready")
    expect(result.chunkCount).toBeGreaterThan(0)

    const row = await getRecording(env, "r1")
    expect(row?.status).toBe("ready")
    expect(row?.transcript).toContain("whisper transcript")
    expect(row?.chunk_count).toBeGreaterThan(0)
    expect(env.VECTORS.upsert).toHaveBeenCalled()
  })

  it("marks failed when the blob is missing", async () => {
    await insertRecording(env, recordingRow("r2"))
    const result = await runIngest(env, "recording", "r2")
    expect(result.status).toBe("failed")
    expect(result.message).toContain("blob missing")
    const row = await getRecording(env, "r2")
    expect(row?.status).toBe("failed")
    expect(row?.status_message).toContain("blob missing")
  })

  it("returns ready with chunkCount=0 when whisper returns nothing", async () => {
    const localEnv = makeEnv({
      AI: { run: vi.fn(async (model: string) => {
        if (String(model).includes("whisper")) return { text: "  " }
        return { data: [] }
      }) } as unknown as Ai
    })
    await putBlob(localEnv, "recordings/r3.mp4", new Uint8Array([9]), { contentType: "video/mp4" })
    await insertRecording(localEnv, recordingRow("r3"))

    const result = await runIngest(localEnv, "recording", "r3")
    expect(result.status).toBe("ready")
    expect(result.chunkCount).toBe(0)
    const row = await getRecording(localEnv, "r3")
    expect(row?.chunk_count).toBe(0)
    expect(row?.transcript).toBe("")
  })

  it("is idempotent — re-running on a ready row no-ops", async () => {
    await putBlob(env, "recordings/r4.mp4", new Uint8Array([1, 2, 3]), { contentType: "video/mp4" })
    await insertRecording(env, recordingRow("r4", { status: "ready", chunk_count: 2 }))
    const result = await runIngest(env, "recording", "r4")
    expect(result.status).toBe("ready")
    expect(result.chunkCount).toBe(2)
    expect(env.VECTORS.upsert).not.toHaveBeenCalled()
  })

  it("clears stale vectors before re-embedding on reingest", async () => {
    await putBlob(env, "recordings/r5.mp4", new Uint8Array([1, 2, 3]), { contentType: "video/mp4" })
    await insertRecording(env, recordingRow("r5", { chunk_count: 3 }))
    await runIngest(env, "recording", "r5")
    expect(env.VECTORS.deleteByIds).toHaveBeenCalledWith([
      "recording:r5:0", "recording:r5:1", "recording:r5:2"
    ])
  })
})

describe("runIngest — pdfs", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv({
      AI: { run: vi.fn(async (model: string, payload: any) => {
        if (String(model).includes("bge-base")) {
          return { data: (payload?.text ?? []).map(() => new Array(768).fill(0.2)) }
        }
        return {}
      }) } as unknown as Ai
    })
  })

  it("extracts (best-effort) and falls back to empty when no text is available", async () => {
    vi.resetModules()
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => {
      throw new Error("unavailable")
    })
    const { runIngest: ingest } = await import("../../src/workflows/ingest")
    const localEnv = makeEnv()
    await putBlob(localEnv, "pdfs/p1.pdf", new Uint8Array([1, 2, 3]), { contentType: "application/pdf" })
    await insertPdf(localEnv, pdfRow("p1"))

    const result = await ingest(localEnv, "pdf", "p1")
    expect(result.status).toBe("ready")
    expect(result.chunkCount).toBe(0)
    const row = await getPdf(localEnv, "p1")
    expect(row?.status).toBe("ready")
    expect(row?.text_content).toBe("")
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs")
  })

  it("embeds extracted text when pdfjs returns a usable text layer", async () => {
    vi.resetModules()
    const longText = "alpha beta gamma delta ".repeat(20) // ~440 chars
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: longText.split(" ").map((str) => ({ str })) })
          })
        })
      })
    }))
    const { runIngest: ingest } = await import("../../src/workflows/ingest")
    const localEnv = makeEnv({
      AI: { run: vi.fn(async (model: string, payload: any) => {
        if (String(model).includes("bge-base")) {
          return { data: (payload?.text ?? []).map(() => new Array(768).fill(0.3)) }
        }
        return {}
      }) } as unknown as Ai
    })
    await putBlob(localEnv, "pdfs/p2.pdf", new Uint8Array([1, 2, 3]), { contentType: "application/pdf" })
    await insertPdf(localEnv, pdfRow("p2"))

    const result = await ingest(localEnv, "pdf", "p2")
    expect(result.status).toBe("ready")
    expect(result.chunkCount).toBeGreaterThan(0)
    const row = await getPdf(localEnv, "p2")
    expect(row?.text_content?.length).toBeGreaterThan(0)
    expect(row?.page_count).toBe(1)
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs")
  })
})

describe("runIngest — generic", () => {
  it("returns failed when the row doesn't exist", async () => {
    const env = makeEnv()
    const result = await runIngest(env, "recording", "missing")
    expect(result.status).toBe("failed")
    expect(result.message).toContain("row missing")
  })
})
