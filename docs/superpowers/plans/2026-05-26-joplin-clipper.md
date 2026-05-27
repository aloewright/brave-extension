# Joplin Clipper Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an in-extension "Clip to Joplin" feature in `ai-dev-sidebar` so the user can save the current page to their Joplin Desktop instance via four clip modes (Simplified / Full HTML / Selection / URL+title), reachable from a new sidebar section and a right-click context menu submenu.

**Architecture:** A single `handleClipRequest` in the background service worker is the entry point. Both the sidebar's mode picker and the right-click menu message into it. The handler injects `@mozilla/readability` into the active tab on demand, runs a per-mode extractor via `chrome.scripting.executeScript`, POSTs the result to Joplin's local HTTP service on `localhost:41184`, persists a recent-clip entry, and broadcasts a `joplin/clip-result` event back to any listeners (so the sidebar can show a toast + prepend to its recent-clips list).

**Tech Stack:** TypeScript, Plasmo (MV3 Brave/Chromium extension), React 18, Tailwind, `@plasmohq/storage`, `@mozilla/readability` (new), Vitest (existing), happy-dom (existing).

**Spec:** `docs/superpowers/specs/2026-05-26-joplin-clipper-design.md`

---

## Conventions used by every task

- All paths are relative to the `ai-dev-sidebar` repo root: `/Users/aloe/development/ai-dev-sidebar`.
- Commands run from the repo root. Use `pnpm`, not `npm`/`yarn` — that's what the project uses.
- TDD: write failing test → run to see it fail → write minimal impl → run to see it pass → commit.
- Every code task ends with a `git add` + `git commit` using conventional commits (e.g., `feat(extension): …`).
- Don't touch anything outside the file lists declared per task — no drive-by refactors.

---

## Task 1: Add `joplinToken` to `Settings`

Foundation. Settings already uses `@plasmohq/storage` with a merge-on-read pattern that auto-migrates new fields, so this is purely adding a field to the interface and the default object.

**Files:**
- Modify: `src/types.ts` — extend `Settings` interface and `DEFAULT_SETTINGS`.

- [ ] **Step 1: Find the `Settings` interface and `DEFAULT_SETTINGS` object**

```bash
grep -n "interface Settings\|DEFAULT_SETTINGS" src/types.ts | head -5
```

You should see one interface declaration and one default-object declaration. Confirm both exist before editing.

- [ ] **Step 2: Add the field to the interface**

Open `src/types.ts`. Find `export interface Settings { ... }`. Add at the bottom of the interface body:

```ts
  // Phase 1 — Joplin clipper feature
  joplinToken: string
```

- [ ] **Step 3: Add the default**

Find `export const DEFAULT_SETTINGS: Settings = { ... }` (or however it's structured). Add at the bottom of the object:

```ts
  joplinToken: ""
```

- [ ] **Step 4: Build / typecheck**

```bash
pnpm typecheck
```

Expected: clean. If there are existing partial-Settings usages that don't include `joplinToken`, the existing `{ ...DEFAULT_SETTINGS, ...stored }` merge handles them — but TypeScript will catch any literal `Settings` constructions that need the field. Fix only the type errors that reference `Settings` directly; if any test fixtures need updating, append `joplinToken: ""` to them too.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
# Plus any test fixture files you had to touch.
git commit -m "$(cat <<'EOF'
feat(extension): add joplinToken to Settings

Phase 1 of the Joplin clipper feature. The token is stored alongside
other settings via @plasmohq/storage; merge-on-read picks up the empty
default for existing users on next load.
EOF
)"
```

---

## Task 2: Add `@mozilla/readability` dependency

Pure dependency add. No code yet — that comes in Task 7.

**Files:**
- Modify: `package.json` (and `pnpm-lock.yaml` via the install).

- [ ] **Step 1: Install**

```bash
pnpm add @mozilla/readability
```

Confirm via:

```bash
grep -A 1 '"@mozilla/readability"' package.json
```

Should show `"@mozilla/readability": "^0.6.x"` (or whatever the current major is).

- [ ] **Step 2: Verify it builds**

```bash
pnpm typecheck
```

Should still be clean.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(extension): add @mozilla/readability for simplified-page clipping"
```

---

## Task 3: Shared types (`joplin-types.ts`)

Type-only file. No tests; the types are exercised by every subsequent task.

**Files:**
- Create: `src/lib/joplin-types.ts`

- [ ] **Step 1: Create the file**

```ts
// src/lib/joplin-types.ts
//
// Shared types for the Joplin clipper feature. Imported by joplin-client,
// joplin-recents, clip-extractors, the JoplinSection, and the background
// handler — single source of truth.

export type ClipMode = "simplified" | "full-html" | "selection" | "url-only"

export const CLIP_MODES: readonly ClipMode[] = [
  "simplified",
  "full-html",
  "selection",
  "url-only"
] as const

export const CLIP_MODE_LABELS: Record<ClipMode, string> = {
  "simplified":  "Simplified page",
  "full-html":   "Full HTML",
  "selection":   "Selection",
  "url-only":    "URL + title"
}

/** Output of a per-mode extractor. Exactly one of body/bodyHtml is non-null. */
export interface Clip {
  title: string
  body: string | null
  bodyHtml: string | null
  sourceUrl: string
  mode: ClipMode
}

/** Persisted recent-clip record (storage key: ai-dev-joplin-recent-clips). */
export interface RecentClip {
  id: string                 // ulid (existing src/lib/ulid.ts)
  joplinNoteId: string
  title: string
  mode: ClipMode
  sourceUrl: string
  createdAt: string          // ISO
  joplinUrl: string          // joplin://x-callback-url/openNote?id=<noteId>
}

export interface RecentClipsStore {
  clips: RecentClip[]        // newest first, capped at 50
}

/** chrome.runtime.sendMessage payload: sidebar/context menu → background. */
export interface ClipRequest {
  type: "joplin/clip"
  mode: ClipMode
  tabId: number
}

/** chrome.runtime.sendMessage broadcast: background → all listeners. */
export interface ClipResultEvent {
  type: "joplin/clip-result"
  status: "success" | "error"
  mode: ClipMode
  title?: string
  error?: string
  recentClip?: RecentClip
}

/** Map between contextMenu item IDs and ClipMode. Used by background.ts. */
export const MENU_ID_TO_MODE: Record<string, ClipMode> = {
  "joplin-clip-simplified": "simplified",
  "joplin-clip-full":       "full-html",
  "joplin-clip-selection":  "selection",
  "joplin-clip-url":        "url-only"
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/joplin-types.ts
git commit -m "feat(extension): add Joplin clipper shared types"
```

---

## Task 4: `joplin-client.ts` (HTTP client, TDD)

Pure HTTP client. Vitest with a stubbed `fetch`.

