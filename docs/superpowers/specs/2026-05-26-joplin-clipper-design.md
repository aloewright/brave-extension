# Joplin Clipper Feature (Design)

**Status:** Approved 2026-05-26.
**Author:** Claude, paired with project owner.
**Scope:** `ai-dev-sidebar` (Brave/Chromium MV3 extension, Plasmo, TypeScript + React).

## Goal

Add an in-extension "Clip to Joplin" feature so the user can save the current page to their Joplin Desktop instance without installing Joplin's official browser extension. Both a dedicated sidebar section and a right-click context menu are available. Joplin Desktop's Web Clipper **service** (localhost:41184) must be enabled; the official browser **extension** is not needed.

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| Clip modes (MVP) | Simplified page, Full HTML, Selection, URL + title | Matches Joplin's official extension. Four modes, all in one drop. |
| UI placement | New "Joplin" sidebar section **and** right-click context menu (4 submenu entries) | Sidebar for rich UI, menu for muscle memory. No toolbar popup. |
| Settings shape | Single field: `joplinToken: string` | YAGNI: base URL hardcoded to `http://localhost:41184`, no default-notebook, no default-mode. |
| Post-clip UX | Toast (success/error) + Recent clips list inside the sidebar section | Auto-opening the note in Joplin is opt-out by default (not added). |
| Readability source | `@mozilla/readability` (Apache-2.0, ~30KB) | Industry standard. Hand-rolled heuristic would be worse. |
| Where `fetch` runs | Background service worker | Both the sidebar section and the context menu message into the background. Single code path. No CORS concerns. |
| HTTP→Markdown conversion | Server-side, by Joplin (`body_html` field) | Simplified + Full HTML send HTML to Joplin; Joplin converts. Avoids bundling a Markdown converter client-side. |

## Architecture

```
                                  ┌──────────────────────────────┐
  User triggers a clip via:        │  Background service worker   │
  ┌─────────────────────┐          │  (src/background.ts)         │
  │ Sidebar Joplin tab  │──────────┤                              │
  │  (mode picker UI)   │  msg     │   JoplinClipper handler:     │
  └─────────────────────┘          │     1. Extract content       │──┐
                                   │        (chrome.scripting     │  │
  ┌─────────────────────┐          │         .executeScript into  │  │
  │ Right-click submenu │──────────┤         active tab)          │  │
  │  4 mode entries     │  msg     │     2. Shape Joplin payload  │  │
  └─────────────────────┘          │     3. POST :41184/notes     │  │
                                   │     4. Persist recent clip   │  │
                                   │     5. Broadcast toast event │──┤
                                   └──────────────────────────────┘  │
                                                                      ▼
                          ┌──────────────────────┐         ┌─────────────────────────┐
                          │ Joplin Desktop       │◄────────│ Joplin Web Clipper svc  │
                          │ (your local DB)      │         │ http://localhost:41184  │
                          └──────────────────────┘         └─────────────────────────┘

                          ┌──────────────────────────────────────┐
   Sidebar listens on the │ chrome.runtime.onMessage broadcasts: │
   broadcast channel for  │  • 'joplin/clip-result'              │
   toast + recents list   │      → toast (success/failure)       │
                          │      → prepend to recent clips       │
                          └──────────────────────────────────────┘
```

The sidebar UI and the context menu both message into the background; the background is the single owner of the extract→post→persist→broadcast flow. Recent-clips storage and toast broadcasts come back out via `chrome.runtime.onMessage`, so the sidebar section is a passive view that re-renders on event.

## Data model

### `Settings` extension (in `src/types.ts`)

```ts
export interface Settings {
  // ...existing fields stay...
  joplinToken: string   // NEW. Empty string when unconfigured.
}
```

One field, no nested object. Base URL is hardcoded. Migration is automatic: existing users get `joplinToken: ""` on next load via the standard `{ ...DEFAULT_SETTINGS, ...stored }` merge.

