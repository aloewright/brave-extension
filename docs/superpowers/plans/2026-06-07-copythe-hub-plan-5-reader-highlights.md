# copythe-hub — Plan 5: Reader + Highlight Creation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn saved articles into a real reading experience and let the user create highlights. Articles store their full extracted text on ingest; the detail view renders it as a clean reader; selecting text shows a "Save highlight" action that persists to sidebar-api and appears in the library.

**Architecture:** `extractArticle` is extended to return the full plain text (`text`). `ingestUrl` stores that text in the existing `links.description` field (no sidebar-api schema change). The reader splits the stored text into paragraphs. A `useTextSelection` hook surfaces a floating "Save highlight" button over a selection; `createHighlight` server function writes to `POST /api/highlights` and the page invalidates so the new highlight card appears.

**Tech Stack:** TanStack Start `createServerFn`, Mantine, `@mantine/hooks`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-design.md` (Phase 4 of §14, highlights portion). Video transcript snippets are Plan 6 (need video data). Full reader uses `links.description` as the body store — the dedicated article columns (§6) remain a future optimization, not required here.

**Repo:** `~/Development/copythe-hub`.

**sidebar-api write endpoint (verified):** `POST /api/highlights` JSON `{ text, note?, tags?, sourceUrl?, sourceTitle?, sourceHost?, source? }` (HighlightRow fields; the route accepts camelCase body and maps to columns — confirm field names in `worker/src/routes/highlights.ts` at task time; the helper sends both `text` and source metadata).

---

## File Structure

```
src/
  lib/
    readability.ts       # MODIFY: also return full `text`
    paragraphs.ts        # pure: splitParagraphs(text) → string[]
  server/
    ingest.fn.ts         # MODIFY: store full text in description
    sidebar.ts           # MODIFY: postHighlight()
    highlight.fn.ts      # createHighlight server fn
  components/
    viewers/ReadingView.tsx   # MODIFY: render paragraphs + selection-to-highlight
    SelectionHighlighter.tsx  # floating Save-highlight button over a selection
  hooks/
    useTextSelection.ts
tests/
    paragraphs.test.ts
```

---

### Task 1: `extractArticle` returns full text + paragraph splitter (TDD)

**Files:**
- Modify: `src/lib/readability.ts`
- Create: `src/lib/paragraphs.ts`
- Test: `tests/paragraphs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/paragraphs.test.ts
import { describe, it, expect } from "vitest"
import { splitParagraphs } from "~/lib/paragraphs"

