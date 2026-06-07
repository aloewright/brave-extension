# Captures: Full-page PDF + OCR auto-rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Save full-page PDF" quick action (saved through the existing capture-destination setting) and make the worker auto-rename ingested captures from their OCR/PDF text.

**Architecture:** Worker side — a new `rename.ts` generates a filename from extracted text via gateway `x`, called inside `POST /api/captures` after OCR/PDF extraction. Extension side — a new `pdf-capture.ts` produces a full-page PDF via `chrome.debugger` `Page.printToPDF`, a `runFullPagePdfQuickAction()` mirrors the screenshot action through `resolveCaptureDestination`, and a button is added to the rail's `QUICK_ACTIONS`.

**Tech Stack:** TypeScript, Cloudflare Workers (Workers AI via gateway `x`), Hono, Plasmo extension, `chrome.debugger`, Vitest (worker: node:sqlite D1 harness; extension: happy-dom).

**Spec:** `docs/superpowers/specs/2026-06-07-captures-pdf-ocr-rename-design.md`

---

## File structure

```
worker/
  src/rename.ts                 # NEW: suggestFilenameFromText(env, {...})
  src/routes/captures.ts        # MODIFY: call rename after extraction, before embed+insert
  tests/rename.test.ts          # NEW
  tests/routes/captures.test.ts # MODIFY: assert renamed filename persisted
src/ (extension)
  lib/pdf-capture.ts            # NEW: captureFullPagePdf(tabId) + base64ToBytes
  lib/quick-actions.ts          # MODIFY: add runFullPagePdfQuickAction()
  components/SidebarRail.tsx     # MODIFY: add "Save full-page PDF" QUICK_ACTIONS entry
  tests/pdf-capture.test.ts     # NEW
  tests/quick-actions-pdf.test.ts # NEW
```

Note: the `debugger` manifest permission already exists in `package.json` — no manifest change needed.

---

## Task 1: Worker rename module

**Files:**
- Create: `worker/src/rename.ts`
- Test: `worker/tests/rename.test.ts`

Run worker commands from `worker/`.

- [ ] **Step 1: Write the failing test** `worker/tests/rename.test.ts`

```ts
import { describe, expect, it, vi } from "vitest"
import { suggestFilenameFromText } from "../src/rename"

function envWithReply(reply: string) {
  return {
    AI: {
      run: vi.fn(async () => ({ response: reply }))
    }
  } as unknown as import("../src/env").Env
}

describe("suggestFilenameFromText", () => {
  it("builds a sanitized name from the model reply and keeps the extension", async () => {
    const env = envWithReply("Quarterly Revenue Report")
    const name = await suggestFilenameFromText(env, {
      text: "Q3 revenue grew 12% ...",
      kind: "pdf",
      fallback: "page-2026.pdf"
    })
    expect(name).toBe("quarterly-revenue-report.pdf")
  })

  it("falls back when text is empty", async () => {
    const env = envWithReply("whatever")
    const name = await suggestFilenameFromText(env, {
      text: "   ",
      kind: "screenshot",
      fallback: "screenshot-x.png"
    })
    expect(name).toBe("screenshot-x.png")
  })

  it("falls back when the model call throws", async () => {
    const env = {
      AI: { run: vi.fn(async () => { throw new Error("rate limited") }) }
    } as unknown as import("../src/env").Env
    const name = await suggestFilenameFromText(env, {
      text: "some content",
      kind: "screenshot",
      fallback: "screenshot-x.png"
    })
    expect(name).toBe("screenshot-x.png")
  })

  it("falls back when the model reply is empty after sanitizing", async () => {
    const env = envWithReply("!!!  ###")
    const name = await suggestFilenameFromText(env, {
      text: "content",
      kind: "pdf",
      fallback: "page-x.pdf"
    })
    expect(name).toBe("page-x.pdf")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run tests/rename.test.ts`
Expected: FAIL — cannot find module `../src/rename`.

- [ ] **Step 3: Write the implementation** `worker/src/rename.ts`