### Clip mode enum (new file: `src/lib/joplin-types.ts`)

```ts
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
```

Drives the sidebar's mode picker iteration and the four context-menu entries — single source of truth.

### `Clip` payload (extractor output → Joplin client input)

```ts
export interface Clip {
  title: string                  // page title or "Untitled clip"
  body: string | null            // Markdown body if we built one (simplified, selection, url-only)
  bodyHtml: string | null        // HTML body for Joplin's server-side conversion (full-html)
  sourceUrl: string              // window.location.href at clip time
  mode: ClipMode
}
```

Exactly one of `body` / `bodyHtml` is non-null per mode:
- `simplified` → `bodyHtml` (Readability HTML, Joplin converts)
- `full-html`  → `bodyHtml` (whole DOM, Joplin converts)
- `selection`  → `body`     (plain text, Markdown by definition)
- `url-only`   → `body`     (one-line Markdown link)

### `RecentClip` (what we persist)

```ts
export interface RecentClip {
  id: string                     // ulid (existing src/lib/ulid.ts)
  joplinNoteId: string           // returned by POST /notes
  title: string
  mode: ClipMode
  sourceUrl: string
  createdAt: string              // ISO timestamp
  joplinUrl: string              // joplin://x-callback-url/openNote?id=<noteId>
}

export interface RecentClipsStore {
  clips: RecentClip[]            // newest first, capped at 50
}
```

Stored under storage key `ai-dev-joplin-recent-clips`. Cap enforced on write.

### Message contract (background ↔ sidebar/context menu)

```ts
// Request (sidebar → background, context menu → background)
export interface ClipRequest {
  type: "joplin/clip"
  mode: ClipMode
  tabId: number
}

// Result broadcast (background → all listeners)
export interface ClipResultEvent {
  type: "joplin/clip-result"
  status: "success" | "error"
  mode: ClipMode
  title?: string                 // present on success
  error?: string                 // present on error (user-facing message)
  recentClip?: RecentClip        // present on success — sidebar prepends to its list
}
```

`chrome.runtime.onMessage` broadcast pattern, matching how `recorder` and `captures` features already coordinate.

### Storage layout summary

| Key | Type | Notes |
|---|---|---|
| `ai-dev-settings` (existing) | `Settings` (extended with `joplinToken`) | One added field |
| `ai-dev-joplin-recent-clips` (new) | `RecentClipsStore` | Bounded to 50 |
| `ai-dev-joplin-last-mode` (new, optional) | `ClipMode` | Remember the last-used mode in the sidebar picker |

## Components

### New files

| File | Responsibility |
|---|---|
| `src/lib/joplin-client.ts` | Pure HTTP. `createNote(input, token)`, `ping()`, `joplinNoteUrl(id)`. No `chrome.*`, no DOM. Testable with fetch stubs. |
| `src/lib/joplin-types.ts` | Shared TS types: `ClipMode`, `Clip`, `RecentClip`, message types. |
| `src/lib/joplin-recents.ts` | Recent-clips storage helpers: `getRecentClips()`, `prependRecentClip(clip)` (caps at 50), `clearRecentClips()`. |
| `src/lib/clip-extractors.ts` | `extractClip(tabId, mode)`: drives `chrome.scripting.executeScript` against the active tab and runs the per-mode extractor in the page's MAIN world. |
| `src/contents/readability-bundle.ts` | Plasmo content-script entry with `matches: []` (bundled but never auto-injected). Injected on demand by the background via `executeScript({ files })`. Exposes Readability on `window.__JoplinReadability__`. The bundled output filename is determined by Plasmo's build; the implementer verifies the actual filename in `build/` and uses it in the `executeScript({ files })` call. |
| `src/sections/joplin/JoplinSection.tsx` | Sidebar UI: status dot, mode picker, clip button, recent clips list. Reads `Settings`, listens for `joplin/clip-result` broadcasts. |

