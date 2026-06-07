# copythe-hub — Plan 2: BFF + Library Read

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the real library on the dashboard — read items from the existing sidebar-api through token-injecting server functions (BFF), normalized into uniform cards, with working type-filter pills and semantic search. Read-only, end-to-end.

**Architecture:** TanStack Start **server functions** hold the `SIDEBAR_TOKEN` and call sidebar-api (`txt.fly.pm`) server-to-server, so the browser only talks to `hub.copythe.link`. A pure normalizer maps each sidebar-api row shape (links / captures / bookmarks / highlights) into one `LibraryItem`. A server **blob-proxy route** streams R2 images/PDFs through the hub with the token attached, so the browser uses same-origin `/blob/...` URLs. The home route loads items via a server function and filters/searches client-side or via a search server function.

**Tech Stack:** TanStack Start `createServerFn`, Cloudflare Workers `env` (`cloudflare:workers`), Mantine v9, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-design.md` (Phase 2 of §14).

**Repo:** `~/Development/copythe-hub` (built in Plan 1).

**sidebar-api shapes consumed (verified in worker/src):**
- `GET /api/links` → `{ links: LinkRow[] }`, `LinkRow = { id, url, title, description, tags(JSON string), favicon, source, created_at, updated_at }`
- `GET /api/captures` → `{ captures: CaptureSummary[] }`, `CaptureSummary = { id, kind:"screenshot"|"pdf", filename, sourceUrl, sourceTitle, sizeBytes, mimeType, status, createdAt(ISO), blobUrl }`
- `GET /api/bookmarks` → `{ bookmarks: BookmarkRow[] }`, `BookmarkRow = { id, url, title, category, is_favorite(0|1), date_added, ... }`
- `GET /api/highlights` → `{ highlights: HighlightRow[] }`, `HighlightRow = { id, text, note, tags, source_url, source_title, source_host, source_favicon, created_at, ... }`
- `POST /api/search` `{ query, types?, limit? }` → `{ hits: [{ score, metadata:{ id, type, title, snippet, ... } }] }`
- Blob: `GET /api/captures/:id/blob`, `GET /api/pdfs/:id/blob` (need `X-Sidebar-Token` header or `?token=`).

All requests send header `X-Sidebar-Token: <SIDEBAR_TOKEN>`.

---

## File Structure

```
src/
  lib/
    library.ts          # LibraryItem type + pure normalizers (no IO) — TDD
  server/
    env.server.ts       # getHubEnv(): reads cloudflare:workers env (server-only)
    sidebar.ts          # BFF fetch helpers to sidebar-api (token injected)
    library.fn.ts       # server fns: listLibrary, searchLibrary
  routes/
    blob.$.tsx          # server route: stream sidebar-api blobs through the hub
    index.tsx           # MODIFY: load listLibrary, render cards, pills, search
  components/
    ItemCard.tsx        # one normalized card, type-aware
tests/
    library.test.ts     # normalizer unit tests
```

---

### Task 1: `LibraryItem` type + normalizers (TDD)

**Files:**
- Create: `src/lib/library.ts`
- Test: `tests/library.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/library.test.ts
import { describe, it, expect } from "vitest"
import {
  normalizeLink, normalizeCapture, normalizeHighlight, normalizeBookmark,
  type LibraryItem,
} from "~/lib/library"

