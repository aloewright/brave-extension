# Captures: Full-page PDF + OCR-based auto-rename — Design

**Date:** 2026-06-07
**Status:** Approved (design); pending implementation plan
**Repo:** ai-dev-sidebar (extension `src/` + worker `worker/`)

## Goal

Two coordinated capture improvements:
1. **Full-page PDF capture** — add a "Save full-page PDF" action alongside the
   existing Screenshot quick action, saved through the **same** capture
   destination setting (downloads / subfolder / cloud), uploaded as `kind=pdf`
   when the destination is cloud.
2. **OCR-based auto-rename** — when a capture is ingested by the worker, after it
   extracts the OCR text (screenshots) or PDF text, generate a concise,
   filesystem-safe filename from that text via the AI Gateway and store it, so
   captures get meaningful names automatically instead of `screenshot-<timestamp>`.

## Decisions (from brainstorming)

- **Rename approach:** auto at ingest (worker generates the name from the
  extracted text and stores it). No manual button / `PATCH` endpoint in this
  spec.
- **PDF save destination:** follows the existing capture-destination setting
  (downloads / subfolder / cloud); cloud uploads use `kind=pdf`.
- **OCR-based naming applies to cloud captures only** — files saved straight to
  the user's disk never hit the worker's OCR, so they keep current naming.

## Context (existing pipeline)

- Screenshot trigger: `src/lib/quick-actions.ts` `runScreenshotQuickAction()` →
  `captureVisibleTab` → (current) `suggestMediaFilename()` with metadata only →
  `resolveCaptureDestination()` → `uploadCapture()` (cloud) or
  `chrome.downloads.download()` (local).
- Worker `POST /api/captures` (`worker/src/routes/captures.ts`) stores bytes to
  R2, **synchronously** extracts text (`ocrImage` for screenshots,
  `extractPdfText` for PDFs), embeds into Vectorize, inserts the D1 `CaptureRow`
  (already supports `kind="pdf"`).
- `src/lib/ai-rename.ts` `suggestMediaFilename()` exists but runs pre-upload with
  metadata only (no OCR text, since OCR happens server-side after upload).
- Full-page PDF is unbuilt on the client: a legacy `_lx/CaptureSection` button
  posts `CAPTURE_PDF` but there is **no handler**; `chrome.debugger` is not yet
  a manifest permission.

## Architecture

### Component A — Full-page PDF capture (extension)

- **`src/lib/pdf-capture.ts` (new):** `captureFullPagePdf(tabId): Promise<Uint8Array>`
  - `chrome.debugger.attach({ tabId }, "1.3")` → `Page.enable` →
    `Page.printToPDF({ printBackground: true, transferMode: "ReturnAsBase64" })`
    → decode base64 to `Uint8Array`. Always `chrome.debugger.detach` in a
    `finally`.
  - Throws a clear error for restricted pages (`chrome://`, Web Store, the PDF
    viewer) where the debugger can't attach.
- **`src/background.ts`:** add a `CAPTURE_PDF` message handler that invokes
  `captureFullPagePdf` and routes the bytes through the shared save logic.
- **`src/lib/quick-actions.ts`:** `runFullPagePdfQuickAction()` mirroring the
  screenshot action — base name `page-{ISO}.pdf`, `resolveCaptureDestination`,
  then `uploadCapture({ kind: "pdf", contentType: "application/pdf", ... })`
  (cloud) or `chrome.downloads.download()` (local). No client-side pre-rename
  needed for cloud (the worker auto-names); downloads keep the timestamp name.
- **UI:** a "Save full-page PDF" button beside the Screenshot action (same
  surface that triggers `runScreenshotQuickAction`).
- **`package.json` (Plasmo manifest):** add the `"debugger"` permission. Users
  re-accept permissions on extension update.

### Component B — OCR auto-rename at ingest (worker)

- **`worker/src/rename.ts` (new):**
  `suggestFilenameFromText(env, { text, kind, fallback, sourceTitle? }): Promise<string>`
  - Calls `env.AI.run("@cf/<model>", { messages }, { gateway: { id: AI_GATEWAY_ID } })`
    (the CLAUDE.md-sanctioned Worker-side gateway call; comment points there).
  - Bounded input (truncate `text` to ~2000 chars). Prompt: produce one concise,
    descriptive, filesystem-safe base filename (no extension, no path).
  - Sanitizes the result and **re-applies the original extension** from
    `fallback`. Returns `fallback` on empty/error.
- **`worker/src/routes/captures.ts` POST:** after the existing text extraction
  yields `extractedText`, if it's non-empty call `suggestFilenameFromText` and
  use the result as the stored `filename` (keeping the client filename as the
  fallback). Compute this **before** the Vectorize embed and the D1 insert so the
  embedded text and the stored row both use the improved name. Best-effort: a
  rename failure logs and falls back; it never fails the upload.

## Data flow

```
capture (screenshot | full-page PDF)
  → resolveCaptureDestination(setting)
     ├─ cloud:   uploadCapture(kind) → POST /api/captures
     │             → worker: R2 put → extract text (OCR / pdf)
     │             → suggestFilenameFromText(text) → store renamed CaptureRow
     │             → embed + insert  → shows in Captures list (+ hub) with a real name
     └─ downloads: chrome.downloads.download(timestamp-name)   (no OCR, unchanged)
```

## Error handling

- PDF capture: `detach` in `finally`; restricted-page attach failures surface a
  toast and abort cleanly (no crash, no orphan debugger session).
- Worker rename: wrapped in try/catch; falls back to the provided filename. The
  existing capture `status="failed"` handling for extraction/embedding errors is
  unchanged.

## Testing

- **Extension:** unit-test the base64→`Uint8Array` conversion and
  `runFullPagePdfQuickAction` destination routing (mock `chrome.debugger`,
  `uploadCapture`, `chrome.downloads`). Existing `capture-destination.test.ts`
  stays green.
- **Worker:** unit-test `suggestFilenameFromText` (stub `env.AI.run` → returns a
  sanitized name; falls back on error/empty input, preserves extension); extend
  `worker/tests/routes/captures.test.ts` to assert a screenshot upload whose OCR
  yields text persists the renamed filename. Use the repo's node:sqlite D1
  harness.

## Out of scope

- Manual re-rename button / `PATCH /api/captures/:id`.
- The separate async `/api/pdfs` route.
- Renaming files saved to the downloads destination.
- **Joplin sync of notes/snippets/links** and **sticky-notes→hub sync** — these
  are separate features with their own specs (queued after this one).

## Follow-on (separate specs, queued)

1. **Joplin sync** — push notes (sticky notes), snippets (= highlights), and
   links into Joplin under their own notebooks (uses the existing Joplin tool
   layer in the extension).
2. **Sticky notes → hub** — sync local sticky notes to sidebar-api so they
   appear in the copythe-hub dashboard.