**Files:**
- Create: `src/lib/joplin-client.ts`
- Create: `src/lib/joplin-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/joplin-client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  createNote,
  ping,
  joplinNoteUrl,
  JoplinClientError
} from "./joplin-client"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" }
  })
}

describe("joplin-client.createNote", () => {
  it("URL-encodes the token and sends body field for body input", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "abc" }))
    const id = await createNote(
      { title: "T", body: "hello", sourceUrl: "http://x" },
      "tok&en",
      fetchFn
    )
    expect(id).toBe("abc")
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe("http://localhost:41184/notes?token=tok%26en")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      title: "T",
      source_url: "http://x",
      body: "hello"
    })
  })

  it("sends body_html (not body) when bodyHtml input is provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "abc" }))
    await createNote(
      { title: "T", bodyHtml: "<p>hi</p>", sourceUrl: "http://x" },
      "tok",
      fetchFn
    )
    const init = fetchFn.mock.calls[0][1]
    const parsed = JSON.parse(init.body as string)
    expect(parsed.body_html).toBe("<p>hi</p>")
    expect(parsed.body).toBeUndefined()
  })

  it("throws JoplinClientError(0) when the token is empty", async () => {
    const fetchFn = vi.fn()
    await expect(
      createNote({ title: "T", body: "x", sourceUrl: "http://x" }, "", fetchFn)
    ).rejects.toBeInstanceOf(JoplinClientError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("throws JoplinClientError(0) with friendly message on fetch rejection", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED"))
    try {
      await createNote(
        { title: "T", body: "x", sourceUrl: "http://x" },
        "tok",
        fetchFn
      )
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(JoplinClientError)
      expect((err as JoplinClientError).status).toBe(0)
      expect((err as Error).message).toContain("localhost:41184")
    }
  })

  it("throws JoplinClientError(401) with truncated body on auth error", async () => {
    const longBody = "x".repeat(500)
    const fetchFn = vi.fn().mockResolvedValue(textResponse(longBody, 401))
    try {
      await createNote(
        { title: "T", body: "x", sourceUrl: "http://x" },
        "tok",
        fetchFn
      )
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as JoplinClientError).status).toBe(401)
      expect((err as Error).message.length).toBeLessThanOrEqual(250)
    }
  })

  it("throws when response has no id", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(
      createNote(
        { title: "T", body: "x", sourceUrl: "http://x" },
        "tok",
        fetchFn
      )
    ).rejects.toBeInstanceOf(JoplinClientError)
  })
})

describe("joplin-client.ping", () => {
  it("returns true when body contains JoplinClipperServer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(textResponse("JoplinClipperServer"))
    expect(await ping(fetchFn)).toBe(true)
  })
  it("returns false on non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(textResponse("nope", 500))
    expect(await ping(fetchFn)).toBe(false)
  })
  it("returns false on fetch rejection", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"))
    expect(await ping(fetchFn)).toBe(false)
  })
})

describe("joplin-client.joplinNoteUrl", () => {
  it("builds the joplin:// deep link", () => {
    expect(joplinNoteUrl("abc123")).toBe(
      "joplin://x-callback-url/openNote?id=abc123"
    )
  })
})
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
pnpm test src/lib/joplin-client.test.ts
```

Expected: compile error / module-not-found because `joplin-client.ts` doesn't exist yet.

- [ ] **Step 3: Implement the client**

Create `src/lib/joplin-client.ts`:

```ts
// src/lib/joplin-client.ts
//
// HTTP client for Joplin's localhost Web Clipper service. Pure functions
// over fetch — no chrome.* APIs, no DOM. Testable with a fetch stub.

export const JOPLIN_BASE_URL = "http://localhost:41184"

export class JoplinClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = "JoplinClientError"
  }
}

export interface CreateNoteInput {
  title: string
  body?: string
  bodyHtml?: string
  sourceUrl: string
}

/** POST /notes — returns the Joplin note ID on success, throws on failure. */
export async function createNote(
  input: CreateNoteInput,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!token) {
    throw new JoplinClientError("No Joplin API token configured.", 0)
  }
  const url = `${JOPLIN_BASE_URL}/notes?token=${encodeURIComponent(token)}`
  const payload: Record<string, string> = {
    title: input.title,
    source_url: input.sourceUrl
  }
  if (input.body) payload.body = input.body
  if (input.bodyHtml) payload.body_html = input.bodyHtml

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  } catch (_err) {
    throw new JoplinClientError(
      "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?",
      0
    )
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new JoplinClientError(
      `Joplin API error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    )
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string }
  if (!json.id) {
    throw new JoplinClientError("Joplin returned no note id.", res.status)
  }
  return json.id
}

/** Liveness check. GET /ping is unauthenticated. */
export async function ping(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${JOPLIN_BASE_URL}/ping`)
    if (!res.ok) return false
    const body = await res.text()
    return body.includes("JoplinClipperServer")
  } catch {
    return false
  }
}

/** Build the joplin:// deep link for a clipped note. */
export function joplinNoteUrl(noteId: string): string {
  return `joplin://x-callback-url/openNote?id=${noteId}`
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
pnpm test src/lib/joplin-client.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/joplin-client.ts src/lib/joplin-client.test.ts
git commit -m "$(cat <<'EOF'
feat(extension): add Joplin HTTP client

Pure fetch wrapper for Joplin's localhost:41184 /notes and /ping
endpoints. URL-encodes the token, returns the new note's id, and
maps failures into JoplinClientError with sanitized messages.
EOF
)"
```

---

## Task 5: `joplin-recents.ts` (recent-clips storage, TDD)

Storage helpers using `@plasmohq/storage`. Tests stub the Storage instance via the package's exports.

**Files:**
- Create: `src/lib/joplin-recents.ts`
- Create: `src/lib/joplin-recents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/joplin-recents.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { RecentClip } from "./joplin-types"

// Mock @plasmohq/storage. The real implementation persists to chrome.storage;
// for tests we back it with an in-memory map. Reset between tests.
const mem = new Map<string, unknown>()
vi.mock("@plasmohq/storage", () => ({
  Storage: class {
    async get<T>(key: string): Promise<T | undefined> {
      return mem.get(key) as T | undefined
    }
    async set(key: string, value: unknown): Promise<void> {
      mem.set(key, value)
    }
    async remove(key: string): Promise<void> {
      mem.delete(key)
    }
  }
}))

import { getRecentClips, prependRecentClip, clearRecentClips } from "./joplin-recents"

function makeClip(id: string, offsetSecs = 0): RecentClip {
  return {
    id,
    joplinNoteId: `note-${id}`,
    title: `Clip ${id}`,
    mode: "simplified",
    sourceUrl: `http://example/${id}`,
    createdAt: new Date(1_700_000_000_000 + offsetSecs * 1000).toISOString(),
    joplinUrl: `joplin://x-callback-url/openNote?id=note-${id}`
  }
}