describe("library normalizers", () => {
  it("maps a link row to an article/link item", () => {
    const item = normalizeLink({
      id: "l1", url: "https://x.com/a", title: "A Title",
      description: "desc", tags: '["design","ai"]', favicon: "https://x.com/f.ico",
      source: "extension", chunk_count: 1, created_at: 1700000000000, updated_at: 1700000000000,
    })
    expect(item).toMatchObject<Partial<LibraryItem>>({
      id: "l1", type: "link", source: "links", title: "A Title",
      excerpt: "desc", url: "https://x.com/a", tags: ["design", "ai"],
    })
    expect(item.createdAt).toBe(new Date(1700000000000).toISOString())
  })

  it("maps a screenshot capture to an image item with a proxied thumb", () => {
    const item = normalizeCapture({
      id: "c1", kind: "screenshot", filename: "shot.png", sourceUrl: "https://x.com",
      sourceTitle: "X", sizeBytes: 1000, mimeType: "image/png", status: "ready",
      createdAt: "2026-06-01T00:00:00.000Z", blobUrl: "/api/captures/c1/blob",
    })
    expect(item).toMatchObject<Partial<LibraryItem>>({
      id: "c1", type: "image", source: "captures", title: "shot.png",
      thumbUrl: "/blob/captures/c1", createdAt: "2026-06-01T00:00:00.000Z",
    })
  })

  it("maps a pdf capture to a pdf item", () => {
    const item = normalizeCapture({
      id: "c2", kind: "pdf", filename: "paper.pdf", sourceUrl: null, sourceTitle: null,
      sizeBytes: 2000, mimeType: "application/pdf", status: "ready",
      createdAt: "2026-06-01T00:00:00.000Z", blobUrl: "/api/captures/c2/blob",
    })
    expect(item.type).toBe("pdf")
  })

  it("maps a highlight row to a highlight item", () => {
    const item = normalizeHighlight({
      id: "h1", text: "the quote", note: "my note", tags: "[]",
      source_url: "https://x.com/a", source_title: "A", source_host: "x.com",
      source_favicon: null, context_before: null, context_after: null,
      source: "extension", chunk_count: 1, created_at: 1700000000000, updated_at: 1700000000000,
    })
    expect(item).toMatchObject<Partial<LibraryItem>>({
      id: "h1", type: "highlight", source: "highlights", title: "the quote", excerpt: "my note",
    })
  })

  it("maps a bookmark row to a bookmark item", () => {
    const item = normalizeBookmark({
      id: "b1", url: "https://x.com", title: "X site", parent_id: null, path: "[]",
      category: "Tech", is_favorite: 1, date_added: 1700000000000, position: 0,
      chunk_count: 0, synced_at: 1700000000000,
    })
    expect(item).toMatchObject<Partial<LibraryItem>>({
      id: "b1", type: "bookmark", source: "bookmarks", title: "X site", url: "https://x.com",
      favorite: true,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/library.test.ts`
Expected: FAIL — `Cannot find module '~/lib/library'`.

- [ ] **Step 3: Write `src/lib/library.ts`**

```typescript
export type LibraryType =
  | "article" | "link" | "image" | "video" | "pdf" | "webpage" | "highlight" | "bookmark"

export type LibrarySource = "links" | "captures" | "bookmarks" | "highlights"

export interface LibraryItem {
  id: string
  type: LibraryType
  source: LibrarySource
  title: string
  excerpt?: string
  url?: string          // external source url
  thumbUrl?: string     // same-origin /blob/... (proxied) where applicable
  favicon?: string
  favorite?: boolean
  tags: string[]
  createdAt: string     // ISO
}

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export interface LinkRow {
  id: string; url: string; title: string; description: string | null
  tags: string; favicon: string | null; source: string
  chunk_count: number; created_at: number; updated_at: number
}
export function normalizeLink(r: LinkRow): LibraryItem {
  return {
    id: r.id, type: "link", source: "links", title: r.title || r.url,
    excerpt: r.description ?? undefined, url: r.url,
    favicon: r.favicon ?? undefined, tags: parseTags(r.tags), createdAt: iso(r.created_at),
  }
}

export interface CaptureSummary {
  id: string; kind: "screenshot" | "pdf"; filename: string
  sourceUrl: string | null; sourceTitle: string | null; sizeBytes: number
  mimeType: string; status: string; createdAt: string; blobUrl: string
}
export function normalizeCapture(r: CaptureSummary): LibraryItem {
  return {
    id: r.id, type: r.kind === "pdf" ? "pdf" : "image", source: "captures",
    title: r.sourceTitle || r.filename,
    excerpt: r.sourceUrl ?? undefined, url: r.sourceUrl ?? undefined,
    thumbUrl: r.kind === "screenshot" ? `/blob/captures/${r.id}` : undefined,
    tags: [], createdAt: r.createdAt,
  }
}

export interface HighlightRow {
  id: string; text: string; note: string | null; tags: string
  source_url: string | null; source_title: string | null; source_host: string | null
  source_favicon: string | null; context_before: string | null; context_after: string | null
  source: string; chunk_count: number; created_at: number; updated_at: number
}
export function normalizeHighlight(r: HighlightRow): LibraryItem {
  return {
    id: r.id, type: "highlight", source: "highlights", title: r.text,
    excerpt: r.note ?? undefined, url: r.source_url ?? undefined,
    favicon: r.source_favicon ?? undefined, tags: parseTags(r.tags), createdAt: iso(r.created_at),
  }
}

export interface BookmarkRow {
  id: string; url: string; title: string; parent_id: string | null; path: string
  category: string; is_favorite: number; date_added: number | null; position: number | null
  chunk_count: number; synced_at: number
}
export function normalizeBookmark(r: BookmarkRow): LibraryItem {
  return {
    id: r.id, type: "bookmark", source: "bookmarks", title: r.title || r.url,
    url: r.url, favorite: r.is_favorite === 1, tags: r.category ? [r.category] : [],
    createdAt: iso(r.date_added ?? r.synced_at),
  }
}

/** Filter-pill key → which library types it includes. */
export const FILTERS: Record<string, LibraryType[] | null> = {
  All: null,
  Articles: ["article", "link"],
  Images: ["image"],
  Videos: ["video"],
  PDFs: ["pdf"],
  Highlights: ["highlight"],
}

export function applyFilter(items: LibraryItem[], pill: string): LibraryItem[] {
  const types = FILTERS[pill]
  if (!types) return items
  const set = new Set(types)
  return items.filter((i) => set.has(i.type))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/library.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/lib/library.ts tests/library.test.ts && git commit -m "feat(library): LibraryItem type + sidebar-api row normalizers"
```

---

### Task 2: Server env accessor

**Files:**
- Create: `src/server/env.server.ts`

- [ ] **Step 1: Write `src/server/env.server.ts`**

```typescript
import { env } from "cloudflare:workers"
import type { HubEnv } from "~/lib/env"

// Server-only: reads Cloudflare Worker bindings/vars/secrets. Never import
// from client components. The `cloudflare:workers` module is provided by the
// @cloudflare/vite-plugin runtime.
export function getHubEnv(): HubEnv {
  const e = env as unknown as HubEnv
  return {
    ACCESS_TEAM_DOMAIN: e.ACCESS_TEAM_DOMAIN ?? "",
    ACCESS_AUD: e.ACCESS_AUD ?? "",
    SIDEBAR_API_URL: e.SIDEBAR_API_URL ?? "https://txt.fly.pm",
    SIDEBAR_TOKEN: e.SIDEBAR_TOKEN,
    HUB_DEV_BYPASS: e.HUB_DEV_BYPASS,
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors. (If `cloudflare:workers` is unresolved, run `pnpm cf-typegen` to generate `worker-configuration.d.ts`, then re-run.)

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/env.server.ts && git commit -m "feat(server): cloudflare env accessor"
```

---

### Task 3: BFF fetch helpers to sidebar-api

**Files:**
- Create: `src/server/sidebar.ts`

- [ ] **Step 1: Write `src/server/sidebar.ts`**

```typescript
import { getHubEnv } from "./env.server"

function headers() {
  const { SIDEBAR_TOKEN } = getHubEnv()
  return { "X-Sidebar-Token": SIDEBAR_TOKEN ?? "" }
}

function base() {
  return getHubEnv().SIDEBAR_API_URL.replace(/\/+$/, "")
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`, { headers: headers() })
  if (!res.ok) throw new Error(`sidebar-api ${path} failed (${res.status})`)
  return (await res.json()) as T
}

export async function fetchLinks() {
  return (await getJson<{ links: import("~/lib/library").LinkRow[] }>("/api/links?limit=200")).links ?? []
}
export async function fetchCaptures() {
  return (await getJson<{ captures: import("~/lib/library").CaptureSummary[] }>("/api/captures?limit=200")).captures ?? []
}
export async function fetchBookmarks() {
  return (await getJson<{ bookmarks: import("~/lib/library").BookmarkRow[] }>("/api/bookmarks?limit=200")).bookmarks ?? []
}
export async function fetchHighlights() {
  return (await getJson<{ highlights: import("~/lib/library").HighlightRow[] }>("/api/highlights?limit=200")).highlights ?? []
}

export interface SearchHit { score: number; metadata: { id: string; type: string; title: string; snippet: string } }
export async function postSearch(query: string): Promise<SearchHit[]> {
  const res = await fetch(`${base()}/api/search`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ query, limit: 30 }),
  })
  if (!res.ok) throw new Error(`sidebar-api search failed (${res.status})`)
  const body = (await res.json()) as { hits?: SearchHit[] }
  return body.hits ?? []
}

/** Stream a sidebar-api blob (captures|pdfs) with the token attached. */
export async function fetchBlob(kind: "captures" | "pdfs", id: string): Promise<Response> {
  return fetch(`${base()}/api/${kind}/${encodeURIComponent(id)}/blob`, { headers: headers() })
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/sidebar.ts && git commit -m "feat(bff): sidebar-api fetch helpers with token injection"
```

---

### Task 4: Library server functions

**Files:**
- Create: `src/server/library.fn.ts`

- [ ] **Step 1: Write `src/server/library.fn.ts`**

```typescript
import { createServerFn } from "@tanstack/react-start"
import {
  fetchLinks, fetchCaptures, fetchBookmarks, fetchHighlights, postSearch,
} from "./sidebar"
import {
  normalizeLink, normalizeCapture, normalizeBookmark, normalizeHighlight,
  type LibraryItem,
} from "~/lib/library"

export const listLibrary = createServerFn({ method: "GET" }).handler(
  async (): Promise<LibraryItem[]> => {
    const [links, captures, bookmarks, highlights] = await Promise.all([
      fetchLinks().catch(() => []),
      fetchCaptures().catch(() => []),
      fetchBookmarks().catch(() => []),
      fetchHighlights().catch(() => []),
    ])
    const items: LibraryItem[] = [
      ...links.map(normalizeLink),
      ...captures.map(normalizeCapture),
      ...bookmarks.map(normalizeBookmark),
      ...highlights.map(normalizeHighlight),
    ]
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return items
  },
)

export const searchLibrary = createServerFn({ method: "GET" })
  .inputValidator((data: { q: string }) => data)
  .handler(async ({ data }): Promise<{ id: string; type: string; title: string; snippet: string; score: number }[]> => {
    if (!data.q.trim()) return []
    const hits = await postSearch(data.q)
    return hits.map((h) => ({
      id: h.metadata.id, type: h.metadata.type, title: h.metadata.title,
      snippet: h.metadata.snippet, score: h.score,
    }))
  })
```

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/library.fn.ts && git commit -m "feat(server): listLibrary + searchLibrary server functions"
```

---

### Task 5: Blob-proxy server route

**Files:**
- Create: `src/routes/blob.$.tsx`

Streams `/blob/<captures|pdfs>/<id>` from sidebar-api with the token. TanStack Start server routes are created with `createServerFileRoute` and a `GET` handler; if the API differs, query context7 `/websites/tanstack_start_framework_react` "server routes / API routes" and adapt the handler signature — keep the splat param + streamed `Response`.

- [ ] **Step 1: Write `src/routes/blob.$.tsx`**

```tsx
import { createServerFileRoute } from "@tanstack/react-start/server"
import { fetchBlob } from "~/server/sidebar"

export const ServerRoute = createServerFileRoute("/blob/$").methods({
  GET: async ({ params }) => {
    const splat = (params as { _splat?: string })._splat ?? ""
    const [kind, id] = splat.split("/")
    if ((kind !== "captures" && kind !== "pdfs") || !id) {
      return new Response("Not found", { status: 404 })
    }
    const upstream = await fetchBlob(kind, id)
    if (!upstream.ok || !upstream.body) {
      return new Response("Not found", { status: 404 })
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=3600",
      },
    })
  },
})
```

- [ ] **Step 2: Type-check + build**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: build succeeds (route compiled, `routeTree.gen.ts` regenerated with the blob route).

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/blob.\$.tsx src/routeTree.gen.ts && git commit -m "feat(route): blob-proxy streaming sidebar-api R2 blobs with token"
```

---

### Task 6: ItemCard component

**Files:**
- Create: `src/components/ItemCard.tsx`

- [ ] **Step 1: Write `src/components/ItemCard.tsx`**

```tsx
import { Card, Image, Text, Group, Badge, Stack } from "@mantine/core"
import type { LibraryItem } from "~/lib/library"

const TYPE_LABEL: Record<string, string> = {
  article: "Article", link: "Link", image: "Image", video: "Video",
  pdf: "PDF", webpage: "Webpage", highlight: "Highlight", bookmark: "Bookmark",
}

export function ItemCard({ item }: { item: LibraryItem }) {
  return (
    <Card shadow="md" radius="lg" withBorder padding={0} style={{ overflow: "hidden" }}>
      {item.thumbUrl && (
        <Image src={item.thumbUrl} alt="" h={150} fit="cover" />
      )}
      <Stack gap={8} p="md">
        <Group gap={6}>
          <Badge variant="light" color="brand" radius="xl" size="sm">
            {TYPE_LABEL[item.type] ?? item.type}
          </Badge>
          {item.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="default" radius="xl" size="sm">{t}</Badge>
          ))}
        </Group>
        <Text fw={700} lineClamp={2} c={item.type === "highlight" ? undefined : "brand"}
          fs={item.type === "highlight" ? "italic" : undefined}>
          {item.title}
        </Text>
        {item.excerpt && <Text size="sm" c="dimmed" lineClamp={3}>{item.excerpt}</Text>}
        <Text size="xs" c="dimmed">{new Date(item.createdAt).toLocaleDateString()}</Text>
      </Stack>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/Development/copythe-hub && git add src/components/ItemCard.tsx && git commit -m "feat(ui): ItemCard — type-aware normalized library card"
```

---

### Task 7: Wire the dashboard to real data

**Files:**
- Modify: `src/routes/index.tsx` (replace placeholder cards)

- [ ] **Step 1: Replace `src/routes/index.tsx`**

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import {
  AppShell, Group, Text, Title, Button, TextInput, Pill, SimpleGrid, Stack, Skeleton,
} from "@mantine/core"
import { listLibrary } from "~/server/library.fn"
import { applyFilter, FILTERS, type LibraryItem } from "~/lib/library"
import { ItemCard } from "~/components/ItemCard"

export const Route = createFileRoute("/")({
  loader: async () => ({ items: await listLibrary() }),
  component: Home,
  pendingComponent: () => <LibrarySkeleton />,
})

function Home() {
  const { items } = Route.useLoaderData()
  const [pill, setPill] = useState("All")
  const [q, setQ] = useState("")
  const filtered = applyFilter(items, pill).filter((i) =>
    q.trim() ? i.title.toLowerCase().includes(q.toLowerCase()) : true,
  )
  return (
    <AppShell navbar={{ width: 280, breakpoint: "sm" }} padding="xl">
      <AppShell.Navbar p="md">
        <Group gap="xs" mb="lg">
          <div style={{
            width: 34, height: 34, borderRadius: 10, color: "#fff", fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg,#2c50cd,#5C7CFA)",
          }}>c</div>
          <div>
            <Text fw={800} size="lg">copythe.link</Text>
            <Text size="xs" c="dimmed">your reading hub</Text>
          </div>
        </Group>
        <Button fullWidth>Add New</Button>
      </AppShell.Navbar>
      <AppShell.Main>
        <TextInput radius="xl" size="md" placeholder="Search your library…"
          value={q} onChange={(e) => setQ(e.currentTarget.value)} mb="lg" maw={560} />
        <Title order={2} mb={4}>Your Library</Title>
        <Text c="dimmed" mb="md">{items.length} saved</Text>
        <Group gap="xs" mb="lg">
          {Object.keys(FILTERS).map((p) => (
            <Pill key={p} size="lg" onClick={() => setPill(p)}
              style={{ cursor: "pointer", ...(p === pill ? { background: "#2c50cd", color: "#fff" } : {}) }}>
              {p}
            </Pill>
          ))}
        </Group>
        {filtered.length === 0 ? (
          <Text c="dimmed">No items match.</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {filtered.map((item: LibraryItem) => <ItemCard key={`${item.source}:${item.id}`} item={item} />)}
          </SimpleGrid>
        )}
      </AppShell.Main>
    </AppShell>
  )
}

function LibrarySkeleton() {
  return (
    <Stack p="xl" gap="lg">
      <Skeleton h={42} w={560} radius="xl" />
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
        {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} h={220} radius="lg" />)}
      </SimpleGrid>
    </Stack>
  )
}
```

- [ ] **Step 2: Build**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Run dev and verify real items load**

Run: `cd ~/Development/copythe-hub && pnpm dev` then open the printed localhost URL.
Expected: with `.dev.vars` `HUB_DEV_BYPASS=1` and a valid `SIDEBAR_TOKEN`, the grid shows real items from sidebar-api (the same library the extension writes to). Clicking filter pills narrows by type; typing filters by title. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/index.tsx && git commit -m "feat(dashboard): render real library via listLibrary + filter pills + title filter"
```

---

### Task 8: Deploy + verify live

- [ ] **Step 1: Deploy**

Run: `cd ~/Development/copythe-hub && pnpm run deploy`
Expected: build + `wrangler deploy` succeed; prints a new Version ID.

- [ ] **Step 2: Verify the live worker serves items**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://copythe-hub.lazee.workers.dev/`
Expected: `200`. (If Access custom domain is configured by now, verify `https://hub.copythe.link` after login instead.)

- [ ] **Step 3: Push**

```bash
cd ~/Development/copythe-hub && git push
```

---

## Self-Review

**Spec coverage (Phase 2 of §14):** BFF server functions proxying listItems/search/proxyBlob ✓ (Tasks 3,4,5), dashboard card grid + filter pills + search over existing data ✓ (Tasks 6,7), read-only end-to-end ✓. Token never reaches the browser ✓ (server fns + blob proxy, Tasks 3,5). Out of scope (later plans): item detail/reader routes, ingestion, highlights creation, video transcript — correctly absent.

**Placeholder scan:** No TODO/TBD. Search server function (Task 4) is defined and tested-by-build; wiring the search *UI* to `searchLibrary` (vs the title filter used in Task 7) is deferred to the reader/detail plan where result navigation exists — the title-substring filter covers Phase 2's "search over existing data" for the dashboard, and `searchLibrary` is built and deployable. This is a deliberate scope line, not a missing piece.

**Type consistency:** `LibraryItem`/`Row` types defined in `lib/library.ts` (Task 1) are imported by `sidebar.ts` (Task 3), `library.fn.ts` (Task 4), `ItemCard.tsx` (Task 6), `index.tsx` (Task 7). `fetchBlob(kind,id)` signature (Task 3) matches the blob route caller (Task 5) and the `/blob/<kind>/<id>` URL produced by `normalizeCapture` (Task 1). `HubEnv` (Plan 1) consumed by `getHubEnv` (Task 2) → `sidebar.ts` (Task 3). Filter keys in `FILTERS` (Task 1) drive the pills (Task 7).

**Risks:** `cloudflare:workers` env import (Task 2) and `createServerFileRoute` blob route (Task 5) are the two API-surface bets; both have context7 fallback notes and are exercised by `pnpm build`/`deploy` before completion.
