# Sidebar Backend — Phase 3: Blob Storage (R2 + Recordings + PDFs)

> **For agentic workers:** Phase 3 is split into 3a (upload routes, this plan) and 3b (ingest Workflow — transcription, OCR, async embed; lives in a follow-up plan and PR).

**Goal (Phase 3a):** Add R2 to the Worker, ship `/api/recordings` and `/api/pdfs` with upload + list + get-metadata + stream-blob + delete. Rows land as `status='pending'` with no transcript / extracted text and zero vectors. The extension can already start uploading; search picks them up once Phase 3b's Workflow runs.

**Architecture (3a):** Multipart uploads stream straight into `R2.put` (≤100 MB inline; multipart upload reserved for 3b). Each row gets an R2 key `recordings/<id>.<ext>` or `pdfs/<id>.pdf` plus the metadata persisted in D1. `GET /:id/blob` re-streams the R2 object with `Content-Disposition: inline` so the web UI can use `<video>` and `<embed type="application/pdf">` directly. No Vectorize touch in 3a.

**Tech Stack:** Same as Phase 1/2 + `R2Bucket` binding. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-20-sidebar-backend-worker-design.md` §5.5 + §5.6.

---

## Task 1: R2 binding + helpers + test fake

**Files:**
- Modify: `worker/src/env.ts` — add `BLOBS: R2Bucket`
- Modify: `worker/wrangler.toml` — declare R2 bucket
- Create: `worker/src/r2.ts` — `putBlob`, `getBlob`, `deleteBlob`, `keyFor`
- Modify: `worker/tests/helpers.ts` — fake R2 backed by an in-memory map
- Create: `worker/tests/r2.test.ts`

- [ ] **Step 1: Add the binding to Env** — append to `worker/src/env.ts`:

```ts
export interface Env {
  DB: D1Database
  VECTORS: VectorizeIndex
  AI: Ai
  BLOBS: R2Bucket
  SIDEBAR_TOKEN: string
}
```

- [ ] **Step 2: Declare the R2 bucket in `worker/wrangler.toml`** (after the `[[vectorize]]` block):

```toml
[[r2_buckets]]
binding = "BLOBS"
bucket_name = "sidebar-blobs"
```

- [ ] **Step 3: Create `worker/src/r2.ts`**

```ts
import type { Env } from "./env"

export type BlobType = "recording" | "pdf"

/** Deterministic R2 key for a given resource. */
export function keyFor(type: BlobType, id: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "").toLowerCase()
  return type === "recording" ? `recordings/${id}.${cleanExt}` : `pdfs/${id}.${cleanExt}`
}

export async function putBlob(
  env: Env,
  key: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob,
  opts: { contentType: string; size?: number }
): Promise<{ etag: string }> {
  const obj = await env.BLOBS.put(key, body, {
    httpMetadata: { contentType: opts.contentType }
  })
  if (!obj) throw new Error(`R2 put failed for key: ${key}`)
  return { etag: obj.etag }
}

export async function getBlob(env: Env, key: string): Promise<R2ObjectBody | null> {
  return (await env.BLOBS.get(key)) ?? null
}

export async function deleteBlob(env: Env, key: string): Promise<void> {
  await env.BLOBS.delete(key)
}
```

- [ ] **Step 4: Add a fake R2 to `worker/tests/helpers.ts`** — extend `makeEnv()` to return `BLOBS`:

```ts
// Inside makeEnv(), alongside the AI and VECTORS stubs:
const blobStore = new Map<string, { body: Uint8Array; contentType: string; etag: string }>()
let blobCounter = 0