describe("joplin-recents", () => {
  beforeEach(() => {
    mem.clear()
  })

  it("getRecentClips returns [] when storage is empty", async () => {
    expect(await getRecentClips()).toEqual([])
  })

  it("prependRecentClip stores the clip on first call", async () => {
    await prependRecentClip(makeClip("a"))
    expect((await getRecentClips()).map((c) => c.id)).toEqual(["a"])
  })

  it("prependRecentClip puts newest first", async () => {
    await prependRecentClip(makeClip("a"))
    await prependRecentClip(makeClip("b"))
    await prependRecentClip(makeClip("c"))
    expect((await getRecentClips()).map((c) => c.id)).toEqual(["c", "b", "a"])
  })

  it("prependRecentClip caps at 50, dropping the oldest", async () => {
    for (let i = 0; i < 60; i++) {
      await prependRecentClip(makeClip(`${i}`, i))
    }
    const stored = await getRecentClips()
    expect(stored.length).toBe(50)
    // Newest 50 retained — ids 59 down to 10. id "9" should NOT be present.
    expect(stored[0].id).toBe("59")
    expect(stored.find((c) => c.id === "9")).toBeUndefined()
  })

  it("clearRecentClips empties the list", async () => {
    await prependRecentClip(makeClip("a"))
    await clearRecentClips()
    expect(await getRecentClips()).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
pnpm test src/lib/joplin-recents.test.ts
```

Expected: module not found / compile error.

- [ ] **Step 3: Implement**

Create `src/lib/joplin-recents.ts`:

```ts
// src/lib/joplin-recents.ts
//
// Bounded-list storage for recent Joplin clips. Cap is 50; newest-first
// ordering. Storage key matches the spec's data-model section.

import { Storage } from "@plasmohq/storage"
import type { RecentClip } from "./joplin-types"

const STORAGE_KEY = "ai-dev-joplin-recent-clips"
const MAX_CLIPS = 50

const storage = new Storage()

export async function getRecentClips(): Promise<RecentClip[]> {
  const raw = await storage.get<{ clips: RecentClip[] }>(STORAGE_KEY)
  return Array.isArray(raw?.clips) ? raw!.clips : []
}

export async function prependRecentClip(clip: RecentClip): Promise<void> {
  const existing = await getRecentClips()
  const updated = [clip, ...existing].slice(0, MAX_CLIPS)
  await storage.set(STORAGE_KEY, { clips: updated })
}

export async function clearRecentClips(): Promise<void> {
  await storage.remove(STORAGE_KEY)
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/lib/joplin-recents.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/joplin-recents.ts src/lib/joplin-recents.test.ts
git commit -m "$(cat <<'EOF'
feat(extension): add recent-clips storage (capped at 50)

Reads/writes the joplin recent clips list via @plasmohq/storage. Each
prepend slices to the newest 50 to bound storage growth; cleared by an
explicit clearRecentClips call (no time-based eviction).
EOF
)"
```

---

## Task 6: `readability-bundle.ts` content script

This file gets bundled by Plasmo but never auto-injected. The background injects it on demand.

**Files:**
- Create: `src/contents/readability-bundle.ts`

- [ ] **Step 1: Create the file**

```ts
// src/contents/readability-bundle.ts
//
// Plasmo content-script entry. `matches: []` means Plasmo bundles this
// file but does NOT auto-inject it on any URL. The background loads it
// on demand via chrome.scripting.executeScript({ files: [<this file>] })
// before each clip in "simplified" mode.
//
// Exposes Readability on globalThis so the per-mode extractor's func
// (which runs in MAIN world but doesn't have its own imports) can read
// it via globalThis.__JoplinReadability__.

import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"

export const config: PlasmoCSConfig = {
  matches: []
}

;(globalThis as { __JoplinReadability__?: typeof Readability }).__JoplinReadability__ =
  Readability
```

- [ ] **Step 2: Verify Plasmo builds it**

```bash
pnpm build 2>&1 | tail -20
```

Expected: clean build. Then check the output:

```bash
ls build/chrome-mv3-prod/ 2>/dev/null || ls build/ 2>/dev/null | head -20
```

You should see a file matching `*readability-bundle*.js` somewhere under `build/`. **Note the exact filename — you'll need it in Task 7.** If Plasmo emits a hash suffix (e.g., `readability-bundle.abc123.js`), the implementer should check whether `pnpm dev` output is stable across rebuilds before hardcoding the name. If unstable, fall back to scanning `chrome.runtime.getManifest()` for the content-script entry at runtime; otherwise hardcode.

For the rest of this plan I'll assume the file is `readability-bundle.<HASH?>.js` and refer to it as `READABILITY_BUNDLE_PATH` — replace with the actual filename when wiring it in.

- [ ] **Step 3: Commit**

```bash
git add src/contents/readability-bundle.ts
git commit -m "$(cat <<'EOF'
feat(extension): add on-demand Readability content script

Plasmo content-script entry with matches: [] — bundled but never
auto-injected. Background injects it via chrome.scripting.executeScript
before each simplified-mode clip. Exposes Readability on globalThis so
the per-mode extractor's inline `func` can access it.
EOF
)"
```

---

## Task 7: `clip-extractors.ts` (per-mode DOM extraction, TDD)

The four per-mode extractor functions plus the `extractClip(tabId, mode)` driver that runs them in the page via `chrome.scripting.executeScript`.

The extractor functions themselves are pure DOM functions — testable in happy-dom by calling them directly. The driver (`extractClip`) is exercised by the background test in Task 10.

**Files:**
- Create: `src/lib/clip-extractors.ts`
- Create: `src/lib/clip-extractors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/clip-extractors.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  extractSimplifiedInPage,
  extractFullHtmlInPage,
  extractSelectionInPage,
  extractUrlOnlyInPage
} from "./clip-extractors"

// happy-dom is the default vitest environment in this project (verify in
// vitest.config). If it isn't, set `// @vitest-environment happy-dom`
// at the top of this file.

function resetDocument(html: string, title: string, url = "http://example.test/page") {
  document.documentElement.innerHTML = html
  document.title = title
  // happy-dom respects manual location assignment.
  Object.defineProperty(window, "location", {
    value: new URL(url),
    configurable: true
  })
}

describe("extractSimplifiedInPage", () => {
  beforeEach(() => {
    resetDocument("<body><article><h1>Hi</h1><p>p</p></article></body>", "T")
    // @ts-expect-error — test stub
    delete globalThis.__JoplinReadability__
  })

  it("returns null when Readability is missing", () => {
    expect(extractSimplifiedInPage()).toBeNull()
  })

  it("returns null when Readability.parse returns null", () => {
    ;(globalThis as any).__JoplinReadability__ = class {
      parse() { return null }
    }
    expect(extractSimplifiedInPage()).toBeNull()
  })

  it("returns a simplified Clip when Readability parses", () => {
    ;(globalThis as any).__JoplinReadability__ = class {
      parse() { return { title: "Real Title", content: "<p>Article</p>" } }
    }
    const clip = extractSimplifiedInPage()
    expect(clip).not.toBeNull()
    expect(clip!.title).toBe("Real Title")
    expect(clip!.bodyHtml).toBe("<p>Article</p>")
    expect(clip!.body).toBeNull()
    expect(clip!.mode).toBe("simplified")
    expect(clip!.sourceUrl).toBe("http://example.test/page")
  })

  it("falls back to document.title when Readability title is empty", () => {
    ;(globalThis as any).__JoplinReadability__ = class {
      parse() { return { title: "", content: "<p>x</p>" } }
    }
    resetDocument("<body></body>", "Doc Title")
    const clip = extractSimplifiedInPage()
    expect(clip!.title).toBe("Doc Title")
  })
})

describe("extractFullHtmlInPage", () => {
  it("returns full DOM as bodyHtml", () => {
    resetDocument("<body><p>hi</p></body>", "Full T")
    const clip = extractFullHtmlInPage()
    expect(clip.title).toBe("Full T")
    expect(clip.bodyHtml).toContain("<p>hi</p>")
    expect(clip.body).toBeNull()
    expect(clip.mode).toBe("full-html")
  })

  it("falls back to 'Untitled clip' when title is empty", () => {
    resetDocument("<body></body>", "")
    expect(extractFullHtmlInPage().title).toBe("Untitled clip")
  })
})

describe("extractSelectionInPage", () => {
  beforeEach(() => {
    resetDocument("<body><p id=t>selected text here</p></body>", "Sel T")
  })

  it("returns null when nothing is selected", () => {
    const sel = window.getSelection()
    sel?.removeAllRanges()
    expect(extractSelectionInPage()).toBeNull()
  })

  it("returns plain-text body when there is a selection", () => {
    const node = document.getElementById("t")!.firstChild!
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, node.textContent!.length)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const clip = extractSelectionInPage()
    expect(clip).not.toBeNull()
    expect(clip!.body).toBe("selected text here")
    expect(clip!.bodyHtml).toBeNull()
    expect(clip!.mode).toBe("selection")
  })
})

describe("extractUrlOnlyInPage", () => {
  it("emits a Markdown link in body", () => {
    resetDocument("<body></body>", "Title!", "http://x.test/abc")
    const clip = extractUrlOnlyInPage()
    expect(clip.body).toBe("[Title!](http://x.test/abc)")
    expect(clip.bodyHtml).toBeNull()
    expect(clip.title).toBe("Title!")
    expect(clip.mode).toBe("url-only")
  })

  it("falls back to URL as title when document.title is empty", () => {
    resetDocument("<body></body>", "", "http://x.test/abc")
    const clip = extractUrlOnlyInPage()
    expect(clip.title).toBe("http://x.test/abc")
  })
})
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
pnpm test src/lib/clip-extractors.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `src/lib/clip-extractors.ts`:

```ts
// src/lib/clip-extractors.ts
//
// Per-mode page extraction. extractClip drives chrome.scripting.executeScript
// against the active tab; the per-mode `*InPage` functions are pure DOM
// functions exported separately so they can be unit-tested directly under
// happy-dom (the runtime path passes them to executeScript as `func`).

import type { Clip, ClipMode } from "./joplin-types"

// Filename of the Plasmo-bundled content script that exposes
// __JoplinReadability__ on the page's globalThis. Replace this string
// after Task 6 with the actual file you saw in `build/`. If Plasmo
// hashes the filename, set this from chrome.runtime.getManifest at runtime
// instead of hardcoding.
export const READABILITY_BUNDLE_PATH = "readability-bundle.js"

/** Drives executeScript: inject Readability if needed, then run the per-mode extractor in MAIN world. */
export async function extractClip(tabId: number, mode: ClipMode): Promise<Clip> {
  if (mode === "simplified") {
    // Idempotent — re-running the file just re-assigns the global.
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: [READABILITY_BUNDLE_PATH]
    })
  }
  const fn = pickInPageFn(mode)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fn
  })
  if (result === null || result === undefined) {
    throw new Error(messageForNull(mode))
  }
  return result as Clip
}

function pickInPageFn(mode: ClipMode): () => Clip | null {
  switch (mode) {
    case "simplified":  return extractSimplifiedInPage
    case "full-html":   return extractFullHtmlInPage
    case "selection":   return extractSelectionInPage
    case "url-only":    return extractUrlOnlyInPage
  }
}

function messageForNull(mode: ClipMode): string {
  switch (mode) {
    case "simplified":  return "Readability couldn't parse this page."
    case "selection":   return "Nothing selected."
    case "full-html":
    case "url-only":    return "Couldn't extract page content."
  }
}

// === In-page extractors ===
// These run in the page's MAIN world via executeScript({ func }), which
// ships function source but not its imports. They MUST therefore reference
// only the page's globals (document, window, globalThis.__JoplinReadability__).
// They're exported here so they can also be called directly in happy-dom
// tests without the executeScript hop.

export function extractSimplifiedInPage(): Clip | null {
  const Readability = (
    globalThis as { __JoplinReadability__?: any }
  ).__JoplinReadability__
  if (!Readability) return null
  const docClone = document.cloneNode(true) as Document
  const article = new Readability(docClone).parse()
  if (!article) return null
  return {
    title: article.title || document.title || "Untitled clip",
    body: null,
    bodyHtml: article.content,
    sourceUrl: window.location.href,
    mode: "simplified"
  }
}

export function extractFullHtmlInPage(): Clip {
  return {
    title: document.title || "Untitled clip",
    body: null,
    bodyHtml: document.documentElement.outerHTML,
    sourceUrl: window.location.href,
    mode: "full-html"
  }
}

export function extractSelectionInPage(): Clip | null {
  const sel = window.getSelection()
  const text = sel?.toString() ?? ""
  if (!text.trim()) return null
  return {
    title: document.title || "Untitled clip",
    body: text,
    bodyHtml: null,
    sourceUrl: window.location.href,
    mode: "selection"
  }
}

export function extractUrlOnlyInPage(): Clip {
  const title = document.title || window.location.href
  return {
    title,
    body: `[${title}](${window.location.href})`,
    bodyHtml: null,
    sourceUrl: window.location.href,
    mode: "url-only"
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test src/lib/clip-extractors.test.ts
```

Expected: all pass.

If `extractSelectionInPage` test fails because happy-dom's selection API differs from a browser's, you may need to adjust the test's range setup. Specifically, happy-dom requires the document's `body` to actually contain the node before `getSelection().addRange` can attach to it — which is the case in our `beforeEach`. If failures persist, log `window.getSelection()?.toString()` to debug.

- [ ] **Step 5: Verify the bundled filename**

If you set `READABILITY_BUNDLE_PATH = "readability-bundle.js"` but Plasmo emits a different filename, update the constant now. Check via:

```bash
pnpm build 2>&1 | tail -10 && ls build/chrome-mv3-prod/ 2>/dev/null | grep -i readability
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/clip-extractors.ts src/lib/clip-extractors.test.ts
git commit -m "$(cat <<'EOF'
feat(extension): add per-mode clip extractors

extractClip drives chrome.scripting.executeScript against the active
tab; for simplified mode it first injects readability-bundle.js to put
Readability on globalThis. Per-mode in-page functions are exported so
unit tests can call them directly in happy-dom.

Null returns from simplified/selection are surfaced as user-friendly
error messages via messageForNull.
EOF
)"
```

---

## Task 8: Settings → Joplin subsection

Add a token input + Save + Test-connection to the existing settings UI.

**Files:**
- Modify: `src/sections/settings/SettingsSection.tsx` — add a new subsection. Don't restructure anything else.

- [ ] **Step 1: Read the current Settings UI**

```bash
sed -n '1,120p' src/sections/settings/SettingsSection.tsx
```

Note the existing subsection pattern (heading + grouped controls). Match it.

- [ ] **Step 2: Add the subsection**

In `src/sections/settings/SettingsSection.tsx`, locate an appropriate place to insert a new subsection (likely near other integration sections like Cloudflare, or at the bottom). Add:

```tsx
{/* Joplin clipper */}
<section className="space-y-2">
  <h3 className="font-medium text-fg">Joplin</h3>
  <p className="text-xs text-secondary">
    Paste the Web Clipper token from Joplin Desktop (Tools → Options → Web Clipper →
    Advanced options → Copy token).
  </p>
  <div className="flex gap-2">
    <input
      type="password"
      className="flex-1 px-2 py-1 rounded border border-default bg-bg text-fg text-sm"
      placeholder="Joplin API token"
      value={localJoplinToken}
      onChange={(e) => setLocalJoplinToken(e.target.value)}
    />
    <button
      className="px-3 py-1 rounded border border-default text-sm"
      onClick={async () => {
        await onUpdate({ ...settings, joplinToken: localJoplinToken })
        setJoplinTestResult(null)
      }}>
      Save
    </button>
    <button
      className="px-3 py-1 rounded border border-default text-sm"
      onClick={async () => {
        setJoplinTesting(true)
        const ok = await ping()
        setJoplinTesting(false)
        setJoplinTestResult(ok ? "ok" : "fail")
      }}>
      {joplinTesting ? "Testing…" : "Test connection"}
    </button>
  </div>
  {joplinTestResult === "ok" && (
    <p className="text-xs text-green-500">✓ JoplinClipperServer reachable.</p>
  )}
  {joplinTestResult === "fail" && (
    <p className="text-xs text-red-500">
      Couldn't reach Joplin on localhost:41184. Enable the Web Clipper service in Joplin.
    </p>
  )}
</section>
```

You'll also need to add the imports and the four pieces of local state at the top of the component:

```tsx
import { ping } from "../../lib/joplin-client"

// inside the component, alongside other useState hooks:
const [localJoplinToken, setLocalJoplinToken] = useState(settings.joplinToken ?? "")
const [joplinTesting, setJoplinTesting] = useState(false)
const [joplinTestResult, setJoplinTestResult] = useState<"ok" | "fail" | null>(null)

// And sync localJoplinToken when settings change externally:
useEffect(() => {
  setLocalJoplinToken(settings.joplinToken ?? "")
}, [settings.joplinToken])
```

- [ ] **Step 3: Typecheck and dev-build**

```bash
pnpm typecheck
pnpm build 2>&1 | tail -10
```

Both clean. If your `SettingsSection` props are different from `{ settings, onUpdate }`, adjust the prop spread accordingly — read the existing file shape and adapt.

- [ ] **Step 4: Commit**

```bash
git add src/sections/settings/SettingsSection.tsx
git commit -m "$(cat <<'EOF'
feat(extension): add Joplin subsection to Settings

One password-style input for the API token + Save + Test connection.
Test connection calls the unauthenticated /ping endpoint; success/fail
status renders inline below the buttons.
EOF
)"
```

---

## Task 9: Context menu registration in background.ts

Just the `chrome.contextMenus.create` calls + the `onClicked` dispatch. The actual `handleClipRequest` body lands in Task 10 — for now the click handler just logs and the test confirms registration.

**Files:**
- Modify: `src/background.ts` — add context-menu setup. Don't add the message handler yet (Task 10).

- [ ] **Step 1: Read the current background.ts**

```bash
wc -l src/background.ts && head -30 src/background.ts
```

Note where existing `onInstalled` / `onClicked` listeners are wired.

- [ ] **Step 2: Add the imports and context menus**

At the top of `src/background.ts`:

```ts
import { MENU_ID_TO_MODE } from "./lib/joplin-types"
import type { ClipMode } from "./lib/joplin-types"
```

Inside the existing `chrome.runtime.onInstalled.addListener(...)` callback (or add one if there isn't a single consolidated `onInstalled` already), add:

```ts
// Joplin clipper context menus.
chrome.contextMenus.create({
  id: "joplin-clip",
  title: "Clip to Joplin",
  contexts: ["page", "selection"]
})
chrome.contextMenus.create({
  id: "joplin-clip-simplified",
  parentId: "joplin-clip",
  title: "Simplified page",
  contexts: ["page"]
})
chrome.contextMenus.create({
  id: "joplin-clip-full",
  parentId: "joplin-clip",
  title: "Full HTML",
  contexts: ["page"]
})
chrome.contextMenus.create({
  id: "joplin-clip-selection",
  parentId: "joplin-clip",
  title: "Selection",
  contexts: ["selection"]
})
chrome.contextMenus.create({
  id: "joplin-clip-url",
  parentId: "joplin-clip",
  title: "URL + title",
  contexts: ["page"]
})
```

If `chrome.runtime.onInstalled.addListener` already exists, you'll need to make the additions idempotent — `chrome.contextMenus.create` throws if an id already exists. The robust pattern is:

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    // ... all create calls go here
  })
})
```

Wrap your additions in that `removeAll(() => { ... })` if the existing code doesn't already.

Then add an `onClicked` listener (placeholder body for now — fill in Task 10):

```ts
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  const mode: ClipMode | undefined = MENU_ID_TO_MODE[String(info.menuItemId)]
  if (!mode) return
  // Task 10 will wire this up to handleClipRequest.
  console.info("[joplin-clip] context menu click", { mode, tabId: tab.id })
})
```

- [ ] **Step 3: Verify the extension builds**

```bash
pnpm build 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 4: Manual quick-check (optional but useful)**