describe("splitParagraphs", () => {
  it("splits on blank lines and trims", () => {
    expect(splitParagraphs("One.\n\nTwo.\n\n\nThree.")).toEqual(["One.", "Two.", "Three."])
  })
  it("falls back to single paragraph when no blank lines", () => {
    expect(splitParagraphs("Just one line")).toEqual(["Just one line"])
  })
  it("returns empty array for empty input", () => {
    expect(splitParagraphs("   ")).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/paragraphs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/paragraphs.ts`**

```typescript
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0)
}
```

- [ ] **Step 4: Modify `src/lib/readability.ts`** — add `text` to the interface and return it. Change `ExtractedArticle` and both return sites:

```typescript
export interface ExtractedArticle {
  title: string
  excerpt: string
  text: string
  textLength: number
}
```
In the success branch, build `text` from the article's `textContent` preserving paragraph breaks:
```typescript
      const raw = (article.textContent ?? "")
      const text = raw.replace(/\n{3,}/g, "\n\n").trim()
      const flat = text.replace(/\s+/g, " ").trim()
      return {
        title: (article.title || docTitle || url).trim(),
        excerpt: (article.excerpt || flat.slice(0, 280)).trim(),
        text,
        textLength: flat.length,
      }
```
In the fallback `return`, add `text: ""`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/paragraphs.test.ts tests/readability.test.ts`
Expected: PASS. (readability.test still passes — it only asserts title/excerpt/textLength.)

- [ ] **Step 6: Commit**

```bash
cd ~/Development/copythe-hub && git add src/lib/paragraphs.ts src/lib/readability.ts tests/paragraphs.test.ts && git commit -m "feat(reader): full article text + paragraph splitter"
```

---

### Task 2: Store full text on ingest

**Files:**
- Modify: `src/server/ingest.fn.ts`

- [ ] **Step 1: In `ingestUrl`, store the full text in `description`.** Change the article branch:

```typescript
        if (kind === "article") {
          const html = await res.text()
          const art = extractArticle(html, url)
          const { id } = await postLink({
            url,
            title: art.title,
            description: art.text || art.excerpt || undefined, // full body for the reader
            tags: ["article"],
          })
          return { ok: true, kind, id }
        }
```

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/ingest.fn.ts && git commit -m "feat(ingest): store full reader text in link description"
```

---

### Task 3: Highlight write helper + server function

**Files:**
- Modify: `src/server/sidebar.ts`
- Create: `src/server/highlight.fn.ts`

- [ ] **Step 1: Append `postHighlight` to `src/server/sidebar.ts`**

```typescript
export interface NewHighlight {
  text: string; note?: string; sourceUrl?: string; sourceTitle?: string
}
export async function postHighlight(h: NewHighlight): Promise<{ id: string }> {
  const res = await fetch(`${base()}/api/highlights`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({
      text: h.text, note: h.note ?? null,
      sourceUrl: h.sourceUrl ?? null, sourceTitle: h.sourceTitle ?? null,
      tags: [], source: "hub",
    }),
  })
  if (!res.ok) throw new Error(`postHighlight failed (${res.status})`)
  return (await res.json()) as { id: string }
}
```
Note: verify the `POST /api/highlights` body field names in `worker/src/routes/highlights.ts`. If it expects snake_case (`source_url`, `source_title`), send those instead. (The route's POST body interface is the source of truth — match it exactly.)

- [ ] **Step 2: Write `src/server/highlight.fn.ts`**

```typescript
import { createServerFn } from "@tanstack/react-start"
import { postHighlight } from "./sidebar"

export const createHighlight = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string; note?: string; sourceUrl?: string; sourceTitle?: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    if (!data.text.trim()) return { ok: false, error: "empty selection" }
    try {
      const { id } = await postHighlight(data)
      return { ok: true, id }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
```

- [ ] **Step 3: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/sidebar.ts src/server/highlight.fn.ts && git commit -m "feat(server): postHighlight + createHighlight server fn"
```

---

### Task 4: Text-selection hook + floating highlighter

**Files:**
- Create: `src/hooks/useTextSelection.ts`
- Create: `src/components/SelectionHighlighter.tsx`

- [ ] **Step 1: Write `src/hooks/useTextSelection.ts`**

```typescript
import { useEffect, useState } from "react"

export interface SelectionState {
  text: string
  x: number
  y: number
}

export function useTextSelection(containerId: string): { selection: SelectionState | null; clear: () => void } {
  const [selection, setSelection] = useState<SelectionState | null>(null)

  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ""
      const container = document.getElementById(containerId)
      if (!sel || sel.rangeCount === 0 || text.length < 4 || !container) {
        setSelection(null)
        return
      }
      const anchor = sel.anchorNode
      if (!anchor || !container.contains(anchor)) {
        setSelection(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setSelection({ text, x: rect.left + rect.width / 2, y: rect.top })
    }
    document.addEventListener("mouseup", onUp)
    return () => document.removeEventListener("mouseup", onUp)
  }, [containerId])

  return { selection, clear: () => setSelection(null) }
}
```

- [ ] **Step 2: Write `src/components/SelectionHighlighter.tsx`**

```tsx
import { Button } from "@mantine/core"
import { useState } from "react"
import { useTextSelection } from "~/hooks/useTextSelection"
import { createHighlight } from "~/server/highlight.fn"
import type { LibraryItem } from "~/lib/library"

export function SelectionHighlighter({
  containerId, item, onSaved,
}: { containerId: string; item: LibraryItem; onSaved: () => void }) {
  const { selection, clear } = useTextSelection(containerId)
  const [busy, setBusy] = useState(false)
  if (!selection) return null

  const save = async () => {
    setBusy(true)
    await createHighlight({
      data: { text: selection.text, sourceUrl: item.url, sourceTitle: item.title },
    })
    setBusy(false)
    clear()
    window.getSelection()?.removeAllRanges()
    onSaved()
  }

  return (
    <Button
      size="xs"
      radius="xl"
      loading={busy}
      onClick={() => void save()}
      style={{
        position: "fixed",
        left: selection.x,
        top: selection.y - 44,
        transform: "translateX(-50%)",
        zIndex: 300,
      }}
    >
      ✦ Save highlight
    </Button>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/hooks/useTextSelection.ts src/components/SelectionHighlighter.tsx && git commit -m "feat(reader): text-selection hook + floating Save-highlight button"
```

---

### Task 5: Reader renders paragraphs + wires highlighter

**Files:**
- Modify: `src/components/viewers/ReadingView.tsx`
- Modify: `src/routes/item.$source.$id.tsx` (pass an onSaved that invalidates)

- [ ] **Step 1: Rewrite `src/components/viewers/ReadingView.tsx`**

```tsx
import { Stack, Title, Text, Anchor, Group, Badge } from "@mantine/core"
import type { LibraryItem } from "~/lib/library"
import { splitParagraphs } from "~/lib/paragraphs"
import { SelectionHighlighter } from "~/components/SelectionHighlighter"

const READER_ID = "reader-body"

export function ReadingView({ item, onSaved }: { item: LibraryItem; onSaved: () => void }) {
  const paragraphs = splitParagraphs(item.excerpt ?? "")
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
      <div id={READER_ID}>
        {paragraphs.length > 0 ? (
          paragraphs.map((p, i) => (
            <Text key={i} mb="md" style={{ fontSize: 19, lineHeight: 1.7 }}>{p}</Text>
          ))
        ) : (
          <Text c="dimmed">No reader text yet — open the original above.</Text>
        )}
      </div>
      <SelectionHighlighter containerId={READER_ID} item={item} onSaved={onSaved} />
    </Stack>
  )
}
```

- [ ] **Step 2: Update `src/routes/item.$source.$id.tsx`** — pass `onSaved` to `ReadingView` and `HighlightView` is unchanged. Add router invalidation:

At top add `import { useRouter } from "@tanstack/react-router"`. In `ItemDetail`, after `const { item } = Route.useLoaderData()` add `const router = useRouter()`. Change the ReadingView render line to:
```tsx
          {(item.type === "link" ||
            item.type === "article" ||
            item.type === "webpage" ||
            item.type === "bookmark") && (
            <ReadingView item={item} onSaved={() => router.invalidate()} />
          )}
```

- [ ] **Step 3: Build**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Run dev and create a highlight**

Run: `cd ~/Development/copythe-hub && pnpm dev`, open localhost. Add an article URL via Add New, open it, select a sentence in the body → the floating "✦ Save highlight" appears → click it. Go back to the library: a new Highlight card shows the saved quote. Stop with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/components/viewers/ReadingView.tsx src/routes/item.\$source.\$id.tsx && git commit -m "feat(reader): paragraph reader + select-to-save-highlight"
```

---

### Task 6: Deploy + verify

- [ ] **Step 1: Deploy** — `cd ~/Development/copythe-hub && pnpm run deploy` (expect success).
- [ ] **Step 2: Verify** — `curl -s -o /dev/null -w "%{http_code}\n" https://hub.copythe.link/` → `302`. Authenticated: add article → read → select → save highlight → appears.
- [ ] **Step 3: Push** — `cd ~/Development/copythe-hub && git push`.

---

## Self-Review

**Spec coverage (Phase 4 highlights portion):** select text in reader → create highlight ✓ (Tasks 4,5), stored via `/api/highlights` ✓ (Task 3), highlight appears as a card ✓ (existing normalizeHighlight + invalidate). Reader renders article body ✓ (Tasks 1,2,5). **Deferred (noted):** timestamped/transcript video highlights → Plan 6 (no video data yet); precise text-anchor re-find (prefix/suffix) → not needed for create+list MVP; the saved highlight carries the quote + source.

**Placeholder scan:** No TODO/TBD. The "verify field names in highlights.ts" notes are correctness guards against the real route, with a concrete default (camelCase) — the engineer confirms against one file.

**Type consistency:** `extractArticle` now returns `text` (Task 1) consumed by `ingestUrl` (Task 2). `postHighlight(NewHighlight)` (Task 3) matches `createHighlight`'s call. `createHighlight({data:{text,note?,sourceUrl?,sourceTitle?}})` (Task 3) matches `SelectionHighlighter`'s call (Task 4). `useTextSelection(containerId)` returns `{selection, clear}` used in Task 4. `ReadingView` now takes `{item, onSaved}` (Task 5) — the only caller is `item.$source.$id.tsx`, updated in the same task. `splitParagraphs` (Task 1) used in `ReadingView` (Task 5).

**Risks:** `window.getSelection` rect positioning and the server-fn highlight write are the bets; both exercised by the Task 5 live create. The highlights POST body field-name match is guarded by a verify-against-route note.
