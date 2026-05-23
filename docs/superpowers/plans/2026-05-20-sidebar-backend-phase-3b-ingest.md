# Sidebar Backend — Phase 3b: Ingest Workflow

> Stacked on Phase 3a (PR #38). Adds transcription, PDF text extraction, embedding, and Vectorize upsert behind a durable Workflow so uploads become searchable.

**Goal:** Move `pending` recordings/PDFs to `ready` (with `transcript`/`text_content`, `chunk_count > 0`, vectors upserted) via a durable per-blob pipeline. Failed runs land in `status='failed'` with a retry endpoint.

**Architecture key insight:** Keep the ingest logic in a pure `runIngest(env, type, id)` function. The `WorkflowEntrypoint` class is a thin wrapper that calls one `step.do` block per stage. The reingest endpoint reuses the same function. This makes the logic testable without a Workflows runtime.

**Tech Stack:** Same as Phase 3a + `@cf/openai/whisper` (Workers AI), `pdfjs-dist` for PDF text extraction (LLaVA OCR fallback if the text layer is empty), `Cloudflare Workflows` binding.

**Spec:** `docs/superpowers/specs/2026-05-20-sidebar-backend-worker-design.md` §6.

---

## Task 1: Extraction wrappers

**Files:**
- Modify: `worker/src/env.ts` — add Whisper + LLaVA model ids
- Modify: `worker/src/ai.ts` — add `transcribeAudio(env, bytes)`
- Create: `worker/src/pdf.ts` — `extractPdfText(bytes)` via `pdfjs-dist`, with OCR fallback via `env.AI` (vision model)
- Add: `pdfjs-dist` to dependencies
- Create: `worker/tests/pdf.test.ts`
- Modify: `worker/tests/ai.test.ts` — add transcribe test

Behaviour notes:
- `transcribeAudio` accepts `Uint8Array | number[]` (Workers AI prefers the array form) and returns `{ text, segments? }`. Falls back to `text=""` on empty response.
- `extractPdfText` first runs pdfjs's text-layer extractor over every page; if the total length is < 50 chars across all pages, calls the vision model on the first 3 pages as PNGs (skipped in Phase 3b if PDF rasterization proves heavy — initial version may return `{ text: "", needsOcr: true }` and we ship OCR as a follow-up).

Commit: `feat(worker): transcribeAudio + extractPdfText wrappers`.

## Task 2: Pure ingest pipeline

**Files:**
- Create: `worker/src/workflows/ingest.ts` — `runIngest(env, type, id)`
- Create: `worker/tests/ingest.test.ts`

`runIngest` orchestrates:
1. **Load row** — `getRecording` or `getPdf`. Return early when `status==='ready'`.
2. **Mark in-progress** — update `status` to `'transcribing'` (recording) or `'extracting'` (pdf).
3. **Fetch blob** — `getBlob(env, row.r2_key)`; if missing, fail with `status_message`.
4. **Extract content** — call `transcribeAudio` for recordings, `extractPdfText` for PDFs.
5. **Persist text** — `updateRecording { transcript }` / `updatePdf { text_content, page_count }`. `status='embedding'`.
6. **Embed** — `upsertFor(env, type, id, text, { title, createdAt })`. If chunkCount=0 (empty extraction), set `status='ready'`, `chunk_count=0`, return.
7. **Persist chunk_count + mark ready** — `updateXxx { chunk_count, status: 'ready' }`.

On any thrown error, set `status='failed'` with the error message and rethrow (Workflows replays on throws; the route catches when calling `runIngest` directly).

Each step is its own function so tests can isolate behaviour.

## Task 3: WorkflowEntrypoint + binding

**Files:**
- Append to `worker/src/workflows/ingest.ts` — `IngestWorkflow` class with `run(event, step)` that calls `step.do("ingest", () => runIngest(env, params.type, params.id))`.
- Modify: `worker/src/index.ts` — re-export `IngestWorkflow`.
- Modify: `worker/wrangler.toml`:

  ```toml
  [[workflows]]
  binding = "INGEST"
  name = "sidebar-ingest"
  class_name = "IngestWorkflow"
  ```

- Modify: `worker/src/env.ts` — `INGEST: Workflow`
- Modify: `worker/src/routes/recordings.ts` + `worker/src/routes/pdfs.ts` — after `insertRecording`/`insertPdf`, kick the workflow:

  ```ts
  const instance = await c.env.INGEST.create({ params: { type: "recording", id: meta.id } })
  await updateRecording(c.env, meta.id, { workflow_id: instance.id, updated_at: Date.now() })
  ```

  If `INGEST` is unavailable (e.g., in tests without the binding), fall back to inline `runIngest(c.env, "recording", meta.id).catch(() => {})` and skip `workflow_id`.
- Modify: `worker/tests/helpers.ts` — stub `env.INGEST` with `vi.fn()` that returns `{ id: "wf-test" }` and does not actually run anything.

Routes still return 201 immediately; Workflow runs asynchronously.

## Task 4: Reingest endpoints

- `POST /api/recordings/:id/reingest` — refuse if row missing; reset `status='pending'`, `status_message=null`, `transcript=null`, `chunk_count=0`, clear old vectors via `deleteFor`, then create a new Workflow instance.
- Same shape for `POST /api/pdfs/:id/reingest`.
- 4 tests: happy path resets status + clears vectors, 404, 401, idempotent re-invoke is allowed.

## Task 5: Open the PR

- Push branch, open PR stacked on Phase 3a.
- Title: `feat(worker): ingest Workflow — Phase 3b (transcription + embedding pipeline)`.
- Body explains the workflow handoff and where Workflow execution is tested vs deferred to CI/production.

---

## Known gaps (deliberate)

- **pdfjs-dist runtime** — first cut may need a custom build to run under workerd; if it doesn't import cleanly we ship with text-layer disabled and the PDF row stays `status='pending'` with `status_message='extraction skipped — pending pdfjs runtime fix'` until a follow-up wires either OCR-only or a server-side pre-extracted text.
- **OCR fallback (`@cf/llava-hf/llava-1.5-7b-hf`)** — included if pdfjs path works; otherwise deferred.
- **Workflow runtime tests** — only `runIngest` is unit-tested. The `IngestWorkflow` class is exercised end-to-end by deployment smoke tests, not vitest.

## Done criteria

- `pnpm test` passes (target 96 + ~6 ingest + ~4 pdf + ~4 reingest ≈ 110).
- `pnpm typecheck` clean.
- `wrangler deploy --dry-run` bundles with bindings DB / VECTORS / BLOBS / AI / INGEST.
- After deploy: `POST /api/recordings` with a real .mp4 returns 201; polling `GET /:id` shows the row transition `pending → transcribing → embedding → ready` (or `failed` with a message).