const blobs = {
  async put(
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob | null,
    opts?: R2PutOptions
  ) {
    const bytes = await toUint8(body)
    const etag = `etag-${++blobCounter}`
    blobStore.set(key, {
      body: bytes,
      contentType: opts?.httpMetadata?.contentType ?? "application/octet-stream",
      etag
    })
    return {
      key,
      version: "1",
      size: bytes.byteLength,
      etag,
      httpEtag: `"${etag}"`,
      uploaded: new Date(),
      httpMetadata: { contentType: opts?.httpMetadata?.contentType }
    } as unknown as R2Object
  },
  async get(key: string): Promise<R2ObjectBody | null> {
    const entry = blobStore.get(key)
    if (!entry) return null
    const arr = entry.body
    return {
      key,
      size: arr.byteLength,
      etag: entry.etag,
      httpEtag: `"${entry.etag}"`,
      uploaded: new Date(),
      httpMetadata: { contentType: entry.contentType },
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(arr)
          ctrl.close()
        }
      }),
      async arrayBuffer() {
        const buf = new ArrayBuffer(arr.byteLength)
        new Uint8Array(buf).set(arr)
        return buf
      },
      async text() {
        return new TextDecoder().decode(arr)
      },
      async json<T>() {
        return JSON.parse(new TextDecoder().decode(arr)) as T
      },
      async blob() {
        return new Blob([arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)], { type: entry.contentType })
      },
      writeHttpMetadata() {},
      bodyUsed: false
    } as unknown as R2ObjectBody
  },
  async delete(key: string) {
    blobStore.delete(key)
  },
  async head(key: string) {
    const e = blobStore.get(key)
    return e ? ({ key, size: e.body.byteLength, etag: e.etag } as unknown as R2Object) : null
  }
} as unknown as R2Bucket

// Helper near the bottom of helpers.ts (sibling of fakeVector):
async function toUint8(
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob | null
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}
```

Return `BLOBS: blobs` alongside the other bindings in `makeEnv`'s return object.

- [ ] **Step 5: Create `worker/tests/r2.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { putBlob, getBlob, deleteBlob, keyFor } from "../src/r2"

describe("r2", () => {
  it("keyFor namespaces recordings and pdfs", () => {
    expect(keyFor("recording", "abc", "mp4")).toBe("recordings/abc.mp4")
    expect(keyFor("recording", "abc", ".MOV")).toBe("recordings/abc.mov")
    expect(keyFor("pdf", "xyz", "pdf")).toBe("pdfs/xyz.pdf")
  })

  it("putBlob then getBlob round-trips bytes and content-type", async () => {
    const env = makeEnv()
    const data = new TextEncoder().encode("hello world")
    await putBlob(env, "recordings/r1.mp4", data, { contentType: "video/mp4", size: data.byteLength })
    const got = await getBlob(env, "recordings/r1.mp4")
    expect(got).not.toBeNull()
    expect(got!.httpMetadata?.contentType).toBe("video/mp4")
    expect(new TextDecoder().decode(await got!.arrayBuffer())).toBe("hello world")
  })

  it("getBlob returns null for missing keys", async () => {
    const env = makeEnv()
    expect(await getBlob(env, "nope")).toBeNull()
  })

  it("deleteBlob removes the object", async () => {
    const env = makeEnv()
    await putBlob(env, "k", new Uint8Array([1, 2, 3]), { contentType: "application/octet-stream" })
    await deleteBlob(env, "k")
    expect(await getBlob(env, "k")).toBeNull()
  })
})
```

- [ ] **Step 6: Run + commit**

```bash
cd worker && pnpm test r2.test && pnpm typecheck
git add worker/src/env.ts worker/src/r2.ts worker/tests/helpers.ts worker/tests/r2.test.ts worker/wrangler.toml
git commit -m "feat(worker): R2 binding + put/get/delete helpers + test fake"
```

---

## Task 2: Recording DB helpers

**Files:**
- Modify: `worker/src/db.ts` — append RecordingRow + helpers
- Modify: `worker/tests/db.test.ts` — append a `describe("db - recordings")` block

- [ ] **Step 1: Append to `worker/src/db.ts`**

```ts
// ── Recording queries ──────────────────────────────────────────────────────
export type RecordingStatus = "pending" | "transcribing" | "embedding" | "ready" | "failed"

