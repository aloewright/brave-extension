import { beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import {
  insertRecording, insertPdf, getRecording, getPdf,
  type RecordingRow, type PdfRow
} from "../../src/db"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

function recordingRow(id: string, overrides: Partial<RecordingRow> = {}): RecordingRow {
  return {
    id, filename: `${id}.mp4`, mime_type: "video/mp4",
    duration_ms: 0, size_bytes: 0, source: "screen", origin_url: null,
    r2_key: `recordings/${id}.mp4`, transcript: "old transcript",
    status: "failed", status_message: "previous run failed",
    workflow_id: "wf-prev", chunk_count: 3, created_at: 1, updated_at: 1,
    ...overrides
  }
}

function pdfRow(id: string, overrides: Partial<PdfRow> = {}): PdfRow {
  return {
    id, filename: `${id}.pdf`, title: null, source_url: null,
    size_bytes: 0, page_count: null, r2_key: `pdfs/${id}.pdf`,
    text_content: "old text",
    status: "failed", status_message: "previous run failed",
    workflow_id: "wf-prev", chunk_count: 2, created_at: 1, updated_at: 1,
    ...overrides
  }
}

describe("POST /api/recordings/:id/reingest", () => {
  let env: Env
  beforeEach(() => { env = makeEnv() })

  it("resets the row, clears vectors, and returns pending", async () => {
    await insertRecording(env, recordingRow("rec1"))

    const res = await authed(env, "/api/recordings/rec1/reingest", { method: "POST" })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; status: string; workflow_id: string | null }
    expect(body.id).toBe("rec1")
    expect(body.status).toBe("pending")

    expect(env.VECTORS.deleteByIds).toHaveBeenCalledWith([
      "recording:rec1:0", "recording:rec1:1", "recording:rec1:2"
    ])
    const row = await getRecording(env, "rec1")
    expect(row?.status).toBe("pending")
    expect(row?.transcript).toBeNull()
    expect(row?.status_message).toBeNull()
    expect(row?.chunk_count).toBe(0)
  })

  it("kicks the workflow when env.INGEST is present", async () => {
    const createInstance = vi.fn(async () => ({ id: "wf-new" }))
    const ingestBinding = { create: createInstance } as unknown as Workflow
    const localEnv = makeEnv({ INGEST: ingestBinding })
    await insertRecording(localEnv, recordingRow("rec2"))

    const res = await authed(localEnv, "/api/recordings/rec2/reingest", { method: "POST" })
    const body = (await res.json()) as { workflow_id: string | null }
    expect(body.workflow_id).toBe("wf-new")
    expect(createInstance).toHaveBeenCalledWith({ params: { type: "recording", id: "rec2" } })
    expect((await getRecording(localEnv, "rec2"))?.workflow_id).toBe("wf-new")
  })

  it("404s when the row doesn't exist", async () => {
    const res = await authed(env, "/api/recordings/nope/reingest", { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("requires the token", async () => {
    const res = await app.fetch(
      new Request("http://x/api/recordings/rec1/reingest", { method: "POST" }),
      env
    )
    expect(res.status).toBe(401)
  })

  it("is idempotent — re-invoke on a pending row succeeds", async () => {
    await insertRecording(env, recordingRow("rec3", { status: "pending", chunk_count: 0 }))
    const res1 = await authed(env, "/api/recordings/rec3/reingest", { method: "POST" })
    const res2 = await authed(env, "/api/recordings/rec3/reingest", { method: "POST" })
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(200)
  })
})

describe("POST /api/pdfs/:id/reingest", () => {
  let env: Env
  beforeEach(() => { env = makeEnv() })

  it("resets the row and clears vectors", async () => {
    await insertPdf(env, pdfRow("p1"))

    const res = await authed(env, "/api/pdfs/p1/reingest", { method: "POST" })
    expect(res.status).toBe(200)
    expect(env.VECTORS.deleteByIds).toHaveBeenCalledWith([
      "pdf:p1:0", "pdf:p1:1"
    ])
    const row = await getPdf(env, "p1")
    expect(row?.status).toBe("pending")
    expect(row?.text_content).toBeNull()
    expect(row?.page_count).toBeNull()
    expect(row?.chunk_count).toBe(0)
  })

  it("404s when the row doesn't exist", async () => {
    const res = await authed(env, "/api/pdfs/nope/reingest", { method: "POST" })
    expect(res.status).toBe(404)
  })

  it("requires the token", async () => {
    const res = await app.fetch(
      new Request("http://x/api/pdfs/p1/reingest", { method: "POST" }),
      env
    )
    expect(res.status).toBe(401)
  })
})