```bash
pnpm dev
```

Load `build/chrome-mv3-dev/` (or whatever dev output path Plasmo emits) into Brave via `brave://extensions` → "Load unpacked." Right-click any page; you should see the "Clip to Joplin →" submenu with four entries. Clicking does nothing yet (just logs); that's fine.

Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts
git commit -m "$(cat <<'EOF'
feat(extension): register Joplin clipper context menus

Adds a "Clip to Joplin" parent menu with four mode submenus
(simplified, full HTML, selection, URL+title). The click handler is
a stub for now; Task 10 wires it to handleClipRequest. Idempotent
via chrome.contextMenus.removeAll inside onInstalled.
EOF
)"
```

---

## Task 10: `handleClipRequest` + message handler (background, TDD)

The integration layer. Background takes a `ClipRequest`, extracts via `extractClip`, posts via `createNote`, persists via `prependRecentClip`, broadcasts a `ClipResultEvent`. TDD with a `background.test.ts` that mocks `chrome.scripting.executeScript`, `chrome.runtime.sendMessage`, `fetch`, and the storage layer.

**Files:**
- Modify: `src/background.ts` — add `handleClipRequest`, the `runtime.onMessage` listener, and wire `contextMenus.onClicked` (replace the placeholder body from Task 9).
- Create: `src/background.test.ts`

- [ ] **Step 1: Refactor `handleClipRequest` into a separate testable module**

Background service workers are awkward to import in tests. The cleanest approach: extract the pure logic into `src/lib/joplin-clip-handler.ts`, then have `background.ts` import and call it. The test exercises `joplin-clip-handler.ts` directly.

Create `src/lib/joplin-clip-handler.ts`:

```ts
// src/lib/joplin-clip-handler.ts
//
// The integration layer for one clip. Extracted from background.ts so
// it can be unit-tested without spinning up a service worker. Pure
// async function that takes a ClipRequest + a settings-getter and
// returns nothing — side effects: storage write + sendMessage broadcast.

