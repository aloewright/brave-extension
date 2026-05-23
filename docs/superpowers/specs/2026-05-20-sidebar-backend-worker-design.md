# Sidebar Backend Worker — Replaces cloudos routes

**Status:** Draft
**Date:** 2026-05-20
**Owner:** aloe

## 1. Goal

Stand up a Cloudflare Worker (the **sidebar-api** Worker) that becomes the single backend for the AI Dev Sidebar extension. It absorbs the existing chat-conversation sync that today targets `notes.pdx.software`, and adds first-class storage for four new resource types — **links**, **bookmarks**, **recordings**, **PDFs** — plus a lightweight web UI at the same origin so saved content is browsable from any browser.

The Worker takes over from the cloudos-notes route entirely. The extension stops talking to `notes.pdx.software` and starts talking to one URL (`sidebar.pdx.software` placeholder) with one shared token.

## 2. Non-goals

- Multi-user accounts, OAuth, or per-user data isolation. Single-user, shared-secret auth.
- Editing or deleting items from the web UI in v1 (view-only). CRUD via API still allowed; UI gains write actions later.
- A separate Cloudflare Pages site. The SPA is served as static assets from the same Worker.
- Auto-migration of existing notes from `notes.pdx.software`. A standalone migration script is included but optional.
- Federated search across other cloudos services. Vectorize index here is dedicated to this Worker.
- PDF OCR via paid third-party APIs. We attempt text-layer extraction first; OCR fallback is a vision-model call routed through AI Gateway.

## 3. Architecture

One Hono Worker for the API + SPA, one Workflow for durable ingest pipelines, three storage primitives, all under one custom domain.

```
                                  ┌─────────────────────────────────────┐
   Browser (anywhere)             │  sidebar-api Worker  (one script)   │
   GET sidebar.pdx.software/  ──▶ │                                     │
   ◀── SPA HTML/JS (assets)  ─────│   ASSETS binding ──┐                │
                                  │                     SPA at /        │
   Browser → /api/* with          │   Hono router  ─── /api/*           │
   X-Sidebar-Token              ──▶                                     │
                                  │   ──► DB        (D1)                │
   Extension                      │   ──► BLOBS     (R2)                │
   POST /api/* with             ──▶   ──► VECTORS   (Vectorize)         │
   X-Sidebar-Token                │   ──► AI        (Workers AI binding)│
                                  │        via { gateway: { id: "x" } } │
                                  │   ──► INGEST.create()  ────────┐    │
                                  └────────────────────────────────┼────┘
                                                                   │
                                                                   ▼
                                              ┌──────────────────────────────┐
                                              │  ingest Workflow             │
                                              │  (per recording / per PDF)   │
                                              │                              │
                                              │  1. verify R2 object         │
                                              │  2. extract content          │
                                              │     - recordings → STT       │
                                              │     - PDFs → text layer,     │
                                              │       OCR fallback           │
                                              │  3. chunk text               │
                                              │  4. embed chunks             │
                                              │  5. upsert into Vectorize    │
                                              │  6. set D1 row status=ready  │
                                              │  Each step durable + retried │
                                              └──────────────────────────────┘
```

**Bindings (wrangler.toml):**

| Binding | Resource | Notes |
|---|---|---|
| `DB` | D1 database `sidebar` | Metadata for all 5 resource types |
| `BLOBS` | R2 bucket `sidebar-blobs` | Recordings + PDFs |
| `VECTORS` | Vectorize index `sidebar-search` | One index, type-namespaced ids |
| `AI` | Workers AI | Embeddings, STT, OCR — always with `{ gateway: { id: "x" } }` |
| `INGEST` | Workflow `ingest` | Durable per-blob pipeline |
| `ASSETS` | Static assets | `worker/dist/web/`, SPA fallback |

**Secrets:** `SIDEBAR_TOKEN` (set via `wrangler secret put`).

**AI Gateway policy (from CLAUDE.md):** every AI call inside the Worker uses the documented working pattern — `env.AI.run("@cf/<model>", payload, { gateway: { id: "x" } })`. Dynamic routes via `env.AI.run("dynamic/...")` are broken upstream; we use specific Workers AI model ids and route them through the gateway for caching/observability. A code comment at each call site points back at this section so we can switch to dynamic routes when the binding is fixed.