### Edited files

| File | Change |
|---|---|
| `src/background.ts` | Add `joplin/clip` message handler + four `chrome.contextMenus.create` entries on install. Single `handleClipRequest` drives extract → POST → persist → broadcast. |
| `src/sections/settings/SettingsSection.tsx` | Add a "Joplin" subsection: password-style token input, Save, Test connection (calls `ping()` + an authenticated lightweight call). |
| `src/storage.ts` | Add `joplinToken` accessor; export `getRecentClips` / `prependRecentClip` / `clearRecentClips` (or in a new module). |
| `src/types.ts` | Extend `Settings` and `DEFAULT_SETTINGS` with `joplinToken: ""`. |
| `package.json` | Add `@mozilla/readability` to dependencies. |
| Plasmo manifest config | Add `"http://localhost:41184/*"` to `host_permissions`; confirm `contextMenus` and `scripting` are in `permissions` (likely already present). |

### Per-mode extractor functions (in `clip-extractors.ts`, executed in page MAIN world)

```ts
function extractSimplifiedInPage(): Clip | null {
  const Readability = (globalThis as any).__JoplinReadability__
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

function extractFullHtmlInPage(): Clip {
  return {
    title: document.title || "Untitled clip",
    body: null,
    bodyHtml: document.documentElement.outerHTML,
    sourceUrl: window.location.href,
    mode: "full-html"
  }
}

function extractSelectionInPage(): Clip | null {
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

function extractUrlOnlyInPage(): Clip {
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

The "Readability subtlety": `chrome.scripting.executeScript({ func })` ships function source but not its imports. We pre-bundle Readability as a content-script entry (`src/contents/readability-bundle.ts`) declared with `matches: []` so Plasmo bundles it but never auto-injects it. The background then injects it on demand via `executeScript({ files: ["<plasmo-output-filename>.js"] })` before each clip. The inline `func` reads `globalThis.__JoplinReadability__`. The inject is idempotent (re-running the file just re-assigns the global).

The exact bundled filename is Plasmo-dependent (e.g., `readability-bundle.<hash>.js` in older Plasmo versions, predictable in newer ones). The implementer inspects `build/` after the first `pnpm dev` or `pnpm build` to confirm the filename and uses it verbatim. The `readability-bundle.ts` source itself looks like:

```ts
import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"

export const config: PlasmoCSConfig = {
  matches: []   // empty: not auto-injected. Loaded on demand via chrome.scripting.executeScript({ files }).
}

;(globalThis as any).__JoplinReadability__ = Readability
```

### Background handler shape (in `src/background.ts`)

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: "joplin-clip", title: "Clip to Joplin", contexts: ["page", "selection"] })
  chrome.contextMenus.create({ id: "joplin-clip-simplified", parentId: "joplin-clip", title: "Simplified page", contexts: ["page"] })
  chrome.contextMenus.create({ id: "joplin-clip-full",       parentId: "joplin-clip", title: "Full HTML",       contexts: ["page"] })
  chrome.contextMenus.create({ id: "joplin-clip-selection",  parentId: "joplin-clip", title: "Selection",       contexts: ["selection"] })
  chrome.contextMenus.create({ id: "joplin-clip-url",        parentId: "joplin-clip", title: "URL + title",     contexts: ["page"] })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return
  const mode = MENU_ID_TO_MODE[info.menuItemId as string]
  if (!mode) return
  await handleClipRequest({ type: "joplin/clip", mode, tabId: tab.id })
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "joplin/clip") {
    handleClipRequest(msg).then(() => sendResponse({ ok: true }))
    return true
  }
})

async function handleClipRequest(req: ClipRequest) {
  const settings = await getSettings()
  try {
    const clip = await extractClip(req.tabId, req.mode)
    const noteId = await createNote({
      title: clip.title,
      body: clip.body ?? undefined,
      bodyHtml: clip.bodyHtml ?? undefined,
      sourceUrl: clip.sourceUrl
    }, settings.joplinToken)
    const recent: RecentClip = {
      id: ulid(),
      joplinNoteId: noteId,
      title: clip.title,
      mode: req.mode,
      sourceUrl: clip.sourceUrl,
      createdAt: new Date().toISOString(),
      joplinUrl: joplinNoteUrl(noteId)
    }
    try {
      await prependRecentClip(recent)
    } catch (err) {
      console.warn("[joplin-clip] failed to persist recent clip", err)
    }
    chrome.runtime.sendMessage({
      type: "joplin/clip-result",
      status: "success",
      mode: req.mode,
      title: clip.title,
      recentClip: recent
    } satisfies ClipResultEvent)
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "joplin/clip-result",
      status: "error",
      mode: req.mode,
      error: err instanceof Error ? err.message : String(err)
    } satisfies ClipResultEvent)
  }
}
```