export interface RecordingRow {
  id: string
  filename: string
  mime_type: string
  duration_ms: number
  size_bytes: number
  source: string                // 'tab'|'screen'|'camera'
  origin_url: string | null
  r2_key: string
  transcript: string | null
  status: RecordingStatus
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export async function insertRecording(env: Env, row: RecordingRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO recordings
       (id, filename, mime_type, duration_ms, size_bytes, source, origin_url,
        r2_key, transcript, status, status_message, workflow_id, chunk_count,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.filename, row.mime_type, row.duration_ms, row.size_bytes,
      row.source, row.origin_url, row.r2_key, row.transcript, row.status,
      row.status_message, row.workflow_id, row.chunk_count,
      row.created_at, row.updated_at
    )
    .run()
}

export async function getRecording(env: Env, id: string): Promise<RecordingRow | null> {
  return (await env.DB.prepare("SELECT * FROM recordings WHERE id = ?").bind(id).first<RecordingRow>()) ?? null
}

export async function listRecordings(
  env: Env,
  opts: { status?: RecordingStatus; limit?: number; before?: number } = {}
): Promise<RecordingRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.status) { where.push("status = ?"); binds.push(opts.status) }
  if (opts.before) { where.push("created_at < ?"); binds.push(opts.before) }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM recordings ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<RecordingRow>()
  return results ?? []
}

export async function updateRecording(
  env: Env,
  id: string,
  patch: {
    transcript?: string | null
    status?: RecordingStatus
    status_message?: string | null
    workflow_id?: string | null
    chunk_count?: number
    updated_at: number
  }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number | null)[] = []
  if (patch.transcript !== undefined) { sets.push("transcript = ?"); binds.push(patch.transcript) }
  if (patch.status !== undefined) { sets.push("status = ?"); binds.push(patch.status) }
  if (patch.status_message !== undefined) { sets.push("status_message = ?"); binds.push(patch.status_message) }
  if (patch.workflow_id !== undefined) { sets.push("workflow_id = ?"); binds.push(patch.workflow_id) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE recordings SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deleteRecording(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM recordings WHERE id = ?").bind(id).run()
}
```

- [ ] **Step 2: Add 5 tests at the end of `worker/tests/db.test.ts`** — insert/read, list-newest-first, status filter, update bumps `updated_at`, delete.

- [ ] **Step 3: Commit**

```bash
cd worker && pnpm test db.test && pnpm typecheck
git add worker/src/db.ts worker/tests/db.test.ts
git commit -m "feat(worker): D1 helpers for recordings (insert/get/list/update/delete)"
```

---

## Task 3: Recording routes

**Files:**
- Create: `worker/src/routes/recordings.ts`
- Modify: `worker/src/index.ts` — mount `/api/recordings`
- Create: `worker/tests/routes/recordings.test.ts`

- [ ] **Step 1: Create `worker/src/routes/recordings.ts`**

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteRecording, getRecording, insertRecording, listRecordings,
  type RecordingRow
} from "../db"
import { deleteFor } from "../vectors"
import { deleteBlob, getBlob, keyFor, putBlob } from "../r2"

const recordings = new Hono<{ Bindings: Env }>()

interface MetadataPayload {
  id: string
  filename: string
  mime_type?: string
  duration_ms?: number
  source?: "tab" | "screen" | "camera"
  origin_url?: string | null
}

function inferExt(filename: string, mime: string): string {
  if (/\.mov$/i.test(filename) || /quicktime/.test(mime)) return "mov"
  return "mp4"
}

recordings.post("/", async (c) => {
  const ct = c.req.header("content-type") ?? ""
  if (!ct.startsWith("multipart/form-data")) {
    return c.json({ error: { code: "bad_request", message: "expected multipart/form-data" } }, 400)
  }
  const form = await c.req.formData()
  const metaRaw = form.get("metadata")
  const file = form.get("file")
  if (typeof metaRaw !== "string" || !(file instanceof Blob)) {
    return c.json({ error: { code: "bad_request", message: "metadata (string) + file (blob) required" } }, 400)
  }
  let meta: MetadataPayload
  try { meta = JSON.parse(metaRaw) as MetadataPayload }
  catch { return c.json({ error: { code: "bad_request", message: "metadata must be valid JSON" } }, 400) }

  if (!meta.id || !meta.filename) {
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

  return c.json({ id: meta.id, status: "pending", r2_key: r2Key }, 201)
})

recordings.get("/", async (c) => {
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const status = c.req.query("status") as RecordingRow["status"] | undefined
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
  return new Response(obj.body, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(row.size_bytes),
      "content-disposition": `inline; filename="${row.filename.replace(/"/g, "")}"`,
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
```

- [ ] **Step 2: Wire in `worker/src/index.ts`** — add `import recordings from "./routes/recordings"` and `app.route("/api/recordings", recordings)`.

- [ ] **Step 3: Create `worker/tests/routes/recordings.test.ts`**

7 tests:
1. POST multipart uploads → 201 with `{id, status:"pending", r2_key}`. R2 put called. DB row written with status `pending` and chunk_count 0.
2. POST without metadata → 400.
3. POST with non-multipart Content-Type → 400.
4. GET list returns newest-first.
5. GET /:id → row; missing id → 404.
6. GET /:id/blob streams the bytes with correct Content-Type and Content-Disposition; missing → 404.
7. DELETE removes D1 row + R2 blob + Vectorize entries (deleteByIds called).
8. 401 without token.

(Use a small `Uint8Array` payload + `new FormData()`/`new File()` patterns.)

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/recordings.ts worker/src/index.ts worker/tests/routes/recordings.test.ts
git commit -m "feat(worker): /api/recordings upload + crud (status=pending; ingest deferred)"
```