```ts
import { AGENT_PLAN_MODEL, AI_GATEWAY_ID, type Env } from "./env"

const MAX_TEXT = 2000

/** Lowercase, hyphenated, filesystem-safe base name (no extension/path). */
function sanitizeBase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "") // drop any extension the model added
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function extensionOf(fallback: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(fallback)
  return m ? `.${m[1].toLowerCase()}` : ""
}

/**
 * Generate a concise, descriptive filename from a capture's extracted text.
 * Best-effort: returns `fallback` on empty input, model error, or empty result.
 *
 * Worker-side gateway call uses env.AI.run("@cf/...", ..., { gateway: { id } }) —
 * the sanctioned pattern per ~/.claude/CLAUDE.md "Inside a Worker" (dynamic
 * routes are broken Worker-side). Swap to a dynamic route when fixed upstream.
 */
export async function suggestFilenameFromText(
  env: Env,
  input: { text: string; kind: "screenshot" | "pdf"; fallback: string; sourceTitle?: string | null }
): Promise<string> {
  const text = (input.text ?? "").trim()
  if (!text) return input.fallback
  const prompt =
    `You name files from their content. Given the extracted text of a ${input.kind}, ` +
    `reply with ONE short descriptive filename (3-8 words), lowercase words, no file extension, ` +
    `no quotes, no path. Title hint: ${input.sourceTitle ?? "none"}.\n\n` +
    `Content:\n${text.slice(0, MAX_TEXT)}`
  try {
    const res = (await env.AI.run(
      AGENT_PLAN_MODEL,
      { messages: [{ role: "user", content: prompt }], max_tokens: 32 },
      { gateway: { id: AI_GATEWAY_ID } }
    )) as { response?: string }
    const base = sanitizeBase(res?.response ?? "")
    if (!base) return input.fallback
    return base + extensionOf(input.fallback)
  } catch {
    return input.fallback
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run tests/rename.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add worker/src/rename.ts worker/tests/rename.test.ts
git commit -m "feat(worker): suggestFilenameFromText for OCR-based capture naming"
```

---

## Task 2: Wire rename into the captures POST handler

**Files:**
- Modify: `worker/src/routes/captures.ts`
- Test: `worker/tests/routes/captures.test.ts`

- [ ] **Step 1: Write the failing test** — add to `worker/tests/routes/captures.test.ts` a case asserting that when OCR returns text, the stored capture's filename is the renamed one. Match the existing test file's import/harness style (it stubs `env.AI.run`). Add:

```ts
it("renames the capture from OCR text at ingest", async () => {
  const env = makeEnv()
  // Stub AI: OCR returns visible text; the rename model returns a title; embed returns a vector.
  ;(env.AI.run as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (model: string) => {
      if (model.includes("llava")) return { description: "Invoice ACME 2026" } // OCR shape
      if (model.includes("bge")) return { data: [new Array(768).fill(0.01)] } // embed
      return { response: "ACME Invoice 2026" } // rename (gpt-oss)
    }
  )
  const res = await app.fetch(
    new Request("http://x/api/captures", {
      method: "POST",
      headers: {
        "x-sidebar-token": "test-token",
        "x-capture-kind": "screenshot",
        "x-capture-filename": "screenshot-123.png",
        "content-type": "image/png"
      },
      body: new Uint8Array([1, 2, 3, 4])
    }),
    env
  )
  expect(res.status).toBe(201)
  const body = (await res.json()) as { id: string; filename: string }
  expect(body.filename).toBe("acme-invoice-2026.png")
})
```

> NOTE for implementer: check the existing captures test's exact OCR stub shape (what `ocrImage` expects `env.AI.run` to return for the LLaVA model) and mirror it — the line above (`{ description }`) is illustrative; use whatever the existing passing OCR test uses so `ocrImage` returns non-empty text. The assertion that matters is `body.filename === "acme-invoice-2026.png"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd worker && pnpm vitest run tests/routes/captures.test.ts`
Expected: FAIL — filename is still `screenshot-123.png`.

- [ ] **Step 3: Implement** — in `worker/src/routes/captures.ts`, import the helper and rename after extraction, before the embed text is built. Add the import near the top:

```ts
import { suggestFilenameFromText } from "../rename"
```

Then, immediately after the extraction `try/catch` block (right after the block that sets `extractedText`/`status`/`statusMessage`, before `const embedText = ...`), insert:

```ts
  // Auto-rename from the extracted text (best-effort; falls back to the
  // client-provided filename). Done before embedding/insert so the stored row
  // and the embedded text use the improved name.
  let finalFilename = filename
  if (extractedText.length > 0) {
    finalFilename = await suggestFilenameFromText(c.env, {
      text: extractedText,
      kind: kindRaw,
      fallback: filename,
      sourceTitle
    })
  }
```