`prependRecentClip` failure does NOT poison the success broadcast (the note IS in Joplin); it logs a warning, the broadcast still goes out with `recentClip` populated from in-memory, and the next sidebar storage-read sees the persisted state catch up.

### `JoplinSection.tsx` shape

Sections top-to-bottom:
1. **Header** — title "Joplin", icon, status dot (green if `ping()` succeeded, red otherwise — pinged on mount + every 30s while visible; no polling while closed).
2. **Mode picker** — four buttons in a 2×2 grid (or a `<select>` if tighter). Persists last-used mode in storage under `ai-dev-joplin-last-mode`.
3. **Clip button** — disabled if (a) no token, (b) status dot is red, (c) mode is `selection` and `window.getSelection().toString()` is empty (best-effort check on focus). Disables for ~300ms after click as a soft single-fire guard.
4. **Recent clips list** — virtualized via `@tanstack/react-virtual` (already a dep). Row: title (link → `joplin://` URL), mode chip, relative timestamp, source URL favicon. Empty state: "No clips yet."

Mounts a `chrome.runtime.onMessage` listener for `joplin/clip-result`:
- Show toast (success or failure styling)
- On success with `recentClip` populated, prepend to local React state

Reads recents from storage on mount; doesn't otherwise own state.

## Data flow

### Two entry paths, one shared pipeline

**Path A — Sidebar:** mode picker → "Clip" button → `chrome.tabs.query({ active: true, currentWindow: true })` → `chrome.runtime.sendMessage({ type: "joplin/clip", mode, tabId })`.

**Path B — Context menu:** right-click → "Clip to Joplin → <mode>" → `chrome.contextMenus.onClicked` fires with `(info, tab)` → `handleClipRequest({ type: "joplin/clip", mode: MENU_ID_TO_MODE[info.menuItemId], tabId: tab.id })`.

Both end at `handleClipRequest` in the background.

### Shared pipeline

```
handleClipRequest({ mode, tabId })
  → read Settings (joplinToken). Fail fast if empty.
  → extractClip(tabId, mode):
      → executeScript({ files: ["readability-bundle.js"] })   // idempotent inject
      → executeScript({ func: extractorFor(mode) })
      → Clip | null
  → createNote(clip, token)                                   // POST :41184/notes
  → prependRecentClip(recent)                                  // storage write; failure logs but doesn't fail the clip
  → sendMessage(ClipResultEvent { status: "success", recentClip, ... })
```

Any throw in the chain is caught and broadcast as `status: "error"` with a sanitized message.

**Idempotency:** Clicking "Clip" twice quickly creates two Joplin notes. The sidebar button has a soft ~300ms disable; the context menu has no guard. Documented behavior.

**`ping()` lifecycle:** sidebar polls every 30s while visible; off when closed. The clip button does NOT pre-check `ping()` before firing — the error path handles unreachable cleanly. This avoids a race where the user clicks Clip just as the 30s poll says "down" but Joplin came back up between.