## 4. Data model (D1)

All ids are ULIDs except `bookmarks.id`, which is the Chrome bookmark id (so re-syncing the tree is idempotent).

```sql
-- conversations: per-backend chat sessions (replaces cloudos-notes)
CREATE TABLE conversations (
  id            TEXT PRIMARY KEY,
  backend       TEXT NOT NULL,         -- 'claude'|'gemini'|'copilot'|'codex'
  title         TEXT NOT NULL,
  content_text  TEXT NOT NULL,         -- full serialized session
  message_count INTEGER NOT NULL DEFAULT 0,
  chunk_count   INTEGER NOT NULL DEFAULT 0,  -- # of vectors emitted for this row
  started_at    INTEGER NOT NULL,      -- ms epoch, first user msg
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_backend ON conversations(backend, updated_at DESC);

-- links: lx CollectedLink rows
CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,                    -- optional captured snippet
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  favicon     TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_links_url ON links(url);
CREATE INDEX idx_links_created ON links(created_at DESC);

-- bookmarks: snapshot pushed from chrome.bookmarks
CREATE TABLE bookmarks (
  id          TEXT PRIMARY KEY,        -- chrome bookmark id
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  parent_id   TEXT,
  path        TEXT NOT NULL DEFAULT '[]',  -- JSON array of folder titles
  category    TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  date_added  INTEGER,
  position    INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  synced_at   INTEGER NOT NULL
);
CREATE INDEX idx_bookmarks_synced ON bookmarks(synced_at DESC);
CREATE INDEX idx_bookmarks_category ON bookmarks(category);

-- recordings: file in R2, metadata + transcript in D1
CREATE TABLE recordings (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  size_bytes     INTEGER NOT NULL,
  source         TEXT NOT NULL,        -- 'tab'|'screen'|'camera'
  origin_url     TEXT,
  r2_key         TEXT NOT NULL,        -- 'recordings/<id>.<ext>'
  transcript     TEXT,                 -- filled by Workflow
  status         TEXT NOT NULL DEFAULT 'pending',
                                       -- 'pending'|'transcribing'|'embedding'|'ready'|'failed'
  status_message TEXT,
  workflow_id    TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_recordings_created ON recordings(created_at DESC);
CREATE INDEX idx_recordings_status  ON recordings(status);

-- pdfs: same shape as recordings, content_text replaces transcript
CREATE TABLE pdfs (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  title          TEXT,
  source_url     TEXT,                 -- if pulled from a web URL
  size_bytes     INTEGER NOT NULL,
  page_count     INTEGER,
  r2_key         TEXT NOT NULL,        -- 'pdfs/<id>.pdf'
  text_content   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  workflow_id    TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX idx_pdfs_created ON pdfs(created_at DESC);
CREATE INDEX idx_pdfs_status  ON pdfs(status);
```

**R2 layout:**

- `recordings/<id>.<mp4|mov>`
- `pdfs/<id>.pdf`

**Vectorize:**

- Single index `sidebar-search`.
- Dimensions: **768**, using `@cf/baai/bge-base-en-v1.5` (smaller, cheaper, sufficient quality for personal search).
- Vector id: `${type}:${resourceId}:${chunkIndex}` — e.g. `recording:01HV...:3`. Deterministic from `(type, id, chunk_count)`, so DELETE iterates `0..chunk_count-1` to remove without a side-index.
- Metadata per vector: `{ type, id, chunkIndex, createdAt, title, snippet }` where `snippet` is the first ~200 chars of the chunk for display in search results.

## 5. API surface

Routes mounted under `/api`. All routes (except `/api/health`) require `X-Sidebar-Token`. Standard JSON in/out. Errors as `{ error: { code, message } }`.

### 5.1 Health and search