Then replace the two later uses of `filename` that go into storage/response so they use `finalFilename`:
- In `embedText` array: change `filename` → `finalFilename`.
- In the `CaptureRow` object: `filename: finalFilename`.
- In the metadata `title: sourceTitle || filename` → `title: sourceTitle || finalFilename`.
- In the JSON response `filename` field (the `c.json({... filename ...})`) → `finalFilename`.

Leave the R2 key (`r2Key` from `id` + `ext`) and `ext` inference using the original `filename` as-is (the extension is preserved by the rename, and the R2 key is id-based).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd worker && pnpm vitest run tests/routes/captures.test.ts`
Expected: PASS (including the new case and all existing capture tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/captures.ts worker/tests/routes/captures.test.ts
git commit -m "feat(worker): auto-rename captures from extracted text at ingest"
```

---

## Task 3: Full-page PDF capture lib (extension)

**Files:**
- Create: `src/lib/pdf-capture.ts`
- Test: `tests/pdf-capture.test.ts`

Run extension commands from the repo root.

- [ ] **Step 1: Write the failing test** `tests/pdf-capture.test.ts`

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { base64ToBytes, captureFullPagePdf } from "../src/lib/pdf-capture"

describe("base64ToBytes", () => {
  it("decodes base64 to the original bytes", () => {
    const b64 = btoa("PDF")
    expect(Array.from(base64ToBytes(b64))).toEqual([80, 68, 70])
  })
})