import { extractClip } from "./clip-extractors"
import { createNote, joplinNoteUrl } from "./joplin-client"
import { prependRecentClip } from "./joplin-recents"
import type {
  ClipRequest,
  ClipResultEvent,
  RecentClip
} from "./joplin-types"

interface Deps {
  getJoplinToken: () => Promise<string>
  /** Mockable wrapper around chrome.runtime.sendMessage. */
  broadcast: (event: ClipResultEvent) => void
  /** Mockable id generator. Default uses src/lib/ulid. */
  newId: () => string
  /** Mockable now(). */
  now: () => Date
}

export async function handleClipRequest(
  req: ClipRequest,
  deps: Deps
): Promise<void> {
  try {
    const token = await deps.getJoplinToken()
    const clip = await extractClip(req.tabId, req.mode)
    const noteId = await createNote(
      {
        title: clip.title,
        body: clip.body ?? undefined,
        bodyHtml: clip.bodyHtml ?? undefined,
        sourceUrl: clip.sourceUrl
      },
      token
    )
    const recent: RecentClip = {
      id: deps.newId(),
      joplinNoteId: noteId,
      title: clip.title,
      mode: req.mode,
      sourceUrl: clip.sourceUrl,
      createdAt: deps.now().toISOString(),
      joplinUrl: joplinNoteUrl(noteId)
    }
    try {
      await prependRecentClip(recent)
    } catch (err) {
      console.warn("[joplin-clip] failed to persist recent clip", err)
    }
    deps.broadcast({
      type: "joplin/clip-result",
      status: "success",
      mode: req.mode,
      title: clip.title,
      recentClip: recent
    })
  } catch (err) {
    deps.broadcast({
      type: "joplin/clip-result",
      status: "error",
      mode: req.mode,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
```

- [ ] **Step 2: Write failing tests**

Create `src/background.test.ts` (or `src/lib/joplin-clip-handler.test.ts` — your call; the test concerns the handler module specifically, so the latter location is cleaner):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the modules joplin-clip-handler imports.
const extractClipMock = vi.fn()
const createNoteMock  = vi.fn()
const prependMock     = vi.fn()

vi.mock("./clip-extractors", () => ({ extractClip: extractClipMock }))
vi.mock("./joplin-client", () => ({
  createNote: createNoteMock,
  joplinNoteUrl: (id: string) => `joplin://x-callback-url/openNote?id=${id}`
}))
vi.mock("./joplin-recents", () => ({ prependRecentClip: prependMock }))

import { handleClipRequest } from "./joplin-clip-handler"
import type { Clip, ClipResultEvent } from "./joplin-types"

function makeDeps(broadcastSink: ClipResultEvent[] = []) {
  return {
    getJoplinToken: async () => "tok",
    broadcast: (ev: ClipResultEvent) => { broadcastSink.push(ev) },
    newId: () => "id-1",
    now: () => new Date("2026-05-26T12:00:00Z")
  }
}

describe("handleClipRequest", () => {
  beforeEach(() => {
    extractClipMock.mockReset()
    createNoteMock.mockReset()
    prependMock.mockReset()
  })

  it("happy path: extract → post → persist → broadcast success", async () => {
    const clip: Clip = {
      title: "Hi",
      body: null,
      bodyHtml: "<p>x</p>",
      sourceUrl: "http://x",
      mode: "simplified"
    }
    extractClipMock.mockResolvedValue(clip)
    createNoteMock.mockResolvedValue("note-abc")
    prependMock.mockResolvedValue(undefined)

    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "simplified", tabId: 42 },
      makeDeps(sink)
    )

    expect(createNoteMock).toHaveBeenCalledWith(
      { title: "Hi", body: undefined, bodyHtml: "<p>x</p>", sourceUrl: "http://x" },
      "tok"
    )
    expect(prependMock).toHaveBeenCalledTimes(1)
    expect(sink).toHaveLength(1)
    expect(sink[0]).toMatchObject({
      type: "joplin/clip-result",
      status: "success",
      mode: "simplified",
      title: "Hi",
      recentClip: {
        id: "id-1",
        joplinNoteId: "note-abc",
        title: "Hi",
        mode: "simplified",
        sourceUrl: "http://x",
        joplinUrl: "joplin://x-callback-url/openNote?id=note-abc"
      }
    })
  })

  it("broadcasts error when extractClip throws", async () => {
    extractClipMock.mockRejectedValue(new Error("Readability couldn't parse this page."))
    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "simplified", tabId: 42 },
      makeDeps(sink)
    )
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(sink[0]).toMatchObject({
      status: "error",
      error: "Readability couldn't parse this page."
    })
  })

  it("broadcasts error when createNote throws", async () => {
    extractClipMock.mockResolvedValue({
      title: "T", body: "x", bodyHtml: null, sourceUrl: "http://x", mode: "url-only"
    })
    createNoteMock.mockRejectedValue(new Error("Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?"))
    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "url-only", tabId: 1 },
      makeDeps(sink)
    )
    expect(prependMock).not.toHaveBeenCalled()
    expect(sink[0]).toMatchObject({
      status: "error",
      error: expect.stringContaining("localhost:41184")
    })
  })

  it("still broadcasts success when prependRecentClip throws", async () => {
    extractClipMock.mockResolvedValue({
      title: "T", body: null, bodyHtml: "<p>x</p>", sourceUrl: "http://x", mode: "simplified"
    })
    createNoteMock.mockResolvedValue("note-abc")
    prependMock.mockRejectedValue(new Error("quota"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "simplified", tabId: 1 },
      makeDeps(sink)
    )
    expect(sink[0].status).toBe("success")
    expect(sink[0].recentClip).toBeDefined() // populated from in-memory, even though storage failed
    warnSpy.mockRestore()
  })
})
```

If you put the test next to the source as `src/lib/joplin-clip-handler.test.ts`, the relative imports will be `./joplin-types` etc.; the file above assumes that location. If you keep it at `src/background.test.ts`, adjust the imports to `./lib/joplin-clip-handler` etc.

- [ ] **Step 3: Run tests to confirm failures**

```bash
pnpm test src/lib/joplin-clip-handler.test.ts
```

Expected: module not found.

- [ ] **Step 4: The handler module is already in Step 1 — run tests now**

```bash
pnpm test src/lib/joplin-clip-handler.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Wire `handleClipRequest` into background.ts**