## Error handling

| Category | Trigger | Toast message | Log level |
|---|---|---|---|
| No token | `settings.joplinToken === ""` | "Configure your Joplin token in Settings before clipping." (with a sidebar link to Settings → Joplin) | `info` |
| Joplin unreachable | `fetch` rejects, or `/ping` doesn't return `JoplinClipperServer` | "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?" | `warn` |
| Joplin auth/server error | `res.ok === false` from `/notes` | "Joplin API error \<status\>: \<truncated body, 200 chars\>". 401 adds "Token may be invalid." | `error` |
| Extraction failure | Per-mode extractor returns `null`, or `executeScript` rejects | "Readability couldn't parse this page" / "Nothing selected" / "Can't clip this page (chrome:// or extension URL)" depending on cause | `info` for the first two, `warn` for the third |
| Storage failure | `prependRecentClip` throws (quota/corruption) | No separate toast — clip succeeded. Log a warn. | `warn` |

### Token handling

- Stored as `Settings.joplinToken: string` via `@plasmohq/storage`. Same trust boundary as the rest of ai-dev-sidebar's secrets.
- Settings field is `type="password"`.
- Token is URL-encoded into the query string every time.
- Token is never logged.
- Settings → "Test connection" calls `ping()` (no token) for liveness, then `GET /folders?token=…&limit=1` for auth. On 401 → "Token rejected" without echoing the token.

### Edge cases

1. `chrome://` and Chrome Web Store pages — `executeScript` rejects. Toast: "Can't clip this page (chrome:// or extension URL)".
2. PDF tabs — Chrome's built-in PDF viewer; extractors return null/odd structure. Same toast as "Readability couldn't parse". Future: dedicated PDF extractor (out of scope).
3. Iframes / embeds — `executeScript` runs in top frame only. Selection inside iframes not captured. Matches official Joplin extension.
4. Very long pages — Readability handles them but slowly. No timeout in MVP. Future: 5s race + "Page too large to simplify" fallback (out of scope).
5. Titleless pages — fall back to URL, then "Untitled clip".
6. Active tab disappears mid-clip — `executeScript` rejects with "No tab with id". Toast: "Tab closed before clip could finish."
7. Concurrent clips on the same page — two clicks = two notes. Sidebar button has ~300ms disable; context menu doesn't. Documented.
8. Joplin Desktop restarted mid-session — token survives, next clip succeeds, status dot updates ≤30s.
9. Token rotated in Joplin — old token → 401. Toast: "Token rejected. Re-copy from Tools → Options → Web Clipper → Advanced." Settings → Test connection is the resolution affordance.
10. Selection with rich HTML — MVP captures plain text only (formatting lost). Future: `cloneContents()` + `body_html`. Out of scope.
11. Multi-monitor / detached tab — sidebar uses `chrome.windows.getCurrent()` to scope to its own window; context menu uses `tab.id` directly. No ambiguity.
12. Readability not yet loaded on the page — we always inject before the per-mode extractor; cost is ~30KB transferred per clip into the page world, negligible.

## Testing

Vitest already wired (`pnpm test`). Playwright present but not gating CI — matching the project's existing posture.

### New test files: 4. Estimated ~250–350 lines total.

| File | Coverage |
|---|---|
| `src/lib/joplin-client.test.ts` | POST body shape (body vs body_html); URL-encoded token; ping happy/sad; error mapping (0 / 401 / 500); empty-token guard; missing-id defensive case; joplinNoteUrl format. |
| `src/lib/joplin-recents.test.ts` | Cold-start empty; prepend round-trip; newest-first order; 50-cap; clear. |
| `src/lib/clip-extractors.test.ts` | All four per-mode extractors via happy-dom; Readability mocked (we test wiring, not Readability); null-return paths. |
| `src/background.test.ts` | `handleClipRequest` end-to-end-ish: happy path broadcasts success with `recentClip`; extract-null path broadcasts error; fetch-failure path broadcasts error; storage-failure path still broadcasts success with `recentClip` populated from in-memory. |

