# copythe-hub — Plan 3: Item Detail & Viewers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make library cards open a detail view. Render each saved item with a type-appropriate viewer — full image, embedded PDF, webpage/link reading layout, highlight quote, bookmark — all from the existing sidebar-api data, with a back-to-library control and an "open original" action.

**Architecture:** A `getItem` server function fetches one record by `source` + `id` from the matching sidebar-api `GET /:id` endpoint and normalizes it (reusing Plan 2's normalizers). A single dynamic route `/item/$source/$id` renders a type-aware viewer. `ItemCard` becomes a router `Link` to that route. PDFs/images load via the Plan 2 blob proxy. The webpage/link viewer uses the clean reading layout from the mockups; it upgrades to a full Readability reader once Plan 5 adds extracted article text — no rework needed.

**Tech Stack:** TanStack Start `createServerFn`, TanStack Router `Link`/dynamic routes, Mantine v9, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-design.md` (Phase 3 of §14, scoped to types with data today; the highlight-annotated article reader and transcript video player follow in Plans 4–5).

**Repo:** `~/Development/copythe-hub`.

**sidebar-api single-item endpoints (verified in worker/src/routes):**
- `GET /api/links/:id` → `LinkRow`
- `GET /api/captures/:id` → `CaptureRow` (DB row: snake_case — `r2_key`, `mime_type`, `source_url`, `source_title`, `created_at`, `kind`, `filename`, `size_bytes`, `status`)
- `GET /api/highlights/:id` → `HighlightRow`
- `GET /api/bookmarks/:id` → `BookmarkRow`

Note: `GET /api/captures/:id` returns the raw DB row (snake_case), unlike `GET /api/captures` (list, camelCase `CaptureSummary`). The BFF `fetchItem` maps the capture row into a `CaptureSummary` before normalizing.

---

## File Structure

```
src/
  server/
    sidebar.ts          # MODIFY: add fetchItem(source,id) single-record fetchers
    library.fn.ts       # MODIFY: add getItem server fn
  routes/
    item.$source.$id.tsx  # detail route, type-aware viewer
  components/
    ItemCard.tsx        # MODIFY: wrap in router Link to /item/$source/$id
    viewers/
      ImageViewer.tsx
      PdfViewer.tsx
      ReadingView.tsx   # link/webpage/article reading layout
      HighlightView.tsx
tests/
    item.test.ts        # captureRow→CaptureSummary mapping + getItem normalize routing
```

---

### Task 1: Capture-row→summary mapper + single-item fetchers (TDD)

**Files:**
- Modify: `src/server/sidebar.ts`
- Test: `tests/item.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/item.test.ts
import { describe, it, expect } from "vitest"
import { captureRowToSummary } from "~/server/sidebar"

describe("captureRowToSummary", () => {
  it("maps a snake_case capture DB row to a camelCase CaptureSummary", () => {
    const summary = captureRowToSummary({
      id: "c1", kind: "screenshot", filename: "shot.png",
      source_url: "https://x.com", source_title: "X", size_bytes: 1000,
      mime_type: "image/png", status: "ready", created_at: 1700000000000,
      r2_key: "k", extracted_text: null, status_message: null, chunk_count: 1,
      updated_at: 1700000000000,
    })
    expect(summary).toMatchObject({
      id: "c1", kind: "screenshot", filename: "shot.png",
      sourceUrl: "https://x.com", sourceTitle: "X", sizeBytes: 1000,
      mimeType: "image/png", status: "ready", blobUrl: "/api/captures/c1/blob",
    })
    expect(summary.createdAt).toBe(new Date(1700000000000).toISOString())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/item.test.ts`
Expected: FAIL — `captureRowToSummary` is not exported.

- [ ] **Step 3: Add to `src/server/sidebar.ts`** (append these exports)

```typescript
import type {
  LinkRow, CaptureSummary, BookmarkRow, HighlightRow,
} from "~/lib/library"

export interface CaptureRow {
  id: string; kind: "screenshot" | "pdf"; filename: string
  source_url: string | null; source_title: string | null; size_bytes: number
  mime_type: string; status: string; created_at: number
  r2_key: string; extracted_text: string | null; status_message: string | null
  chunk_count: number; updated_at: number
}

export function captureRowToSummary(r: CaptureRow): CaptureSummary {
  return {
    id: r.id, kind: r.kind, filename: r.filename,
    sourceUrl: r.source_url, sourceTitle: r.source_title, sizeBytes: r.size_bytes,
    mimeType: r.mime_type, status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    blobUrl: `/api/captures/${r.id}/blob`,
  }
}

export async function fetchLinkItem(id: string): Promise<LinkRow> {
  return getJson<LinkRow>(`/api/links/${encodeURIComponent(id)}`)
}
export async function fetchCaptureItem(id: string): Promise<CaptureSummary> {
  return captureRowToSummary(await getJson<CaptureRow>(`/api/captures/${encodeURIComponent(id)}`))
}
export async function fetchHighlightItem(id: string): Promise<HighlightRow> {
  return getJson<HighlightRow>(`/api/highlights/${encodeURIComponent(id)}`)
}
export async function fetchBookmarkItem(id: string): Promise<BookmarkRow> {
  return getJson<BookmarkRow>(`/api/bookmarks/${encodeURIComponent(id)}`)
}
```

Note: `getJson` already exists in `sidebar.ts` (Plan 2). If it is declared `async function getJson` below these additions, hoisting covers it; if TypeScript complains about use-before-declaration for the type, move the new functions below `getJson`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/item.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/sidebar.ts tests/item.test.ts && git commit -m "feat(bff): single-item fetchers + capture row→summary mapper"
```

---

### Task 2: `getItem` server function

**Files:**
- Modify: `src/server/library.fn.ts`

- [ ] **Step 1: Append to `src/server/library.fn.ts`**

```typescript
import {
  fetchLinkItem, fetchCaptureItem, fetchHighlightItem, fetchBookmarkItem,
} from "./sidebar"
import type { LibrarySource } from "~/lib/library"

export const getItem = createServerFn({ method: "GET" })
  .inputValidator((data: { source: LibrarySource; id: string }) => data)
  .handler(async ({ data }): Promise<LibraryItem | null> => {
    try {
      switch (data.source) {
        case "links": return normalizeLink(await fetchLinkItem(data.id))
        case "captures": return normalizeCapture(await fetchCaptureItem(data.id))
        case "highlights": return normalizeHighlight(await fetchHighlightItem(data.id))
        case "bookmarks": return normalizeBookmark(await fetchBookmarkItem(data.id))
        default: return null
      }
    } catch {
      return null
    }
  })
```

(The `normalize*` imports already exist at the top of the file from Plan 2; add only the new `fetch*Item` and `LibrarySource` imports.)

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/library.fn.ts && git commit -m "feat(server): getItem server function (by source+id)"
```

---

### Task 3: Viewer components

**Files:**
- Create: `src/components/viewers/ImageViewer.tsx`
- Create: `src/components/viewers/PdfViewer.tsx`
- Create: `src/components/viewers/ReadingView.tsx`
- Create: `src/components/viewers/HighlightView.tsx`

- [ ] **Step 1: Write `src/components/viewers/ImageViewer.tsx`**

```tsx
import { Image, Center } from "@mantine/core"
import type { LibraryItem } from "~/lib/library"

export function ImageViewer({ item }: { item: LibraryItem }) {
  return (
    <Center>
      <Image src={item.thumbUrl ?? `/blob/captures/${item.id}`} alt={item.title}
        radius="lg" mah="78vh" w="auto" fit="contain" />
    </Center>
  )
}
```

- [ ] **Step 2: Write `src/components/viewers/PdfViewer.tsx`**

```tsx
import type { LibraryItem } from "~/lib/library"

export function PdfViewer({ item }: { item: LibraryItem }) {
  const src = `/blob/captures/${item.id}`
  return (
    <iframe
      title={item.title}
      src={src}
      style={{ width: "100%", height: "80vh", border: "none", borderRadius: 16 }}
    />
  )
}
```

- [ ] **Step 3: Write `src/components/viewers/ReadingView.tsx`** (link/webpage/article)

```tsx
import { Stack, Title, Text, Anchor, Group, Badge } from "@mantine/core"
import type { LibraryItem } from "~/lib/library"

export function ReadingView({ item }: { item: LibraryItem }) {
  return (
    <Stack gap="md" maw={680} mx="auto">
      <Group gap={6}>
        {item.tags.map((t) => (
          <Badge key={t} variant="light" color="brand" radius="xl" size="sm">{t}</Badge>
        ))}
      </Group>
      <Title order={1} style={{ fontSize: 40, lineHeight: 1.15 }}>{item.title}</Title>
      {item.url && (
        <Anchor href={item.url} target="_blank" rel="noreferrer" c="dimmed" size="sm">
          {item.url}
        </Anchor>
      )}
      {item.excerpt && (
        <Text style={{ fontSize: 19, lineHeight: 1.7 }}>{item.excerpt}</Text>
      )}
      <Text c="dimmed" size="sm">
        Full reader text arrives with ingestion (Plan 5). For now, open the original above.
      </Text>
    </Stack>
  )
}
```

- [ ] **Step 4: Write `src/components/viewers/HighlightView.tsx`**

```tsx
import { Stack, Text, Anchor, Paper } from "@mantine/core"
import type { LibraryItem } from "~/lib/library"

export function HighlightView({ item }: { item: LibraryItem }) {
  return (
    <Stack gap="md" maw={680} mx="auto">
      <Paper withBorder radius="lg" p="xl"
        style={{ borderLeft: "4px solid var(--mantine-color-brand-6)" }}>
        <Text fs="italic" style={{ fontSize: 22, lineHeight: 1.5 }}>“{item.title}”</Text>
      </Paper>
      {item.excerpt && <Text>{item.excerpt}</Text>}
      {item.url && (
        <Anchor href={item.url} target="_blank" rel="noreferrer" c="dimmed" size="sm">
          {item.url}
        </Anchor>
      )}
    </Stack>
  )
}
```

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/components/viewers && git commit -m "feat(ui): image/pdf/reading/highlight viewer components"
```

---

### Task 4: Detail route `/item/$source/$id`

**Files:**
- Create: `src/routes/item.$source.$id.tsx`

- [ ] **Step 1: Write `src/routes/item.$source.$id.tsx`**

```tsx
import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { AppShell, Group, Button, Text, Stack } from "@mantine/core"
import { getItem } from "~/server/library.fn"
import type { LibrarySource } from "~/lib/library"
import { ImageViewer } from "~/components/viewers/ImageViewer"
import { PdfViewer } from "~/components/viewers/PdfViewer"
import { ReadingView } from "~/components/viewers/ReadingView"
import { HighlightView } from "~/components/viewers/HighlightView"

export const Route = createFileRoute("/item/$source/$id")({
  loader: async ({ params }) => {
    const item = await getItem({
      data: { source: params.source as LibrarySource, id: params.id },
    })
    if (!item) throw notFound()
    return { item }
  },
  component: ItemDetail,
})

function ItemDetail() {
  const { item } = Route.useLoaderData()
  return (
    <AppShell header={{ height: 64 }} padding="xl">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Button component={Link} to="/" variant="subtle" radius="xl">← Library</Button>
          {item.url && (
            <Button component="a" href={item.url} target="_blank" variant="light" radius="xl">
              Open original
            </Button>
          )}
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Stack gap="lg">
          {item.type === "image" && <ImageViewer item={item} />}
          {item.type === "pdf" && <PdfViewer item={item} />}
          {item.type === "highlight" && <HighlightView item={item} />}
          {(item.type === "link" || item.type === "article" ||
            item.type === "webpage" || item.type === "bookmark") && <ReadingView item={item} />}
          {item.type === "video" && (
            <Text c="dimmed">Video player arrives with the video/transcript plan.</Text>
          )}
        </Stack>
      </AppShell.Main>
    </AppShell>
  )
}
```

- [ ] **Step 2: Build (compiles route, regenerates routeTree)**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/item.\$source.\$id.tsx src/routeTree.gen.ts && git commit -m "feat(route): /item/\$source/\$id type-aware detail viewer"
```

---

### Task 5: Make cards navigate to detail

**Files:**
- Modify: `src/components/ItemCard.tsx`

- [ ] **Step 1: Wrap the card in a router `Link`** — replace the `<Card ...>` opening with a linked card. Full file:

```tsx
import { Card, Image, Text, Group, Badge, Stack } from "@mantine/core"
import { Link } from "@tanstack/react-router"
import type { LibraryItem } from "~/lib/library"

const TYPE_LABEL: Record<string, string> = {
  article: "Article", link: "Link", image: "Image", video: "Video",
  pdf: "PDF", webpage: "Webpage", highlight: "Highlight", bookmark: "Bookmark",
}

export function ItemCard({ item }: { item: LibraryItem }) {
  return (
    <Card
      component={Link}
      to="/item/$source/$id"
      params={{ source: item.source, id: item.id }}
      shadow="md"
      radius="lg"
      withBorder
      padding={0}
      style={{ overflow: "hidden", textDecoration: "none", color: "inherit" }}
    >
      {item.thumbUrl && <Image src={item.thumbUrl} alt="" h={150} fit="cover" />}
      <Stack gap={8} p="md">
        <Group gap={6}>
          <Badge variant="light" color="brand" radius="xl" size="sm">
            {TYPE_LABEL[item.type] ?? item.type}
          </Badge>
          {item.tags.slice(0, 2).map((t) => (
            <Badge key={t} variant="default" radius="xl" size="sm">{t}</Badge>
          ))}
        </Group>
        <Text
          fw={700}
          lineClamp={2}
          c={item.type === "highlight" ? undefined : "brand"}
          fs={item.type === "highlight" ? "italic" : undefined}
        >
          {item.title}
        </Text>
        {item.excerpt && <Text size="sm" c="dimmed" lineClamp={3}>{item.excerpt}</Text>}
        <Text size="xs" c="dimmed">{new Date(item.createdAt).toLocaleDateString()}</Text>
      </Stack>
    </Card>
  )
}
```

- [ ] **Step 2: Build**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Run dev and click through**

Run: `cd ~/Development/copythe-hub && pnpm dev`, open the localhost URL.
Expected: clicking an image card opens `/item/captures/<id>` showing the full image; a PDF card shows the embedded PDF; a link/bookmark shows the reading layout with "Open original"; a highlight shows the quote block. "← Library" returns home. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add src/components/ItemCard.tsx && git commit -m "feat(ui): cards link to /item detail route"
```

---

### Task 6: Deploy + verify live

- [ ] **Step 1: Deploy**

Run: `cd ~/Development/copythe-hub && pnpm run deploy`
Expected: build + deploy succeed; new Version ID.

- [ ] **Step 2: Verify (behind Access)**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://hub.copythe.link/item/captures/anything`
Expected: `302` (Access redirect — confirms the route exists and is gated; authenticated browser navigation renders the viewer).

- [ ] **Step 3: Push**

```bash
cd ~/Development/copythe-hub && git push
```

---

## Self-Review

**Spec coverage (Phase 3 of §14):** image/pdf/webpage detail ✓ (Tasks 3,4), reading layout for link/article/bookmark ✓ (Task 3 ReadingView), highlight detail ✓, cards open details ✓ (Task 5). **Deliberately deferred with explicit in-UI notes:** the highlight-*annotated* article reader (needs Readability text from Plan 5) and the video player+transcript (needs video data, Plan 4+). Each renders a graceful "arrives with Plan N" message rather than a broken screen — honest scope, no silent gaps.

**Placeholder scan:** No TODO/TBD. The two "arrives with Plan N" texts are intentional user-facing states for data that does not exist yet, not unfinished code.

**Type consistency:** `getItem({ data: { source, id } })` (Task 2) matches the route loader call (Task 4) and `Link` params `{ source, id }` (Task 5). `captureRowToSummary` output (Task 1) feeds `normalizeCapture` (Plan 2) unchanged. `LibrarySource` union reused from `lib/library.ts`. Viewer props all take `{ item: LibraryItem }`. The `/item/$source/$id` path string is identical in the route definition (Task 4) and the card `Link` (Task 5).

**Risks:** `notFound()` + loader behavior and `Card component={Link}` typing are the two framework-surface bets; both are exercised by `pnpm build` and the Task 5 click-through before completion.