- `GET  /api/health` — `{ ok: true, version, deployedAt }`. No auth.
- `POST /api/search` — `{ query: string, types?: string[], limit?: number = 20 }` → `{ results: [{ type, id, score, title, snippet, createdAt }] }`. Embeds the query via `@cf/baai/bge-base-en-v1.5` and runs `VECTORS.query()` with `topK = limit`. If `types` is provided, post-filters results.

### 5.2 Conversations (replaces cloudos-notes)

- `POST   /api/conversations` — `{ id?, backend, title, content_text, started_at, message_count }`. If `id` is provided and exists, equivalent to PUT. Returns `{ id }`.
- `GET    /api/conversations?backend=&limit=&before=` — list, paginated by `updated_at`.
- `GET    /api/conversations/:id` — full row.
- `PUT    /api/conversations/:id` — update title/content_text/message_count. Re-embeds.
- `DELETE /api/conversations/:id` — also removes vectors `conversation:<id>:*`.

### 5.3 Links

- `POST   /api/links` — `{ id?, url, title, description?, tags?, favicon?, source? }`. URL is unique; upsert by URL.
- `GET    /api/links?tag=&limit=&before=`
- `GET    /api/links/:id`
- `PUT    /api/links/:id`
- `DELETE /api/links/:id`

### 5.4 Bookmarks (snapshot push)

- `POST /api/bookmarks/snapshot` — `{ bookmarks: StoredBookmark[], pulledAt }`. Server-side diff:
  - upsert all rows from the payload (by `id`),
  - delete any existing rows whose `id` is missing from the payload (and their vectors),
  - re-embed inline (no Workflow) only rows whose `title` or `url` changed. Bookmarks are small enough that batching ~50 embeds per request stays well inside the request budget.
- `GET  /api/bookmarks?category=&favorite=`
- `GET  /api/bookmarks/:id`

No DELETE; mutations happen only via snapshot push.

### 5.5 Recordings

- `POST   /api/recordings` — `multipart/form-data`:
  - `file`: the blob,
  - `metadata`: JSON `{ id, filename, mime_type, duration_ms, source, origin_url? }`.

  Worker streams the file to R2 (`R2.put` for ≤100 MB; `createMultipartUpload` for larger). Inserts D1 row `status='pending'`. Calls `env.INGEST.create({ params: { type: 'recording', id } })` and stores the workflow id. Returns `{ id, status: 'pending', workflowId }`.
- `GET    /api/recordings` — list.
- `GET    /api/recordings/:id` — metadata.
- `GET    /api/recordings/:id/blob` — streams R2 object with `Content-Disposition: inline` so it plays in a `<video>` tag. The web UI uses this directly.
- `DELETE /api/recordings/:id` — removes R2 object + D1 row + vectors `recording:<id>:*`.

### 5.6 PDFs

Same shape as recordings:

- `POST   /api/pdfs` — multipart with `{ id, filename, title?, source_url? }`.
- `GET    /api/pdfs`
- `GET    /api/pdfs/:id`
- `GET    /api/pdfs/:id/blob` — streams R2 object, `Content-Type: application/pdf`, `Content-Disposition: inline`.
- `DELETE /api/pdfs/:id`

### 5.7 Errors

| HTTP | Code | When |
|---|---|---|
| 400 | `bad_request` | Schema validation fail |
| 401 | `unauthorized` | Missing/invalid `X-Sidebar-Token` |
| 404 | `not_found` | Row or blob missing |
| 409 | `conflict` | Unique constraint (`links.url`) |
| 413 | `too_large` | File > configured R2 limit |
| 500 | `internal` | Anything else; logged with request id |

## 6. Ingest Workflow

`worker/src/workflows/ingest.ts` is a `WorkflowEntrypoint` with one method.

```
INGEST.create({ params: { type: 'recording' | 'pdf', id } })
```

Steps (`step.do`, each retried with exponential backoff up to 5 attempts):

