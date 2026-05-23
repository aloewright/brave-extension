# Sidebar Backend — Phase 4: Web UI

> Stacked on Phase 3b (PR #39). Adds a token-gated React SPA at `worker/web/` that the same Worker serves via `[assets]`. View-only on day one.

**Goal:** A browsable UI for everything the backend stores. Hit `https://<worker-host>/`, paste your `X-Sidebar-Token` once, then search and explore conversations / links / bookmarks / recordings (with playback) / PDFs (with browser-native viewer).

**Architecture:**

```
Browser → GET / → Worker [assets] binding → SPA bundle (index.html + JS/CSS)
Browser → GET /api/* → Hono router (existing routes)
Browser → GET /search /conversations/abc → asset 404 → SPA fallback (serve index.html)
```

`run_worker_first = ["/api/*"]` keeps API requests on the Worker. SPA client routes resolve via `not_found_handling = "single-page-application"`.

**Tech Stack:**
- Vite 5 + React 18 + TypeScript
- React Router v6 (lighter than TanStack Router for this scope)
- Tailwind CSS 3 + PostCSS
- Vitest + happy-dom for component tests

**Spec:** `docs/superpowers/specs/2026-05-20-sidebar-backend-worker-design.md` §8.

---

## File structure (new)

```
worker/
├── package.json                 # gains vite + react + tailwind devDeps and a `build:web` script
├── vite.config.web.ts           # separate from the existing vitest.config.ts
├── tsconfig.web.json            # JSX, DOM lib, React types
├── tailwind.config.js
├── postcss.config.js
├── web/
│   ├── index.html               # Vite entry
│   └── src/
│       ├── main.tsx             # React root + router
│       ├── App.tsx              # layout + auth gate + routes
│       ├── auth.tsx             # token gate component + useToken hook
│       ├── api.ts               # typed fetch wrappers
│       ├── styles.css           # Tailwind base + a few custom utility classes
│       ├── components/
│       │   ├── Nav.tsx          # top nav with links to each section
│       │   ├── EmptyState.tsx
│       │   └── ResultCard.tsx
│       └── pages/
│           ├── Search.tsx
│           ├── Conversations.tsx
│           ├── ConversationDetail.tsx
│           ├── Links.tsx
│           ├── Bookmarks.tsx
│           ├── Recordings.tsx
│           ├── RecordingDetail.tsx
│           ├── Pdfs.tsx
│           └── PdfDetail.tsx
└── tests/web/
    ├── auth.test.tsx            # token gate happy path + bad token + reset
    └── api.test.ts              # client sends X-Sidebar-Token, parses JSON, surfaces errors
```

Build outputs to `worker/dist/web/`. The existing `worker/dist/` for wrangler build artifacts stays separate (`dist/web/` is the asset directory).

## Tasks

### Task 1 — Scaffold Vite + React + Tailwind

- Add dev deps: `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `@types/react`, `@types/react-dom`, `react-router-dom`, `tailwindcss`, `postcss`, `autoprefixer`, `happy-dom`, `@testing-library/react`, `@testing-library/jest-dom`.
- Create the Vite config, two tsconfigs (existing `tsconfig.json` for the Worker stays unchanged), Tailwind/PostCSS configs, `web/index.html`, `web/src/main.tsx`, `web/src/App.tsx` shell with `<BrowserRouter>` and a placeholder route.
- Add `pnpm build:web` script (vite build → `dist/web/`) and update `pnpm build` to run vite then wrangler deploy.
- Verify `pnpm build:web` succeeds and `dist/web/index.html` is present.

Commit: `feat(web): scaffold Vite + React + Tailwind SPA at worker/web/`.

### Task 2 — Token gate + API client

- `web/src/auth.tsx` — exports `<TokenGate />` and `useToken()`. Reads `sidebar_token` from `localStorage`. Renders a one-input login form when missing. Verifies the token by `GET /api/health` *with* the token; if 200, stores and continues. (Health is unauthenticated but our client still sends the header so this is just smoke-testing the URL.) Adds a "reset token" button in the corner for logout.
- `web/src/api.ts` — typed `apiClient(token)` with methods for `search`, `conversations.list/get`, `links.list`, `bookmarks.list/get`, `recordings.list/get`, `pdfs.list/get`. Each call sets `X-Sidebar-Token` and parses JSON; throws `ApiError` with the `error.code` / `error.message` shape used by the Worker.

Tests (Task 5):
- `tests/web/auth.test.tsx` — renders the gate without a token → login form; submit valid token → calls fetch with X-Sidebar-Token → state advances to the wrapped children.
- `tests/web/api.test.ts` — happy paths for each method; 401 surfaces `ApiError.code="unauthorized"`.

Commit: `feat(web): token gate + typed API client`.

### Task 3 — Pages

Routes:

| Path | Component |
|---|---|
| `/` | redirect to `/search` |
| `/search` | search bar + grouped results |
| `/conversations` | reverse-chrono list grouped by backend |
| `/conversations/:id` | plain-text transcript, copy-all button |
| `/links` | list with favicon + tags |
| `/bookmarks` | folder-grouped list using `path` |
| `/recordings` | grid of cards with filename + size + duration + status |
| `/recordings/:id` | `<video src="/api/recordings/:id/blob" controls>` + transcript panel |
| `/pdfs` | list |
| `/pdfs/:id` | `<embed src="/api/pdfs/:id/blob" type="application/pdf">` + extracted text |

Layout:
- `<Nav />` across the top (current section highlighted).
- Sticky search box on every page; submitting redirects to `/search?q=...`.
- "Status" badge for recordings/PDFs (pending / transcribing / extracting / embedding / ready / failed).
- Keyboard: `/` focuses the search box.

Empty-state component for when a list returns `[]`.

Commit: `feat(web): pages — search + lists + detail views`.

### Task 4 — Wire `[assets]` + build pipeline

`worker/wrangler.toml` gets an `[assets]` block:

```toml
[assets]
directory = "./dist/web"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]
```

`Env` gains optional `ASSETS: Fetcher`. The existing 404 JSON fallback in `src/index.ts` stays for `/api/*` routes; SPA paths are handled by the assets binding before they reach Hono.

CI: extend the `worker` job to install + build the SPA (`pnpm build:web`) as part of the typecheck step so we catch SPA breakage. (Doesn't run wrangler deploy in CI.)

Commit: `feat(worker): serve SPA via [assets] block + wire build pipeline`.

### Task 5 — Tests + open PR

- Vitest config gains a `tests/web/` glob so the React tests run alongside the worker tests under the same `pnpm test` command. happy-dom environment for the JSX files.
- Open PR stacked on Phase 3b, base = `worktree-sidebar-backend-phase-3b`.

## Out of scope (deliberate)

- Write actions (edit/delete) from the UI — read-only in this phase.
- Cloudflare Access SSO — token-from-localStorage covers the single-user requirement.
- PWA install / offline cache — defer to a possible Phase 6.
- Per-section virtualization or pagination UI — datasets are personal-scale; simple lists are fine.
- Streaming uploads from the UI — uploads still happen via the extension.

## Done criteria

- `pnpm typecheck` and `pnpm test` green for both worker and web.
- `pnpm build:web` produces `dist/web/index.html` + assets.
- `pnpm exec wrangler deploy --dry-run` bundles with bindings `DB / VECTORS / BLOBS / AI / INGEST / ASSETS`.
- After deploy: visiting the Worker URL in a browser shows the login form, accepts a token, lands on `/search`, and can browse all five resource types.
