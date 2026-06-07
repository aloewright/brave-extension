# copythe-hub — Plan 6: Video Transcript Snippets + Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save videos (YouTube), watch them embedded, read their transcript, and save transcript snippets as highlights. Plus product polish: dark mode toggle and a friendly empty state.

**Architecture:** A pure `parseVideo(url)` recognizes YouTube/Vimeo and yields `{ provider, id, embedUrl, thumbUrl }`. Ingestion stores video URLs as links tagged `video`; `normalizeLink` promotes tag-`video` items to `type:"video"` and derives a thumbnail. A video viewer embeds the player and shows a transcript panel; `fetchTranscript` (server fn, best-effort YouTube caption scrape) returns timestamped cues. Selecting transcript text saves a highlight (reusing Plan 5's `createHighlight`), prefixing the timestamp. Dark mode uses Mantine's color-scheme.

**Tech Stack:** TanStack Start `createServerFn`, Mantine v9 (`useMantineColorScheme`), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-design.md` (Phase 4 video transcript portion + Phase 6 polish). Transcript fetch is best-effort (captions must exist + be public); graceful empty state otherwise.

**Repo:** `~/Development/copythe-hub`.

---

## File Structure

```
src/
  lib/
    video.ts            # pure: parseVideo(url) → VideoInfo | null
    library.ts          # MODIFY: normalizeLink promotes "video" tag → type video + thumb
  server/
    transcript.fn.ts    # fetchTranscript server fn (YouTube captions)
    ingest.fn.ts        # MODIFY: video branch
  components/
    viewers/VideoViewer.tsx
  routes/
    item.$source.$id.tsx # MODIFY: render VideoViewer for type video
    __root.tsx           # (color scheme already configured)
    index.tsx            # MODIFY: dark-mode toggle + empty state
tests/
    video.test.ts
    library-video.test.ts
```

---

### Task 1: `parseVideo` (TDD)

**Files:**
- Create: `src/lib/video.ts`
- Test: `tests/video.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/video.test.ts
import { describe, it, expect } from "vitest"
import { parseVideo } from "~/lib/video"

describe("parseVideo", () => {
  it("parses a youtube watch url", () => {
    const v = parseVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    expect(v).toMatchObject({
      provider: "youtube", id: "dQw4w9WgXcQ",
      embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      thumbUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    })
  })
  it("parses a youtu.be short url", () => {
    expect(parseVideo("https://youtu.be/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ")
  })
  it("parses a vimeo url", () => {
    const v = parseVideo("https://vimeo.com/123456789")
    expect(v).toMatchObject({ provider: "vimeo", id: "123456789", embedUrl: "https://player.vimeo.com/video/123456789" })
  })
  it("returns null for non-video urls", () => {
    expect(parseVideo("https://example.com/article")).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail** — `cd ~/Development/copythe-hub && pnpm vitest run tests/video.test.ts` → FAIL.

- [ ] **Step 3: Write `src/lib/video.ts`**

```typescript
export type VideoProvider = "youtube" | "vimeo"
export interface VideoInfo {
  provider: VideoProvider
  id: string
  embedUrl: string
  thumbUrl?: string
}

export function parseVideo(url: string): VideoInfo | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\./, "")
  if (host === "youtu.be") {
    const id = u.pathname.slice(1)
    return id ? yt(id) : null
  }
  if (host === "youtube.com" || host === "m.youtube.com") {
    const id = u.searchParams.get("v")
    return id ? yt(id) : null
  }
  if (host === "vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean)[0]
    return /^\d+$/.test(id ?? "")
      ? { provider: "vimeo", id, embedUrl: `https://player.vimeo.com/video/${id}` }
      : null
  }
  return null
}

function yt(id: string): VideoInfo {
  return {
    provider: "youtube",
    id,
    embedUrl: `https://www.youtube.com/embed/${id}`,
    thumbUrl: `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  }
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run tests/video.test.ts` → PASS (4).

- [ ] **Step 5: Commit** — `git add src/lib/video.ts tests/video.test.ts && git commit -m "feat(video): parseVideo (youtube/vimeo)"`

---

### Task 2: `normalizeLink` promotes video items (TDD)

**Files:**
- Modify: `src/lib/library.ts`
- Test: `tests/library-video.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/library-video.test.ts
import { describe, it, expect } from "vitest"
import { normalizeLink } from "~/lib/library"

describe("normalizeLink video promotion", () => {
  it("a link tagged 'video' becomes type video with a youtube thumb", () => {
    const item = normalizeLink({
      id: "v1", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "A Video",
      description: null, tags: '["video"]', favicon: null, source: "hub",
      chunk_count: 0, created_at: 1700000000000, updated_at: 1700000000000,
    })
    expect(item.type).toBe("video")
    expect(item.thumbUrl).toBe("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg")
  })
  it("a normal link stays type link", () => {
    const item = normalizeLink({
      id: "l1", url: "https://x.com/a", title: "A", description: null, tags: "[]",
      favicon: null, source: "hub", chunk_count: 0, created_at: 1, updated_at: 1,
    })
    expect(item.type).toBe("link")
  })
})
```

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run tests/library-video.test.ts` → FAIL.

- [ ] **Step 3: Modify `normalizeLink` in `src/lib/library.ts`** — replace its body:

```typescript
import { parseVideo } from "./video"
// ...
export function normalizeLink(r: LinkRow): LibraryItem {
  const tags = parseTags(r.tags)
  const isVideo = tags.includes("video")
  const video = isVideo ? parseVideo(r.url) : null
  return {
    id: r.id,
    type: isVideo ? "video" : "link",
    source: "links",
    title: r.title || r.url,
    excerpt: r.description ?? undefined,
    url: r.url,
    thumbUrl: video?.thumbUrl,
    favicon: r.favicon ?? undefined,
    tags,
    createdAt: iso(r.created_at),
  }
}
```
(Add the `import { parseVideo } from "./video"` at the top of `library.ts`.)

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run` → all pass (existing link test still green: its row has no "video" tag).

- [ ] **Step 5: Commit** — `git add src/lib/library.ts tests/library-video.test.ts && git commit -m "feat(library): promote video-tagged links to type video + thumbnail"`

---

### Task 3: Ingest videos

**Files:**
- Modify: `src/server/ingest.fn.ts`

- [ ] **Step 1: Add a video branch at the start of `ingestUrl`'s try block** (before the `fetch`):

```typescript
      // Video hosts: store as a tagged link (no body fetch needed).
      const video = parseVideo(url)
      if (video) {
        let title = url
        try {
          const oe = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
          )
          if (oe.ok) title = ((await oe.json()) as { title?: string }).title ?? url
        } catch {
          /* keep url as title */
        }
        const { id } = await postLink({ url, title, tags: ["video"] })
        return { ok: true, kind: "video", id }
      }
```
Add `import { parseVideo } from "~/lib/video"` at the top. (oEmbed title fetch is YouTube-only; Vimeo falls back to the URL as title — acceptable for MVP.)

- [ ] **Step 2: Type-check** — `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 3: Commit** — `git add src/server/ingest.fn.ts && git commit -m "feat(ingest): detect video urls, store as video-tagged link"`

---

### Task 4: Transcript server function

**Files:**
- Create: `src/server/transcript.fn.ts`

- [ ] **Step 1: Write `src/server/transcript.fn.ts`**

```typescript
import { createServerFn } from "@tanstack/react-start"
import { parseVideo } from "~/lib/video"

export interface Cue { start: number; text: string }

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
}

// Best-effort YouTube transcript: read the watch page, find a caption track
// baseUrl in the player response, fetch its timedtext XML, parse cues.
export const fetchTranscript = createServerFn({ method: "GET" })
  .inputValidator((data: { url: string }) => data)
  .handler(async ({ data }): Promise<{ available: boolean; cues: Cue[] }> => {
    const v = parseVideo(data.url)
    if (!v || v.provider !== "youtube") return { available: false, cues: [] }
    try {
      const page = await fetch(`https://www.youtube.com/watch?v=${v.id}`, {
        headers: { "user-agent": "Mozilla/5.0", "accept-language": "en" },
      }).then((r) => r.text())
      const m = page.match(/"captionTracks":(\[.*?\])/)
      if (!m) return { available: false, cues: [] }
      const tracks = JSON.parse(m[1]) as { baseUrl: string; languageCode?: string }[]
      if (!tracks.length) return { available: false, cues: [] }
      const track = tracks.find((t) => t.languageCode?.startsWith("en")) ?? tracks[0]
      const xml = await fetch(track.baseUrl).then((r) => r.text())
      const cues: Cue[] = []
      const re = /<text start="([\d.]+)"[^>]*>(.*?)<\/text>/g
      let g: RegExpExecArray | null
      while ((g = re.exec(xml))) {
        const text = decodeEntities(g[2].replace(/<[^>]+>/g, "")).trim()
        if (text) cues.push({ start: Math.floor(Number(g[1])), text })
      }
      return { available: cues.length > 0, cues }
    } catch {
      return { available: false, cues: [] }
    }
  })

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}
```

- [ ] **Step 2: Type-check** — `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 3: Commit** — `git add src/server/transcript.fn.ts && git commit -m "feat(video): best-effort YouTube transcript server fn"`

---

### Task 5: Video viewer with transcript + snippet save

**Files:**
- Create: `src/components/viewers/VideoViewer.tsx`

- [ ] **Step 1: Write `src/components/viewers/VideoViewer.tsx`**

```tsx
import { useEffect, useState } from "react"
import { Stack, Title, Group, Badge, Text, Paper, ScrollArea, Loader, Button } from "@mantine/core"
import type { LibraryItem } from "~/lib/library"
import { parseVideo } from "~/lib/video"
import { fetchTranscript, formatTime, type Cue } from "~/server/transcript.fn"
import { createHighlight } from "~/server/highlight.fn"

const T_ID = "transcript-body"

export function VideoViewer({ item, onSaved }: { item: LibraryItem; onSaved: () => void }) {
  const video = item.url ? parseVideo(item.url) : null
  const [cues, setCues] = useState<Cue[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [savingIdx, setSavingIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!item.url) return
    setLoading(true)
    fetchTranscript({ data: { url: item.url } })
      .then((r) => setCues(r.cues))
      .finally(() => setLoading(false))
  }, [item.url])

  const saveCue = async (cue: Cue, idx: number) => {
    setSavingIdx(idx)
    await createHighlight({
      data: {
        text: cue.text,
        note: `Video @ ${formatTime(cue.start)}`,
        sourceUrl: item.url,
        sourceTitle: item.title,
      },
    })
    setSavingIdx(null)
    onSaved()
  }

  return (
    <Group align="flex-start" gap="lg" wrap="nowrap" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <Stack gap="md" style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6}>
          {item.tags.map((t) => (
            <Badge key={t} variant="light" color="brand" radius="xl" size="sm">{t}</Badge>
          ))}
        </Group>
        <Title order={2}>{item.title}</Title>
        {video ? (
          <iframe
            title={item.title}
            src={video.embedUrl}
            allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ width: "100%", aspectRatio: "16/9", border: "none", borderRadius: 16 }}
          />
        ) : (
          <Text c="dimmed">Unsupported video URL.</Text>
        )}
      </Stack>
      <Paper withBorder radius="lg" p="md" style={{ width: 340, flexShrink: 0 }}>
        <Text fw={800} mb="sm">Transcript</Text>
        {loading && <Group><Loader size="sm" /><Text c="dimmed" size="sm">Loading…</Text></Group>}
        {!loading && cues && cues.length === 0 && (
          <Text c="dimmed" size="sm">No public transcript for this video.</Text>
        )}
        {!loading && cues && cues.length > 0 && (
          <ScrollArea h="65vh" id={T_ID}>
            <Stack gap="xs">
              {cues.map((c, i) => (
                <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
                  <Badge variant="light" color="brand" radius="sm" style={{ flexShrink: 0 }}>
                    {formatTime(c.start)}
                  </Badge>
                  <Text size="sm" style={{ flex: 1 }}>{c.text}</Text>
                  <Button size="compact-xs" variant="subtle" loading={savingIdx === i}
                    onClick={() => void saveCue(c, i)}>save</Button>
                </Group>
              ))}
            </Stack>
          </ScrollArea>
        )}
      </Paper>
    </Group>
  )
}
```

- [ ] **Step 2: Commit** — `git add src/components/viewers/VideoViewer.tsx && git commit -m "feat(video): embedded player + transcript panel + per-cue snippet save"`

---

### Task 6: Wire VideoViewer into the detail route

**Files:**
- Modify: `src/routes/item.$source.$id.tsx`

- [ ] **Step 1: Import + render.** Add `import { VideoViewer } from "~/components/viewers/VideoViewer"`. Replace the `item.type === "video"` line:

```tsx
          {item.type === "video" && (
            <VideoViewer item={item} onSaved={() => router.invalidate()} />
          )}
```

- [ ] **Step 2: Build** — `cd ~/Development/copythe-hub && pnpm build` → succeeds.

- [ ] **Step 3: Commit** — `git add src/routes/item.\$source.\$id.tsx && git commit -m "feat(video): render VideoViewer for video items"`

---

### Task 7: Dark mode toggle + empty state

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Add the toggle + empty state.** Add imports:
```tsx
import { ActionIcon, useMantineColorScheme } from "@mantine/core"
```
In `Home()`, add `const { toggleColorScheme, colorScheme } = useMantineColorScheme()`. Put a toggle in the navbar under the Add New button:
```tsx
        <ActionIcon variant="subtle" mt="md" onClick={toggleColorScheme} aria-label="Toggle color scheme">
          {colorScheme === "dark" ? "☀" : "☾"}
        </ActionIcon>
```
Replace the `items.length === 0`-unaware area: when `items.length === 0`, show a friendly empty state instead of just the grid. Change the body block to:
```tsx
        {items.length === 0 ? (
          <Stack align="center" gap="xs" py={64}>
            <Text fw={700} size="lg">Your library is empty</Text>
            <Text c="dimmed">Click “Add New” to save your first link, image, PDF, or video.</Text>
            <Button mt="sm" onClick={addHandlers.open}>Add New</Button>
          </Stack>
        ) : filtered.length === 0 ? (
          <Text c="dimmed">No items match.</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">
            {filtered.map((item: LibraryItem) => (
              <ItemCard key={`${item.source}:${item.id}`} item={item} />
            ))}
          </SimpleGrid>
        )}
```

- [ ] **Step 2: Build** — `pnpm build` → succeeds.

- [ ] **Step 3: Run dev + verify** — `pnpm dev`; add a YouTube URL, open it → embedded player + transcript with per-cue "save"; click a cue's save → highlight appears in library. Toggle dark mode. Stop with Ctrl-C.

- [ ] **Step 4: Commit** — `git add src/routes/index.tsx && git commit -m "feat(polish): dark-mode toggle + empty-library state"`

---

### Task 8: Deploy + verify

- [ ] **Step 1: Deploy** — `cd ~/Development/copythe-hub && pnpm run deploy` → success.
- [ ] **Step 2: Verify** — `curl -s -o /dev/null -w "%{http_code}\n" https://hub.copythe.link/` → `302`. Authenticated: add a YouTube URL → watch + transcript snippet save works.
- [ ] **Step 3: Push** — `cd ~/Development/copythe-hub && git push`.

---

## Self-Review

**Spec coverage:** video save + embedded player ✓ (Tasks 1,3,5,6), transcript display ✓ (Tasks 4,5), select/save transcript snippet → timestamp-anchored highlight ✓ (Task 5 per-cue save with `Video @ m:ss` note → createHighlight), dark mode + empty state ✓ (Task 7). The snippet is saved as a highlight carrying the cue text + timestamp note (the spec's `{type:"transcript",...}` anchor maps to the note here; a dedicated anchor column is the §6 future optimization).

**Placeholder scan:** No TODO/TBD. Transcript availability is best-effort with an explicit empty state — a real product state, not a stub.

**Type consistency:** `parseVideo` → `VideoInfo` (Task 1) used in `normalizeLink` (Task 2), `ingestUrl` (Task 3), `transcript.fn` (Task 4), `VideoViewer` (Task 5). `Cue`/`formatTime` (Task 4) consumed in `VideoViewer` (Task 5). `createHighlight({data:{text,note?,sourceUrl?,sourceTitle?}})` (Plan 5) matches the snippet save call (Task 5). `VideoViewer` props `{item,onSaved}` match the route render (Task 6).

**Risks:** YouTube caption scraping is the fragile bet (markup can change, captions may be absent/region-locked) — mitigated by try/catch + empty state, and exercised by the Task 7 live add. The oEmbed title fetch and the iframe embed are low-risk and verified by the live watch.
