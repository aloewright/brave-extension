# copythe-hub — Read-it-later / save-anything library (`hub.copythe.link`)

**Date:** 2026-06-07
**Status:** Design — approved direction, pending spec review
**Owner:** aloe

## 1. Overview

A polished web app for saving and re-reading the things you collect on the
web: **articles (read-it-later), bookmarks/links, images, videos, full
webpages, PDFs, and text highlights**. It is the human-facing reading and
curation surface over the same content store the Brave sidebar extension
already writes to.

The visual design is the provided **"Refined Curation System"** (Stitch
mockups): calm, intellectually-serious, Nunito Sans, soft indigo accent,
off-white / deep-charcoal surfaces, rounded shapes, ambient shadows. Three
reference screens drive the MVP: a **library dashboard** (filter pills + card
grid), a **video library** (player + timestamped notes/highlights), and an
**article reader** (long-form with margin highlights).

Deployed to a Cloudflare Worker at **`hub.copythe.link`**.

## 2. Goals & non-goals

### Goals (MVP)
- Save by **pasting a URL** → server auto-detects and extracts: article (reader
  text + hero image), video (oEmbed/thumbnail), webpage (snapshot), or PDF.
- **Upload** local images and PDFs.
- Browse a **library dashboard**: card grid, type filter pills
  (All / Articles / Images / Videos / Notes / PDFs), sort, search.
- **Read** articles in a distraction-free reader; **watch** videos with a
  notes/highlights side panel; view images and PDFs.
- Create **highlights + notes** (text selection in reader; timestamped notes on
  video) stored via the existing `/api/highlights`.
- **Semantic + keyword search** across everything (existing Vectorize `/api/search`).
- Shares one library with the extension — items saved in either place appear in both.

### Non-goals (MVP)
- No multi-user accounts (single-user; see §4). The auth seam is kept clean so
  accounts can be added later without a frontend rewrite.
- No browser extension changes (the extension already captures; this is read+enrich).
- No social/sharing/collaboration, no mobile native app (responsive web only).
- No offline mode / PWA install in MVP (candidate follow-up).

## 3. Architecture

```
                 Cloudflare Access (Google login, single-user)
                              │  signed JWT
                              ▼
   hub.copythe.link  ── TanStack Start app on a Cloudflare Worker ──┐
     React Router (file routes)        server functions (BFF)        │
     - library / reader / video        - hold SIDEBAR_TOKEN secret   │
     - add / upload UI                 - URL fetch + Readability      │
                                       - proxy to sidebar-api         │
                                              │  X-Sidebar-Token       │
                                              ▼                        │
                       sidebar-api Worker (txt.fly.pm)                 │
                       D1  +  R2  +  Vectorize                         │
                       links · bookmarks · captures · highlights ·     │
                       videos · pdfs · search   ◀── extension writes ──┘
```

**Key decisions**

- **TanStack Start on Cloudflare Workers**, with **Mantine** as the component/
  theming layer (§9). File-based routes for pages; server functions for all
  privileged work. Deployed via the Nitro/wrangler Cloudflare preset. (Exact
  TanStack Start preset + the Mantine SSR/color-scheme setup verified against
  current docs via context7 at implementation time — both areas move fast.)
- **BFF proxy, token never in the browser.** The `SIDEBAR_TOKEN` lives only as a
  Worker secret on the hub. Every sidebar-api call goes through a hub server
  function that injects the header. The browser only ever talks to
  `hub.copythe.link`. This is also the multi-user seam: swap the single shared
  token for per-user sessions later without touching page components.
- **Ingestion/extraction is the hub's responsibility; storage/search stay in
  sidebar-api.** Clean boundary. The hub fetches the URL, runs Mozilla
  Readability over a `linkedom` DOM (both Workers-compatible), classifies the
  content type, then writes a normalized record to sidebar-api. Because storage
  is shared, the extension benefits from anything the hub enriches.
- **Blobs (images/PDF/screenshots)** are served from sidebar-api's existing blob
  routes. The hub proxies them through a server route so the token stays server-side
  and the browser requests same-origin `/blob/:id` URLs.

## 4. Authentication

**Cloudflare Access in front of the whole app**, single-user policy (your Google
account). No password/session code to write. The hub Worker verifies the Access
JWT (`Cf-Access-Jwt-Assertion`) on every request using the existing pattern from
the `agent-app` (`feat(agent-app): Cloudflare Access JWT verification helper`,
`dual-mode Cloudflare Access auth middleware`) — reuse that helper rather than
reinventing it.

- Unauthenticated requests are bounced by Access before reaching app code.
- A local dev bypass mirrors agent-app's "dual-mode" middleware so `pnpm dev`
  works without Access.
- The seam: a single `getCurrentUser()` server util returns the identity. MVP
  ignores it for scoping (one library); multi-user later makes it the row filter.

## 5. Data model

Reuse sidebar-api's D1 tables as-is where possible. One **enrichment** is needed
so articles carry reader content.