describe("captureFullPagePdf", () => {
  const orig = globalThis.chrome
  beforeEach(() => {
    const attach = vi.fn((_t: unknown, _v: string, cb: () => void) => cb())
    const detach = vi.fn((_t: unknown, cb?: () => void) => cb?.())
    const sendCommand = vi.fn(
      (_t: unknown, method: string, _p: unknown, cb: (r: unknown) => void) => {
        if (method === "Page.printToPDF") cb({ data: btoa("PDFBYTES") })
        else cb({})
      }
    )
    ;(globalThis as { chrome?: unknown }).chrome = {
      debugger: { attach, detach, sendCommand },
      runtime: { lastError: undefined }
    }
  })
  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = orig
  })

  it("attaches, prints, detaches, and returns base64 PDF data", async () => {
    const data = await captureFullPagePdf(42)
    expect(data).toBe(btoa("PDFBYTES"))
    expect(globalThis.chrome.debugger.detach).toHaveBeenCalled()
  })

  it("detaches even if printToPDF fails", async () => {
    ;(globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (_t: unknown, _m: string, _p: unknown, cb: (r: unknown) => void) => {
        ;(globalThis.chrome.runtime as { lastError?: unknown }).lastError = { message: "Cannot attach" }
        cb(undefined)
      }
    )
    await expect(captureFullPagePdf(42)).rejects.toThrow()
    expect(globalThis.chrome.debugger.detach).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pdf-capture.test.ts`
Expected: FAIL — cannot find module `../src/lib/pdf-capture`.

- [ ] **Step 3: Write the implementation** `src/lib/pdf-capture.ts`

```ts
// Full-page PDF capture via the Chrome DevTools Protocol (Page.printToPDF).
// Requires the "debugger" permission (already declared in the manifest).

const DEBUGGER_VERSION = "1.3"

/** Decode a base64 string to bytes (CDP returns the PDF as base64). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sendCommand<T>(target: chrome.debugger.Debuggee, method: string, params?: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params ?? {}, (result) => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve(result as T)
    })
  })
}

function attach(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGER_VERSION, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

function detach(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => resolve())
  })
}

/**
 * Capture the full page of `tabId` as a PDF, returned as base64. Throws a clear
 * error on pages where the debugger can't attach (chrome://, Web Store, the PDF
 * viewer). Always detaches the debugger.
 */
export async function captureFullPagePdf(tabId: number): Promise<string> {
  const target: chrome.debugger.Debuggee = { tabId }
  try {
    await attach(target)
  } catch (err) {
    throw new Error(
      `Can't capture this page as PDF (${err instanceof Error ? err.message : String(err)}). ` +
        `Restricted pages like chrome://, the Web Store, and the PDF viewer aren't supported.`
    )
  }
  try {
    await sendCommand(target, "Page.enable")
    const res = await sendCommand<{ data: string }>(target, "Page.printToPDF", {
      printBackground: true,
      transferMode: "ReturnAsBase64"
    })
    if (!res?.data) throw new Error("printToPDF returned no data")
    return res.data
  } finally {
    await detach(target)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pdf-capture.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdf-capture.ts tests/pdf-capture.test.ts
git commit -m "feat(sidebar): full-page PDF capture via chrome.debugger printToPDF"
```

---

## Task 4: Full-page PDF quick action

**Files:**
- Modify: `src/lib/quick-actions.ts`
- Test: `tests/quick-actions-pdf.test.ts`

- [ ] **Step 1: Write the failing test** `tests/quick-actions-pdf.test.ts`

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

vi.mock("../src/lib/pdf-capture", () => ({
  captureFullPagePdf: vi.fn(async () => btoa("PDFDATA")),
  base64ToBytes: (b64: string) => {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
}))
vi.mock("../src/storage", () => ({ getSettings: vi.fn(async () => ({})) }))
const resolveMock = vi.fn()
vi.mock("../src/lib/capture-destination", () => ({
  resolveCaptureDestination: (...a: unknown[]) => resolveMock(...a),
  describeCaptureDestination: () => "Saved to Downloads"
}))
const uploadMock = vi.fn(async () => ({ filename: "page-x.pdf" }))
vi.mock("../src/lib/capture-upload", () => ({
  uploadCapture: (...a: unknown[]) => uploadMock(...a),
  CaptureUploadError: class extends Error {},
  dataUrlToBlob: async () => new Blob()
}))

import { runFullPagePdfQuickAction } from "../src/lib/quick-actions"

describe("runFullPagePdfQuickAction", () => {
  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
      tabs: { query: vi.fn(async () => [{ id: 9, url: "https://e.com", title: "E" }]) },
      downloads: { download: vi.fn(async () => 1) }
    }
  })
  afterEach(() => vi.clearAllMocks())

  it("uploads as kind=pdf when destination is cloud", async () => {
    resolveMock.mockReturnValue({
      destination: { kind: "cloud", apiUrl: "u", apiToken: "t", filename: "page-x.pdf" },
      fallbackReason: null
    })
    const r = await runFullPagePdfQuickAction()
    expect(r.kind).toBe("success")
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "pdf" }))
  })

  it("downloads locally when destination is downloads", async () => {
    resolveMock.mockReturnValue({
      destination: { kind: "downloads", filename: "page-x.pdf" },
      fallbackReason: null
    })
    const r = await runFullPagePdfQuickAction()
    expect(r.kind).toBe("success")
    expect(globalThis.chrome.downloads.download).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/quick-actions-pdf.test.ts`
Expected: FAIL — `runFullPagePdfQuickAction` is not exported.

- [ ] **Step 3: Implement** — in `src/lib/quick-actions.ts` add the import and the new exported function. Add to the existing imports:

```ts
import { base64ToBytes, captureFullPagePdf } from "./pdf-capture"
```

Add this function after `runScreenshotQuickAction`:

```ts
/**
 * Capture the active tab as a full-page PDF and route it through the configured
 * capture destination (Downloads / subfolder / Cloud). Cloud uploads use
 * kind="pdf"; the worker OCRs and auto-renames it at ingest.
 */
export async function runFullPagePdfQuickAction(): Promise<QuickActionResult> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.id) return { kind: "error", message: "No active tab to capture" }

    const base64 = await captureFullPagePdf(tab.id)
    const baseFilename = `page-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`
    const settings = await getSettings()
    const { destination, fallbackReason } = resolveCaptureDestination(baseFilename, settings)
    const dataUrl = `data:application/pdf;base64,${base64}`

    if (destination.kind === "cloud") {
      try {
        const body = new Blob([base64ToBytes(base64)], { type: "application/pdf" })
        const uploaded = await uploadCapture({
          apiUrl: destination.apiUrl,
          apiToken: destination.apiToken,
          filename: destination.filename,
          kind: "pdf",
          contentType: "application/pdf",
          pageUrl: tab.url,
          pageTitle: tab.title,
          body
        })
        return { kind: "success", message: `Uploaded ${uploaded.filename}` }
      } catch (err) {
        const msg =
          err instanceof CaptureUploadError
            ? `Cloud upload failed (${err.status}); saving locally instead`
            : `Cloud upload failed: ${err instanceof Error ? err.message : String(err)}`
        await chrome.downloads.download({ url: dataUrl, filename: baseFilename, saveAs: false })
        return { kind: "error", message: msg }
      }
    }

    await chrome.downloads.download({ url: dataUrl, filename: destination.filename, saveAs: false })
    const prefix =
      fallbackReason === "cloud-disabled"
        ? "Cloud disabled — "
        : fallbackReason === "cloud-not-configured"
          ? "Sidebar API not configured — "
          : ""
    return { kind: "success", message: prefix + describeCaptureDestination(destination) }
  } catch (err) {
    return { kind: "error", message: `Full-page PDF failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
```

> NOTE: `uploadCapture` already accepts `contentType` and `kind` (see `src/lib/capture-upload.ts:16,24`). Confirm `UploadCaptureInput.body` accepts a `Blob` (the screenshot path passes a Blob via `dataUrlToBlob`); if it requires `ArrayBuffer`, pass `await body.arrayBuffer()` instead — adjust and note it.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/quick-actions-pdf.test.ts`
Expected: PASS (2 passing).

- [ ] **Step 5: Run full extension suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quick-actions.ts tests/quick-actions-pdf.test.ts
git commit -m "feat(sidebar): full-page PDF quick action via capture destination"
```

---

## Task 5: Rail button

**Files:**
- Modify: `src/components/SidebarRail.tsx`
- Test: `tests/rail-pdf-action.test.ts`

- [ ] **Step 1: Write the failing test** `tests/rail-pdf-action.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("rail full-page PDF action", () => {
  it("registers a Save full-page PDF quick action", () => {
    const src = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    expect(src).toContain("runFullPagePdfQuickAction")
    expect(src).toContain("Save full-page PDF")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/rail-pdf-action.test.ts`
Expected: FAIL — string not present.

- [ ] **Step 3: Implement** — in `src/components/SidebarRail.tsx`:

Add `runFullPagePdfQuickAction` to the quick-actions import block (the one importing `runScreenshotQuickAction`):

```ts
import {
  runPageAgentQuickAction,
  runPipQuickAction,
  type QuickActionResult,
  runSaveLinkQuickAction,
  runScreenshotQuickAction,
  runFullPagePdfQuickAction
} from "../lib/quick-actions"
```

Add a `QUICK_ACTIONS` entry immediately after the Screenshot entry:

```ts
  { label: "Save full-page PDF", icon: "file", run: runFullPagePdfQuickAction },
```

> NOTE: `icon` must be a valid `LeoIconName`. Use `"file"` if valid; otherwise reuse an existing valid icon already used in this file (e.g. `"file-export"` which is used by the resizable-window action). Verify against the `LeoIconName` type before committing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/rail-pdf-action.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/components/SidebarRail.tsx tests/rail-pdf-action.test.ts
git commit -m "feat(sidebar): add Save full-page PDF to the quick-actions rail"
```

---

## Self-Review

- **Spec coverage:** §2 full-page PDF (capture lib → Task 3; quick action via destination → Task 4; rail button → Task 5; `debugger` perm already present). §3 OCR auto-rename (rename module → Task 1; wired into POST before embed/insert → Task 2). §4 error handling (PDF detach-in-finally + restricted-page message → Task 3; worker rename best-effort fallback → Tasks 1-2). §5 testing covered per task. Downloads-keep-naming preserved (Task 4 downloads path uses the timestamp `baseFilename`/`destination.filename`, no server OCR).
- **Placeholder scan:** none. Two implementer NOTEs (OCR stub shape in Task 2; Blob-vs-ArrayBuffer + icon validity) point at verifying real signatures, not deferred work.
- **Type consistency:** `suggestFilenameFromText(env, {text, kind, fallback, sourceTitle?})` defined in Task 1, called identically in Task 2; `captureFullPagePdf(tabId)`/`base64ToBytes(b64)` defined in Task 3, used in Task 4; `runFullPagePdfQuickAction` defined in Task 4, imported in Task 5; `uploadCapture({kind:"pdf", contentType})` matches `UploadCaptureInput`.

## Out of scope (per spec)
Manual re-rename / `PATCH /api/captures`; the async `/api/pdfs` route; renaming downloads-destination files; Joplin sync; sticky-notes→hub.
```