1. **Load row** — read D1 row by `id`. Fail if `status='ready'` (idempotency).
2. **Verify R2 object** — `HEAD` on `r2_key`. 404 here means upload never completed; mark `failed`.
3. **Extract content**:
   - Recording → fetch the R2 stream, call `env.AI.run("@cf/openai/whisper", { audio: <Uint8Array> }, { gateway: { id: "x" } })`. Result: `{ text, segments }`. Persist `transcript` in D1 immediately.
   - PDF → use `pdfjs-dist` to extract the text layer per page. If extracted text length < ~50 chars, fall back to OCR: render each page to a PNG and call `@cf/llava-hf/llava-1.5-7b-hf` via the gateway with an "extract text from this image" prompt. Persist `text_content`.
4. **Chunk text** — split into ~500-token windows with 50-token overlap (`@/lib/chunk.ts`).
5. **Embed chunks** — for each chunk: `env.AI.run("@cf/baai/bge-base-en-v1.5", { text: chunk }, { gateway: { id: "x" } })`. Batched 10 per `env.AI.run` call (Workers AI supports array input).
6. **Upsert vectors** — `VECTORS.upsert([{ id, values, metadata }])`.
7. **Mark ready** — `UPDATE ... SET status='ready', updated_at=?`.

Failure handling: any step that fails after retries writes `status='failed'`, `status_message=<err>`. The web UI shows failed rows with a "Retry ingest" button that hits `POST /api/recordings/:id/reingest` → `INGEST.create()`.

## 7. Auth

Single shared secret stored as the Worker secret `SIDEBAR_TOKEN`. Middleware (Hono):

```ts
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/health") return next()
  const t = c.req.header("x-sidebar-token") ?? ""
  if (!timingSafeEqual(t, c.env.SIDEBAR_TOKEN)) return c.json({ error: { code: "unauthorized", message: "bad token" } }, 401)
  await next()
})
```

`timingSafeEqual` uses `crypto.subtle.timingSafeEqual` (Workers runtime polyfill) or a constant-time string compare via `crypto.subtle.digest`.

The SPA uses the same token: on first visit, prompts the user, stores in `localStorage`, sends as `X-Sidebar-Token` on every fetch. No login backend; no token rotation in v1.

## 8. Web UI (lightweight)

`worker/web/` — Vite + React 18 + Tailwind + TanStack Router. Built to `worker/dist/web/` and served by the Worker via the `ASSETS` binding with `not_found_handling = "single-page-application"` so client-side routes resolve.

### 8.1 Pages

| Path | View |
|---|---|
| `/` | Redirect to `/search` |
| `/search` | Search box + grouped results (Conversations / Links / Bookmarks / Recordings / PDFs). Hits `POST /api/search`. |
| `/conversations` | Reverse-chrono list grouped by backend. |
| `/conversations/:id` | Plain-text transcript view, copy button. |
| `/links` | List with favicon + tags; click opens the URL in a new tab. |
| `/bookmarks` | Folder-tree view using `path[]`; click opens the URL. |
| `/recordings` | Grid of recording cards (filename, duration, size, status); click → `/recordings/:id`. |
| `/recordings/:id` | `<video src="/api/recordings/:id/blob" controls />` + transcript panel. |
| `/pdfs` | List of PDFs; click → `/pdfs/:id`. |
| `/pdfs/:id` | Browser-native `<embed type="application/pdf" src=".../blob" />` + extracted text. |

### 8.2 Token gate

`worker/web/src/auth.ts` — a tiny gate component:

- On mount, read `sidebar_token` from `localStorage`.
- If absent or empty: render a single-input login form. On submit, fetch `/api/health` with the entered token; if 200, store and continue.
- Wraps the router so no page ever renders without a token.

### 8.3 Build/serve

`wrangler.toml` snippet:

```toml
[assets]
directory = "./dist/web"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

`pnpm build` in `worker/` runs:

1. `vite build` in `worker/web/` → `worker/dist/web/`
2. `wrangler deploy` (or `wrangler build` in CI)

## 9. Client (extension) integration

### 9.1 New module: `src/lib/sidebar-api.ts`

Typed client with `client.conversations.*`, `client.links.*`, `client.bookmarks.*`, `client.recordings.*`, `client.pdfs.*`, `client.search()`. Reads `sidebarApiUrl` and `sidebarApiToken` from settings.

### 9.2 Settings migration

In `src/types.ts`:

- Rename `cloudosSyncEnabled` → `sidebarSyncEnabled`,
  `cloudosNotesUrl` → `sidebarApiUrl`,
  `cloudosServiceToken` → `sidebarApiToken`,
  `cloudosPruneAfterSync` → `sidebarPruneAfterSync`.
- One-shot migration in `src/storage.ts` reads old keys if present and writes new keys with marker `migration:cloudos-to-sidebar=1`. Old keys deleted on success.
- `DEFAULT_SETTINGS.sidebarApiUrl = "https://sidebar.pdx.software"` (no path; client appends `/api/...`).

### 9.3 Sync hooks

| Source | Trigger | Hook |
|---|---|---|
| Chat messages | Existing debounce in current hook | `src/hooks/useSidebarSync.ts` (renamed `useCloudosSync.ts`, URL retargeted, payload changed to `POST /api/conversations` shape) |
| Recorder save | `recorder.ts` `onstop` → upload | `src/background/recorder-tools.ts` extended to upload after the file is saved locally |
| Bookmarks | `chrome.bookmarks.onCreated/Removed/Changed` + on extension startup | New `src/background/bookmark-sync.ts`, debounced 5s, calls `POST /api/bookmarks/snapshot` |
| Collected links (lx) | `setLinks()` in `src/sections/_lx/storage.ts` | Wrapped to also `POST /api/links` for each new/changed link |
| PDFs | Net new — context menu on PDF tabs + URL pattern interception (`*.pdf`) | New `src/background/pdf-capture.ts`, downloads via fetch then uploads |

### 9.4 Backward-compat shim

For one release: if `sidebarApiUrl` is empty but `cloudosNotesUrl` is set, the client falls back to the old URL (read-only — only `useCloudosSync` continues to work). After that release the shim is removed.

## 10. Repo layout

```
ai-dev-sidebar/
├── src/                          # existing extension (unchanged structure)
├── worker/                       # new
│   ├── package.json              # Hono, drizzle-orm (optional), vitest, wrangler
│   ├── tsconfig.json
│   ├── wrangler.toml
│   ├── migrations/
│   │   └── 0001_init.sql
│   ├── src/
│   │   ├── index.ts              # Hono app entry + Workflow re-export
│   │   ├── env.ts                # Env type
│   │   ├── auth.ts
│   │   ├── ai.ts                 # env.AI wrappers (all with { gateway: { id: "x" } })
│   │   ├── db.ts                 # D1 helpers
│   │   ├── r2.ts
│   │   ├── vectors.ts            # chunk + embed + upsert
│   │   ├── chunk.ts
│   │   ├── routes/
│   │   │   ├── conversations.ts
│   │   │   ├── links.ts
│   │   │   ├── bookmarks.ts
│   │   │   ├── recordings.ts
│   │   │   ├── pdfs.ts
│   │   │   └── search.ts
│   │   └── workflows/
│   │       └── ingest.ts
│   ├── tests/                    # vitest with @cloudflare/vitest-pool-workers
│   │   ├── auth.test.ts
│   │   ├── routes/
│   │   │   ├── conversations.test.ts
│   │   │   ├── links.test.ts
│   │   │   ├── bookmarks.test.ts
│   │   │   ├── recordings.test.ts
│   │   │   ├── pdfs.test.ts
│   │   │   └── search.test.ts
│   │   └── workflows/
│   │       └── ingest.test.ts
│   ├── scripts/
│   │   └── migrate-notes.mjs     # optional one-off importer
│   └── web/
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── api.ts
│           ├── auth.tsx
│           ├── pages/
│           │   ├── Search.tsx
│           │   ├── Conversations.tsx
│           │   ├── ConversationDetail.tsx
│           │   ├── Links.tsx
│           │   ├── Bookmarks.tsx
│           │   ├── Recordings.tsx
│           │   ├── RecordingDetail.tsx
│           │   ├── Pdfs.tsx
│           │   └── PdfDetail.tsx
│           └── components/
└── ...
```

The extension's existing `src/` doesn't depend on `worker/`, so the extension build is unaffected by Worker code.

## 11. Testing strategy

**Worker:**

- `@cloudflare/vitest-pool-workers` for unit tests with real D1/R2/Vectorize via miniflare. One test file per route. Workflow tested via the SDK's `WORKFLOW_FAKE` style harness.
- Per route: 200 happy path, 401 missing token, 404 not found, schema-validation 400, and one round-trip showing that a created row is searchable via `/api/search` (Vectorize stub returns deterministic top-k).
- Workflow: each `step.do` tested in isolation by stubbing the prior step's output.

**Extension client:**

- `tests/sidebar-api.test.ts` — typed-client serialization, error mapping.
- `tests/sidebar-sync.test.ts` — debounce + session boundary logic (port the existing `useCloudosSync` tests; they should mostly still apply).
- `tests/bookmark-sync.test.ts` — diff logic for snapshot push.

**Web UI:**

- `worker/web/tests/auth-gate.test.tsx` — token gate happy path + bad-token path.
- One Playwright smoke (`tests/e2e/web-search.spec.ts`) that loads `/` against `wrangler dev`, sets a token, runs a search, asserts at least one result card renders.

## 12. Migration plan

1. Land the Worker (`worker/` skeleton, Hono app, auth, no integrations yet). Deploy to `sidebar.pdx.software`. Verify `GET /api/health` works with the token.
2. Land D1 schema (`0001_init.sql`) and CRUD routes for `conversations` + `links` first (simplest, no R2/Workflow).
3. Land Vectorize bindings + `/api/search`. Backfill on every POST.
4. Land R2 + recordings/PDFs upload routes with `status='pending'`. No ingest yet; rows are uploadable and listable but `transcript`/`text_content` stays empty.
5. Land the Workflow; recordings/PDFs become searchable as ingest completes. Re-trigger ingest for existing pending rows via `POST /api/{type}/:id/reingest`.
6. Land the SPA pages (`/search`, then `/conversations`, then the rest).
7. Land extension-side changes section by section: conversations (cutover from notes.pdx.software), then bookmarks, then links, then recordings, then PDFs.
8. Once all sections are using the new Worker, remove the backward-compat fallback to `cloudosNotesUrl`.

Per-step PRs; each step is independently deployable.

## 13. Deployment + ops

- Worker name: `sidebar-api`.
- Domain: `sidebar.pdx.software` (route + custom domain). Fallback `sidebar-api.<account>.workers.dev` for first deploy.
- Secrets via `wrangler secret put SIDEBAR_TOKEN`. Stored in 1Password / your secrets manager; not committed.
- D1 created via `wrangler d1 create sidebar`, migrations run via `wrangler d1 migrations apply sidebar`.
- R2 bucket `sidebar-blobs` created via dashboard or `wrangler r2 bucket create`.
- Vectorize index via `wrangler vectorize create sidebar-search --dimensions=768 --metric=cosine`.
- AI Gateway id `x` (already exists in the account per CLAUDE.md).
- Observability: Workers default logs; AI Gateway dashboard for AI call cost/latency.

## 14. Open items (resolved by defaults; flag if you want different)

- **Domain**: `sidebar.pdx.software` is a placeholder. If you'd rather host elsewhere, change `wrangler.toml` `routes`.
- **PDF capture trigger in the extension**: design uses (a) a right-click context-menu entry on PDF tabs + (b) interception of downloads ending in `.pdf` with a "save to backend" prompt. Both gated behind a new `pdfCaptureEnabled` setting that defaults off until you've tried it.
- **Recording transcript model**: `@cf/openai/whisper` (Workers AI catalog). If you'd prefer a higher-quality model later we can swap in a Groq/OpenAI route through the gateway.
- **OCR fallback model**: `@cf/llava-hf/llava-1.5-7b-hf`. Cheap and good enough for PDFs; replaceable.

## 15. Out of scope (deliberately)

- Mobile/native app for the web UI — it's responsive enough; install as PWA if desired.
- Sharing items publicly via signed URLs — single-user, no public surfaces.
- Background re-embedding when models change — manual reingest endpoint only.
- Webhooks/push to other services — pull-based search is the only consumer for now.