### Existing (reused, no change)
- `links` — url, title, tags, timestamps. Backs bookmarks/links + article stubs.
- `captures` — R2-backed screenshots & PDFs with extracted text + Vectorize chunks.
- `highlights` — text + note + source url/title (+ a new optional `anchor` field, see below).
- `videos`, `pdfs` — existing upload/import + ingest workflow.

### New: article reader content
Articles need extracted reader text/HTML + hero image + reading time. Two options
(decision in §11): **(A)** add columns to `links` (`kind`, `reader_text`,
`reader_html`, `hero_url`, `excerpt`, `word_count`, `byline`, `site_name`), or
**(B)** a new `articles` table keyed by the link id. **Recommendation: extend
`links`** with a nullable `kind` discriminator + article fields — fewer joins,
and a "link" and "article" are the same row at different enrichment levels. The
reader text is also pushed to Vectorize (reuse the captures/pdf ingest pattern)
so articles are searchable by body content.

### Highlight anchoring
Add an optional `anchor` JSON column to `highlights`:
- article → `{ type: "text", quote, prefix, suffix }` (text-fragment style re-find).
- video → `{ type: "timestamp", seconds }` (drives the timestamped side panel).
Backward compatible: existing highlights have `anchor = null`.

## 6. sidebar-api changes (kept minimal)

1. **CORS** — allow the `hub.copythe.link` origin on `/api/*` (currently
   token-gated, browser-origin-agnostic). Since the hub calls server-to-server
   through the BFF, CORS is only needed for any direct browser fetch; default to
   **no direct browser calls** so CORS changes stay minimal/none.
2. **Article fields** — migration adding the `links` columns in §5 + reader text
   indexed into Vectorize on write.
3. **`POST /api/ingest`** (new, optional) — accepts `{ url }`, but extraction
   runs in the hub; this endpoint just stores the normalized article/link/video
   record + kicks Vectorize indexing. May be folded into the existing
   `POST /api/links` with an enriched body instead of a new route — decide at
   plan time to avoid endpoint sprawl.
4. **`anchor` column** on `highlights` (migration; `/api/highlights` passes it through).

All changes are additive/backward-compatible; the extension keeps working unchanged.

## 7. Content types & ingestion flows

| Type | Detect | Extract | Store |
|------|--------|---------|-------|
| Article | HTML + Readability succeeds | reader text/HTML, hero img, byline, reading time | `links` (kind=article) + Vectorize |
| Video | oEmbed / known host (YouTube, Vimeo…) | title, thumbnail, embed/oEmbed | `videos` (or `links` kind=video) |
| Webpage | HTML, Readability weak | title + screenshot snapshot | `captures` (screenshot) + `links` |
| PDF (URL) | `content-type: application/pdf` | fetch bytes → existing pdf ingest | `pdfs` |
| Image (URL/upload) | image content-type / file pick | store bytes, thumbnail | `captures` (screenshot kind) |
| PDF (upload) | file pick | existing `POST /api/pdfs` (multipart) | `pdfs` |
| Highlight | user selection in reader/video | quote + note + anchor | `highlights` |

**Add flow:** user pastes URL (or drops a file) in the "Add New" modal → hub
server function fetches/extracts and classifies → writes to sidebar-api →
optimistic card appears in the library; a "processing" state resolves to "ready"
once Vectorize indexing returns (mirror the captures `status` field).

## 8. Routes / screens

File-based routes (TanStack Start):

- `/` — **Library dashboard.** Sidebar (Home / Favorites / Collections /
  Archive), global search bar, filter pills, sort, responsive card grid. Cards
  render by type (image hero, video thumb w/ play badge, article excerpt, note,
  pdf). "Add New" button opens the add modal.
- `/read/:id` — **Article reader.** Centered measure, reader typography, margin
  highlights panel; select-to-highlight with note.
- `/watch/:id` — **Video library/player.** Player + right-hand "Notes &
  Highlights" panel with timestamped entries; add-note-at-timestamp input.
- `/item/:id` — **Generic detail** for image / pdf / webpage snapshot (viewer +
  metadata + highlights/notes where applicable).
- `/search?q=` — results view (reuses card grid).
- `/settings` — sidebar-api URL/token status, theme (light/dark), account (Access identity).

Server functions back each: `listItems`, `getItem`, `ingestUrl`, `uploadFile`,
`createHighlight`, `deleteItem`, `search`, `proxyBlob`.

## 9. Design system

From the Stitch `DESIGN.md` (identical across all three zips):

- **Type:** Nunito Sans throughout. Display 48/800, headline 32/700, body 16–18/400
  at 1.6 line-height, labels 12–14/600–700 with tracking.
- **Color (light):** bg `#f9f9fd`, surface tiers `#ffffff`→`#e2e2e6`, text
  `#1a1c1f` / `#444654`, primary `#2c50cd` (interactive accent; mockup also uses
  soft indigo `#5C7CFA`), outline `#c4c5d6`. **Dark:** charcoal `#121417` canvas,
  `#1A1D21` elevated, soft-white text. Avoid pure black/white.
- **Shape:** base radius 8px; large media 16–24px; search bar + chips fully
  rounded (pill). **Elevation:** diffused low-opacity ambient shadows
  (`0 4px 20px rgba(0,0,0,.04)`), tonal layering over borders; hover lifts cards.