---

## Task 4: PDF DB helpers + routes

Mirror Task 2 + Task 3 for PDFs. Same patterns; differences:
- `PdfRow` has `text_content` instead of `transcript`, optional `page_count` and `source_url`.
- `/api/pdfs/:id/blob` streams `application/pdf` with `inline` disposition.
- `keyFor("pdf", id, "pdf")`.

Files to create / modify:
- `worker/src/db.ts` — append `PdfRow` + helpers
- `worker/src/routes/pdfs.ts`
- `worker/src/index.ts` — mount `/api/pdfs`
- `worker/tests/db.test.ts` — bookmark-style db tests for pdfs
- `worker/tests/routes/pdfs.test.ts` — recording-style route tests for pdfs

Commit:

```bash
git add worker/src/db.ts worker/src/routes/pdfs.ts worker/src/index.ts worker/tests/db.test.ts worker/tests/routes/pdfs.test.ts
git commit -m "feat(worker): /api/pdfs upload + crud (status=pending; ingest deferred)"
```

---

## Task 5: Open the Phase 3a PR

- Push the branch.
- Open PR against the Phase 2 branch (so it stacks).
- Title: `feat(worker): R2 uploads — Phase 3a (recordings + pdfs)`
- Body explains 3a scope and explicitly defers transcription/OCR/embedding to a follow-up Phase 3b PR.

---

## Out of scope for Phase 3a (lands in Phase 3b)

- `worker/src/workflows/ingest.ts` — Workflows binding + per-blob durable pipeline.
- Whisper transcription, pdfjs-dist text-layer extraction, LLaVA OCR fallback.
- Chunking transcripts/PDF text, embedding, Vectorize upsert.
- `POST /api/recordings/:id/reingest` and `POST /api/pdfs/:id/reingest`.
- Update `wrangler.toml` to declare the Workflows binding (`[[workflows]]`).

## Done criteria for Phase 3a

- `pnpm test` all green (target 66 + 5 r2 + 5 recording-db + 8 recording-route + 5 pdf-db + 8 pdf-route ≈ 97 tests).
- `pnpm typecheck` clean.
- `wrangler deploy --dry-run` bundles with DB / VECTORS / AI / BLOBS bindings present.
- PR opened against the Phase 2 branch.