### What we explicitly do NOT test

- Readability itself (black box).
- Real Joplin Desktop integration — that's the done-criteria manual checklist, not a programmable test.
- `chrome.contextMenus` event delivery (would be testing Chrome, not our code).
- `JoplinSection.tsx` visual output — Plasmo doesn't ship a React testing-library config; adding one for one section isn't proportionate. The component is a passive view over an event stream; the bugs that matter live in the background handler, which IS tested.

## Phase done-criteria checklist (for `JoplinSection`'s sidebar copy / README addition)

- [ ] `pnpm build` produces a clean Plasmo bundle with `readability-bundle.js` present in `build/`.
- [ ] `pnpm test` (vitest) is green, including the four new test files.
- [ ] Load unpacked in Brave/Chromium → sidebar shows new "Joplin" section.
- [ ] Settings → Joplin → paste token → Save → Test connection reports ✓ JoplinClipperServer.
- [ ] Right-click any page → "Clip to Joplin → Simplified page" → toast says "Clipped: <title>" within ~2s.
- [ ] Open Joplin → the clipped note exists with title, simplified Markdown body, and `source_url` set.
- [ ] Select text → right-click → "Clip to Joplin → Selection" → Joplin note body is the selected text.
- [ ] Sidebar "Recent clips" shows all four entries; clicking one opens the note in Joplin via `joplin://` URL.
- [ ] Stop Joplin Desktop → click Clip → toast says "Couldn't reach Joplin." Status dot turns red.
- [ ] Clear the token in Settings → Clip button disables with "Configure your Joplin token" hint.
- [ ] Click Clip on a `chrome://` page → toast says "Can't clip this page."

## Known limitations carried forward

1. **Selection mode is plain-text only.** Rich formatting is lost. Future: `cloneContents()` + `body_html`.
2. **No timeout on Readability.** Pathologically large pages can hang the clip for several seconds. Future: 5s race + fallback toast.
3. **PDF tabs not supported.** They fall through to "Readability couldn't parse" or similar. Future: dedicated PDF extractor.
4. **No keyboard shortcut in MVP.** Sidebar button + context menu only. Future: `chrome.commands` binding.
5. **No notebook (parent_id) selector.** All clips land in Joplin's default inbox. Future: dropdown in the sidebar + persisted default in Settings.
6. **Recent clips are local-only.** Not synced; bounded to 50. Reset on extension uninstall.

## File-level deliverables

```
ai-dev-sidebar/
├── package.json                                    ← add @mozilla/readability dep
├── src/
│   ├── background.ts                               ← + joplin/clip handler + contextMenus
│   ├── types.ts                                    ← Settings.joplinToken: ""
│   ├── storage.ts                                  ← token accessor + recents helpers
│   ├── lib/
│   │   ├── joplin-client.ts                        (new)
│   │   ├── joplin-types.ts                         (new)
│   │   ├── joplin-recents.ts                       (new)
│   │   └── clip-extractors.ts                      (new)
│   ├── contents/
│   │   └── readability-bundle.ts                   (new)
│   ├── sections/
│   │   ├── joplin/
│   │   │   └── JoplinSection.tsx                   (new)
│   │   └── settings/
│   │       └── SettingsSection.tsx                 ← + Joplin subsection
└── tests (alongside source per existing convention):
    src/lib/
    ├── joplin-client.test.ts                       (new)
    ├── joplin-recents.test.ts                      (new)
    └── clip-extractors.test.ts                     (new)
    src/
    └── background.test.ts                          (new)
```

(Manifest changes live in `package.json`'s `manifest` block, or `plasmo.config.ts` if introduced — implementer's call based on what already exists.)