- **Layout:** 280px sidebar, 1280px max content, 48px desktop padding, 12-col
  card grid (3–4 up), single column + bottom nav on mobile.

### Component layer: Mantine
**Mantine is the UI component + theming layer** (not Tailwind — single styling
system to avoid drift). The "Refined Curation System" tokens are mapped into a
**`MantineProvider` theme override** rather than reimplemented:

- `theme.fontFamily` / `headings.fontFamily` → Nunito Sans; `theme.fontSizes` /
  `headings.sizes` → the type scale (display/headline/body/label).
- `theme.colors.brand` → a 10-shade indigo ramp seeded from `#2c50cd` /
  `#5C7CFA`; `theme.primaryColor = 'brand'`. Surface/text/outline tokens →
  CSS variables consumed via Mantine's `--mantine-color-*` overrides.
- `theme.radius` → `{ sm:4, default:8, md:12, lg:16, xl:24 }`; pills via
  `radius="xl"`/`9999`. `theme.shadows` → the diffused ambient shadows.
- **Light/dark** via Mantine's color-scheme + `light-dark()` CSS; charcoal dark
  palette from §9 wired into the Mantine dark scheme.
- Build with Mantine primitives — `AppShell` (sidebar + header), `Card`,
  `Pill`/`Chip` (filter pills), `TextInput`/`Spotlight` (search), `Modal` (add),
  `Tabs`, `Menu`, `SimpleGrid` (card grid), `ScrollArea`, `Skeleton` (loading),
  `Notifications` (toasts). Bespoke pieces (card hover-lift, glass search bar,
  reader margin highlights, video timestamp rail) are CSS Modules layered on top.
- Tokens are transcribed verbatim from `DESIGN.md` front-matter into the theme
  file (`app/styles/theme.ts`) so the source of truth stays the provided system.

## 10. Repository & layout

New standalone repo **`copythe-hub`** (GitHub `aloewright/copythe-hub`), cloned at
`~/Development/copythe-hub`. Not added to the brave-extension repo. Structure
(TanStack Start conventions):

```
copythe-hub/
  app/
    routes/            # file-based routes (§8)
    components/        # cards, sidebar, reader, player, add-modal, ...
    server/            # server functions: bff client, extract, blob proxy, auth
    styles/            # mantine theme (theme.ts) + CSS modules + design tokens
    lib/               # types, classifier, readability wrapper
  wrangler.toml        # hub Worker + Access + SIDEBAR_TOKEN secret
  vite.config.ts
  package.json
```

sidebar-api migrations/route changes (§6) land in the existing brave-extension
`worker/` and ship via its own deploy.

## 11. Open decisions (resolve at plan time)
- Article storage: extend `links` (recommended) vs new `articles` table.
- Ingest endpoint: new `POST /api/ingest` vs enriched `POST /api/links`.
- Video record: dedicated `videos` table vs `links` with `kind=video`.
- Whether webpage snapshots are full-page screenshots (heavier) or readability-fallback text.

## 12. Deployment
- `wrangler deploy` to a hub Worker; custom domain `hub.copythe.link` (needs DNS
  record — `hub.` does not resolve yet) and a Cloudflare Access app/policy over it.
- Secrets: `SIDEBAR_TOKEN` (mirror of sidebar-api's), Access AUD/team domain.
- sidebar-api redeployed once with the additive migrations from §6.

## 13. Testing
- **Unit (vitest):** URL classifier, Readability wrapper (fixture HTML →
  expected reader output), highlight anchor serialize/re-find, BFF token
  injection, blob proxy.
- **Server functions:** mocked sidebar-api responses; assert correct
  endpoints/headers and error propagation (mirror the captures-client test style).
- **Component:** card-type rendering, filter pills, add-modal states
  (idle/processing/error), reader highlight creation.
- **Worker harness:** plain vitest + node:sqlite D1 adapter for any new
  sidebar-api queries (per the project's CF-worker-test-harness note —
  vitest-pool-workers can't init wrapped bindings here).

## 14. Build phases
1. **Scaffold + deploy skeleton** — TanStack Start on CF with Mantine wired up
   (provider, SSR color-scheme, Nunito Sans, theme tokens), Access in front,
   `hub.copythe.link` live with a themed hello page. Proves the deployment path
   + Mantine-SSR-on-Workers early (riskiest parts).
2. **BFF + library read** — server functions proxying `listItems`/`getItem`/
   `search`/`proxyBlob`; dashboard card grid + filter pills + search over
   existing data. (Read-only end-to-end.)
3. **Reader + viewers** — article reader, image/pdf/webpage detail, video player.
4. **Highlights & notes** — selection → `/api/highlights` with anchors; margin
   panel + timestamped video notes.
5. **Ingestion** — add-modal: paste-URL extraction + file upload; sidebar-api
   article migration + Vectorize indexing.
6. **Polish** — dark mode, responsive/mobile nav, empty/error states, a11y pass.

Each phase is independently shippable and reviewable.