In `src/background.ts`, replace the placeholder context-menu click handler from Task 9 and add the runtime.onMessage listener:

```ts
import { handleClipRequest } from "./lib/joplin-clip-handler"
import type { ClipMode, ClipRequest, ClipResultEvent } from "./lib/joplin-types"
import { MENU_ID_TO_MODE } from "./lib/joplin-types"
import { Storage } from "@plasmohq/storage"
import { ulid } from "./lib/ulid"

const settingsStorage = new Storage()

async function getJoplinToken(): Promise<string> {
  const settings = await settingsStorage.get<{ joplinToken?: string }>("ai-dev-settings")
  return settings?.joplinToken ?? ""
}

function broadcast(event: ClipResultEvent) {
  // Fire-and-forget. Receivers may not exist (sidebar closed). Errors here
  // are harmless (the well-known "Could not establish connection" when there
  // are no listeners).
  void chrome.runtime.sendMessage(event).catch(() => undefined)
}

async function dispatchClip(req: ClipRequest) {
  await handleClipRequest(req, {
    getJoplinToken,
    broadcast,
    newId: () => ulid(),
    now: () => new Date()
  })
}

// Replace the Task 9 placeholder onClicked body with this:
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  const mode: ClipMode | undefined = MENU_ID_TO_MODE[String(info.menuItemId)]
  if (!mode) return
  await dispatchClip({ type: "joplin/clip", mode, tabId: tab.id })
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && typeof msg === "object" && msg.type === "joplin/clip") {
    dispatchClip(msg as ClipRequest)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }))
    return true // keep the message channel open for the async response
  }
  return undefined
})
```

Note the existing settings storage key in this codebase is `ai-dev-settings` (per `src/storage.ts` you read earlier). Verify by re-reading that file if you didn't already.

- [ ] **Step 6: Build and verify**

```bash
pnpm typecheck && pnpm build 2>&1 | tail -10
```

Both clean.

- [ ] **Step 7: Run the full test suite**

```bash
pnpm test
```

Expected: everything green. New `joplin-clip-handler.test.ts` adds 4 tests; the prior suites should be untouched.

- [ ] **Step 8: Commit**

```bash
git add src/background.ts src/lib/joplin-clip-handler.ts src/lib/joplin-clip-handler.test.ts
git commit -m "$(cat <<'EOF'
feat(extension): wire Joplin clipper handler in background

handleClipRequest extracted into src/lib/joplin-clip-handler.ts so the
integration logic (extract → post → persist → broadcast) is unit-
testable without a service worker. background.ts now dispatches both
context-menu clicks and sidebar runtime messages through it.

Storage write failures are caught and logged but DO NOT poison the
success broadcast — the note is already in Joplin by that point.
EOF
)"
```

---

## Task 11: `JoplinSection` sidebar UI + nav registration

The sidebar React component. Mode picker, clip button, recent clips list, status dot. Plus add `"joplin"` to the section ID union and the sidebar nav.

**Files:**
- Create: `src/sections/joplin/JoplinSection.tsx`
- Modify: `src/sections/types.ts` — add `"joplin"` to `SectionId` and `SECTIONS`.
- Modify: `src/sidepanel.tsx` — import + render switch arm.

- [ ] **Step 1: Add the section id**

In `src/sections/types.ts`, extend `SectionId`:

```ts
export type SectionId =
  | "terminal"
  | "inspector"
  | "extensions"
  | "tech"
  | "session"
  | "quickInfo"
  | "tasks"
  | "passwords"
  | "bookmarks"
  | "captures"
  | "cookies"
  | "recorder"
  | "eyedropper"
  | "joplin"        // NEW
  | "settings";
```

And append to `SECTIONS`:

```ts
{ id: "joplin", label: "Joplin" },
```

Place it before `{ id: "settings", label: "Settings" }` so it ends up near similar integration sections in the rail.

- [ ] **Step 2: Create the section component**

Create `src/sections/joplin/JoplinSection.tsx`:

```tsx
// src/sections/joplin/JoplinSection.tsx
//
// Sidebar UI for the Joplin clipper. Mode picker, Clip button, recent
// clips list, status dot. Passive view over chrome.runtime broadcasts
// of "joplin/clip-result" — background owns the actual clip logic.

import { useEffect, useMemo, useState } from "react"
import {
  CLIP_MODES,
  CLIP_MODE_LABELS,
  type ClipMode,
  type ClipResultEvent,
  type RecentClip
} from "../../lib/joplin-types"
import { ping } from "../../lib/joplin-client"
import {
  getRecentClips,
  clearRecentClips
} from "../../lib/joplin-recents"

const LAST_MODE_KEY = "ai-dev-joplin-last-mode"

export function JoplinSection() {
  const [mode, setMode] = useState<ClipMode>("simplified")
  const [status, setStatus] = useState<"green" | "red" | "unknown">("unknown")
  const [clipping, setClipping] = useState(false)
  const [recents, setRecents] = useState<RecentClip[]>([])
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null)

  // Mount: load recents + last mode + ping.
  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.local.get(LAST_MODE_KEY)
      const lastMode = stored[LAST_MODE_KEY] as ClipMode | undefined
      if (lastMode && CLIP_MODES.includes(lastMode)) setMode(lastMode)
      setRecents(await getRecentClips())
      setStatus((await ping()) ? "green" : "red")
    })()
  }, [])

  // Re-poll status every 30s while mounted.
  useEffect(() => {
    const id = window.setInterval(async () => {
      setStatus((await ping()) ? "green" : "red")
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Listen for clip-result broadcasts.
  useEffect(() => {
    const listener = (msg: unknown) => {
      if (!msg || typeof msg !== "object") return
      const ev = msg as ClipResultEvent
      if (ev.type !== "joplin/clip-result") return
      if (ev.status === "success") {
        setToast({ kind: "success", msg: `Clipped: ${ev.title ?? "(untitled)"}` })
        if (ev.recentClip) {
          setRecents((prev) => [ev.recentClip!, ...prev].slice(0, 50))
        }
      } else {
        setToast({ kind: "error", msg: ev.error ?? "Clip failed." })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  const onSelectMode = (m: ClipMode) => {
    setMode(m)
    void chrome.storage.local.set({ [LAST_MODE_KEY]: m })
  }

  const onClip = async () => {
    if (clipping) return
    setClipping(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (!tab?.id) {
        setToast({ kind: "error", msg: "No active tab." })
        return
      }
      // Fire-and-forget; the result comes back via the chrome.runtime broadcast.
      await chrome.runtime.sendMessage({ type: "joplin/clip", mode, tabId: tab.id })
    } finally {
      window.setTimeout(() => setClipping(false), 300)
    }
  }

  const statusDotColor = useMemo(
    () =>
      status === "green"
        ? "bg-green-500"
        : status === "red"
        ? "bg-red-500"
        : "bg-gray-400",
    [status]
  )

  return (
    <div className="p-3 space-y-3 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${statusDotColor}`} />
        <h2 className="font-semibold">Joplin</h2>
        <span className="text-xs text-secondary">
          {status === "green"
            ? "connected"
            : status === "red"
            ? "unreachable"
            : "checking…"}
        </span>
      </div>

      {/* Mode picker */}
      <div className="grid grid-cols-2 gap-2">
        {CLIP_MODES.map((m) => (
          <button
            key={m}
            onClick={() => onSelectMode(m)}
            className={`px-2 py-1 rounded border text-xs ${
              mode === m ? "border-fg bg-fg/10" : "border-default text-secondary"
            }`}>
            {CLIP_MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Clip button */}
      <button
        disabled={clipping}
        onClick={onClip}
        className="w-full px-3 py-2 rounded bg-fg text-bg font-medium disabled:opacity-50">
        {clipping ? "Clipping…" : `Clip ${CLIP_MODE_LABELS[mode]}`}
      </button>

      {/* Toast */}
      {toast && (
        <div
          className={`text-xs rounded px-2 py-1 ${
            toast.kind === "success"
              ? "bg-green-500/15 text-green-500"
              : "bg-red-500/15 text-red-500"
          }`}>
          {toast.msg}
        </div>
      )}

      {/* Recent clips */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-secondary">Recent clips</h3>
          {recents.length > 0 && (
            <button
              onClick={async () => {
                await clearRecentClips()
                setRecents([])
              }}
              className="text-xs text-secondary hover:text-fg">
              Clear
            </button>
          )}
        </div>
        {recents.length === 0 ? (
          <p className="text-xs text-secondary">No clips yet.</p>
        ) : (
          <ul className="space-y-1 max-h-80 overflow-y-auto">
            {recents.map((c) => (
              <li key={c.id} className="text-xs">
                <a
                  href={c.joplinUrl}
                  className="block truncate hover:underline"
                  title={c.title}>
                  {c.title}
                </a>
                <span className="text-secondary">
                  {CLIP_MODE_LABELS[c.mode]} · {relativeTime(c.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
```

- [ ] **Step 3: Register in `sidepanel.tsx`**

Open `src/sidepanel.tsx`. Add the import alongside the existing section imports:

```tsx
import { JoplinSection } from "./sections/joplin/JoplinSection";
```

Add the render arm in the body switch (the block that has `{active === "captures" && <CapturesSection />}` etc.):

```tsx
{active === "joplin" && <JoplinSection />}
```

Place it near the other integration sections.

- [ ] **Step 4: Build and verify**

```bash
pnpm typecheck && pnpm build 2>&1 | tail -10
```

Both clean. If your `SidebarRail` component derives icons from `SECTIONS` and complains about a missing icon mapping for `"joplin"`, add an icon entry — the cleanest way is to grep for how other section IDs map to icons (`grep -rn '"captures"' src/components`), then mirror that pattern. If there's no central icon mapping the new section just shows up without one — that's acceptable for MVP.

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
```

Expected: still green (no new tests for the React component per the spec).

- [ ] **Step 6: Commit**

```bash
git add src/sections/types.ts src/sections/joplin/JoplinSection.tsx src/sidepanel.tsx
git commit -m "$(cat <<'EOF'
feat(extension): add Joplin sidebar section

Mode picker, Clip button, status dot (green/red based on /ping), and
a recent-clips list with joplin:// deep links. Passive view over the
"joplin/clip-result" broadcast — all clip logic lives in the
background handler.

SectionId gains "joplin"; SECTIONS gains a "Joplin" entry; sidepanel
renders <JoplinSection /> when active.
EOF
)"
```

---

## Task 12: README addition + done-criteria checklist

One-screen update to surface the feature.

**Files:**
- Modify: `README.md` — add a short "Joplin Clipper" subsection under existing Extension Functionality, plus the done-criteria checklist.

- [ ] **Step 1: Find the right location**

The repo's top-level `README.md` has an "Extension Functionality" bullet list. Insert a new bullet there. Then add a dedicated subsection later in the file (after the existing feature descriptions) with the done-criteria.

- [ ] **Step 2: Add to the bullet list**

After the existing "Recorder" bullet (or wherever fits the list order), add:

```markdown
- **Joplin clipper:** save the current page to Joplin Desktop in four modes
  (simplified article, full HTML, selection, URL+title) via the sidebar or
  a right-click context menu. Requires Joplin's Web Clipper *service*
  (Tools → Options → Web Clipper → Enable) but not Joplin's own browser
  extension. Token configured in Settings → Joplin.
```

- [ ] **Step 3: Add the done-criteria subsection**

Toward the bottom of the README (before the contributing section, if any), add:

```markdown
## Joplin clipper — done-criteria checklist

- [ ] `pnpm build` produces a clean Plasmo bundle with `readability-bundle.*.js` present under `build/chrome-mv3-prod/`.
- [ ] `pnpm test` (vitest) is green, including the new Joplin test files.
- [ ] Load `build/chrome-mv3-prod/` unpacked in Brave → sidebar shows the new "Joplin" section.
- [ ] Settings → Joplin → paste token → Save → **Test connection** reports ✓ JoplinClipperServer.
- [ ] Right-click any page → "Clip to Joplin → Simplified page" → toast shows "Clipped: \<title\>" within ~2s.
- [ ] Open Joplin Desktop → the clipped note exists with the page's simplified Markdown body and `source_url` set.
- [ ] Select text on a page → right-click → "Clip to Joplin → Selection" → Joplin note body equals the selected text.
- [ ] Sidebar "Recent clips" list shows all four entries; clicking one opens the note in Joplin via the `joplin://` deep link.
- [ ] Stop Joplin Desktop → click Clip → toast says "Couldn't reach Joplin." Status dot turns red within 30s.
- [ ] Clear the token in Settings → Clip button still works mechanically but the result toast says "No Joplin API token configured."
- [ ] Click Clip on a `chrome://` page → toast says "Couldn't extract page content" (or similar).
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs(extension): document the Joplin clipper feature

Adds an Extension Functionality bullet and a done-criteria checklist.
The checklist doubles as a manual smoke-test recipe for end-to-end
verification against a real Joplin Desktop install.
EOF
)"
```

---

## Final manual verification (not a commit)

After the 12 tasks land, walk the done-criteria checklist from Task 12 step 3 against a real Joplin Desktop install. Anything that fails is a follow-up commit.

The build → sidebar-section → context-menu → live-clip flow can be tested in this order, fastest to slowest:

1. `pnpm test` — all green
2. `pnpm build` — clean, `readability-bundle.*.js` present
3. Load unpacked in Brave, open sidebar → Joplin section visible
4. Paste token, Save, Test connection → ✓
5. Clip the current page → confirm in Joplin

---

## Self-review log

The spec was checked against this plan section by section:

| Spec section | Plan task |
|---|---|
| Goal + locked decisions | All — design preserved across tasks |
| Architecture diagram | T9 (context menus), T10 (handler), T11 (sidebar) collectively |
| Data model — Settings extension | T1 |
| Data model — ClipMode + Clip + RecentClip + messages | T3 |
| Data model — storage keys | T1 (token), T5 (recents), T11 (last-mode) |
| Components — joplin-client.ts | T4 |
| Components — joplin-types.ts | T3 |
| Components — joplin-recents.ts | T5 |
| Components — clip-extractors.ts | T7 (preceded by T6 for the readability bundle) |
| Components — readability-bundle.ts | T6 |
| Components — JoplinSection.tsx | T11 |
| Background changes — context menus | T9 |
| Background changes — handler + onMessage | T10 (extracted to joplin-clip-handler.ts for testability) |
| Settings UI subsection | T8 |
| Storage helpers | T5 (recents), T1 (token field), T8 (consumed) |
| package.json @mozilla/readability | T2 |
| Manifest host_permissions + permissions | T2 verifies the existing manifest already covers them — no change needed |
| Data flow — two entry paths, one pipeline | T10 (handler) + T9 (context menu source) + T11 (sidebar source) |
| Error handling matrix | T4 / T7 throw the right messages; T10 ensures all errors broadcast |
| Edge cases (chrome:// URLs, PDFs, etc.) | T7's null-return messages handle them; toast surfaces them via T11 |
| Testing — joplin-client.test.ts | T4 |
| Testing — joplin-recents.test.ts | T5 |
| Testing — clip-extractors.test.ts | T7 |
| Testing — background.test.ts (renamed to joplin-clip-handler.test.ts) | T10 |
| Done-criteria checklist | T12 |
