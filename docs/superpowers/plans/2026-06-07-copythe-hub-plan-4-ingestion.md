# copythe-hub — Plan 4: Ingestion (paste URL + upload)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Add New" work. Paste a URL → the hub fetches it, classifies it (article / image / pdf), extracts a title + excerpt for articles via Readability, and saves it to sidebar-api. Upload an image or PDF → stored as a capture. New items appear in the library immediately.

**Architecture:** A pure **classifier** decides the type from content-type/URL. A pure **Readability wrapper** (linkedom DOM + `@mozilla/readability`) turns article HTML into `{ title, excerpt, textLength }`. An `ingestUrl` server function orchestrates fetch → classify → extract → write to the existing sidebar-api endpoints (`POST /api/links` for articles/links, `POST /api/captures` raw-bytes for image/pdf). An `uploadCapture` server function stores an uploaded file. The "Add New" modal calls them and invalidates the library loader.

**Tech Stack:** `@mozilla/readability`, `linkedom`, TanStack Start `createServerFn`, Mantine `Modal`/`Dropzone`, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-design.md` (Phase 5 of §14 — done before Phase 4 because highlights/reader need content to exist). MVP stores articles as enriched **links** (title + excerpt + `article` tag); full reader-body text + Vectorize indexing of the body is a later enhancement requiring sidebar-api article columns (§6) and does not block this plan.

**Repo:** `~/Development/copythe-hub`.

**sidebar-api write endpoints (verified):**
- `POST /api/links` JSON `{ url, title, description?, tags?, favicon?, source? }`
- `POST /api/captures` raw body bytes + headers `X-Capture-Kind: screenshot|pdf`, `X-Capture-Filename` (percent-encoded), `X-Capture-Page-Url?`, `X-Capture-Page-Title?`, and `content-type`.

---

## File Structure

```
src/
  lib/
    classify.ts          # pure: classifyContent(url, contentType) → "article"|"image"|"pdf"
    readability.ts       # pure-ish: extractArticle(html, url) → {title,excerpt,textLength}
  server/
    sidebar.ts           # MODIFY: postLink(), postCapture(bytes, meta)
    ingest.fn.ts         # ingestUrl, uploadCapture server fns
  components/
    AddNewModal.tsx      # URL field + dropzone + states
  routes/
    index.tsx            # MODIFY: wire Add New button → modal, invalidate on success
tests/
    classify.test.ts
    readability.test.ts
```

---

### Task 1: Content classifier (TDD)

**Files:**
- Create: `src/lib/classify.ts`
- Test: `tests/classify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/classify.test.ts
import { describe, it, expect } from "vitest"
import { classifyContent } from "~/lib/classify"

describe("classifyContent", () => {
  it("classifies a pdf by content-type", () => {
    expect(classifyContent("https://x.com/p", "application/pdf")).toBe("pdf")
  })
  it("classifies a pdf by .pdf url when content-type is generic", () => {
    expect(classifyContent("https://x.com/file.pdf", "application/octet-stream")).toBe("pdf")
  })
  it("classifies an image by content-type", () => {
    expect(classifyContent("https://x.com/p", "image/png")).toBe("image")
  })
  it("classifies html as article", () => {
    expect(classifyContent("https://x.com/post", "text/html; charset=utf-8")).toBe("article")
  })
  it("defaults unknown to article", () => {
    expect(classifyContent("https://x.com/p", "")).toBe("article")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/classify.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/classify.ts`**

```typescript
export type IngestKind = "article" | "image" | "pdf"

export function classifyContent(url: string, contentType: string): IngestKind {
  const ct = contentType.toLowerCase()
  const u = url.toLowerCase()
  if (ct.includes("application/pdf") || /\.pdf($|\?)/.test(u)) return "pdf"
  if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif)($|\?)/.test(u)) return "image"
  return "article"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/classify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/lib/classify.ts tests/classify.test.ts && git commit -m "feat(ingest): pure content classifier (article/image/pdf)"
```

---

### Task 2: Readability wrapper (TDD)

**Files:**
- Create: `src/lib/readability.ts`
- Test: `tests/readability.test.ts`

- [ ] **Step 1: Install deps**

Run: `cd ~/Development/copythe-hub && pnpm add @mozilla/readability linkedom`
Expected: both added.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/readability.test.ts
import { describe, it, expect } from "vitest"
import { extractArticle } from "~/lib/readability"

const HTML = `<!doctype html><html><head><title>Fallback Title</title></head>
<body><article><h1>The Real Headline</h1>
<p>${"Sentence one is reasonably long so Readability keeps it. ".repeat(8)}</p>
<p>${"A second paragraph of meaningful body content here. ".repeat(8)}</p>
</article></body></html>`

describe("extractArticle", () => {
  it("pulls a title and a non-empty excerpt from article HTML", () => {
    const out = extractArticle(HTML, "https://x.com/post")
    expect(out.title.length).toBeGreaterThan(0)
    expect(out.excerpt.length).toBeGreaterThan(20)
    expect(out.textLength).toBeGreaterThan(50)
  })

  it("falls back to <title> when no article content", () => {
    const out = extractArticle(
      "<!doctype html><html><head><title>Only Title</title></head><body></body></html>",
      "https://x.com",
    )
    expect(out.title).toBe("Only Title")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/readability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/lib/readability.ts`**

```typescript
import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"

export interface ExtractedArticle {
  title: string
  excerpt: string
  textLength: number
}

export function extractArticle(html: string, url: string): ExtractedArticle {
  const { document } = parseHTML(html)
  const docTitle = document.querySelector("title")?.textContent?.trim() ?? ""
  try {
    // Readability mutates the document; linkedom's document is compatible.
    const article = new Readability(document as unknown as Document).parse()
    if (article && (article.textContent ?? "").trim().length > 0) {
      const text = (article.textContent ?? "").replace(/\s+/g, " ").trim()
      return {
        title: (article.title || docTitle || url).trim(),
        excerpt: (article.excerpt || text.slice(0, 280)).trim(),
        textLength: text.length,
      }
    }
  } catch {
    // fall through to title-only
  }
  return { title: docTitle || url, excerpt: "", textLength: 0 }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Development/copythe-hub && pnpm vitest run tests/readability.test.ts`
Expected: PASS (2 tests). If linkedom's `document` type upsets Readability under tsc, the `as unknown as Document` cast (already present) resolves it.

- [ ] **Step 6: Commit**

```bash
cd ~/Development/copythe-hub && git add src/lib/readability.ts tests/readability.test.ts package.json pnpm-lock.yaml && git commit -m "feat(ingest): Readability article extractor (linkedom DOM)"
```

---

### Task 3: sidebar-api write helpers

**Files:**
- Modify: `src/server/sidebar.ts`

- [ ] **Step 1: Append to `src/server/sidebar.ts`**

```typescript
export interface NewLink {
  url: string; title: string; description?: string; tags?: string[]; favicon?: string
}
export async function postLink(link: NewLink): Promise<{ id: string }> {
  const res = await fetch(`${base()}/api/links`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ ...link, source: "hub" }),
  })
  if (!res.ok) throw new Error(`postLink failed (${res.status})`)
  return (await res.json()) as { id: string }
}

export interface CaptureMeta {
  kind: "screenshot" | "pdf"; filename: string; contentType: string
  pageUrl?: string; pageTitle?: string
}
export async function postCapture(bytes: ArrayBuffer, meta: CaptureMeta): Promise<{ id: string }> {
  const h: Record<string, string> = {
    ...headers(),
    "content-type": meta.contentType,
    "x-capture-kind": meta.kind,
    "x-capture-filename": encodeURIComponent(meta.filename),
  }
  if (meta.pageUrl) h["x-capture-page-url"] = encodeURIComponent(meta.pageUrl)
  if (meta.pageTitle) h["x-capture-page-title"] = encodeURIComponent(meta.pageTitle)
  const res = await fetch(`${base()}/api/captures`, { method: "POST", headers: h, body: bytes })
  if (!res.ok) throw new Error(`postCapture failed (${res.status})`)
  return (await res.json()) as { id: string }
}
```

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/sidebar.ts && git commit -m "feat(bff): postLink + postCapture write helpers"
```

---

### Task 4: Ingestion server functions

**Files:**
- Create: `src/server/ingest.fn.ts`

- [ ] **Step 1: Write `src/server/ingest.fn.ts`**

```typescript
import { createServerFn } from "@tanstack/react-start"
import { postLink, postCapture } from "./sidebar"
import { classifyContent } from "~/lib/classify"
import { extractArticle } from "~/lib/readability"

function filenameFromUrl(url: string, ext: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split("/").filter(Boolean).pop() || u.hostname
    return /\.\w+$/.test(last) ? last : `${last}.${ext}`
  } catch {
    return `capture.${ext}`
  }
}

export const ingestUrl = createServerFn({ method: "POST" })
  .inputValidator((data: { url: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; kind: string; id?: string; error?: string }> => {
    let url = data.url.trim()
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
    try {
      const res = await fetch(url, { headers: { "user-agent": "copythe-hub/1.0" } })
      if (!res.ok) return { ok: false, kind: "unknown", error: `fetch failed (${res.status})` }
      const contentType = res.headers.get("content-type") ?? ""
      const kind = classifyContent(url, contentType)

      if (kind === "article") {
        const html = await res.text()
        const art = extractArticle(html, url)
        const { id } = await postLink({
          url, title: art.title, description: art.excerpt || undefined, tags: ["article"],
        })
        return { ok: true, kind, id }
      }
      const bytes = await res.arrayBuffer()
      const ext = kind === "pdf" ? "pdf" : "png"
      const { id } = await postCapture(bytes, {
        kind: kind === "pdf" ? "pdf" : "screenshot",
        filename: filenameFromUrl(url, ext),
        contentType: contentType || (kind === "pdf" ? "application/pdf" : "image/png"),
        pageUrl: url,
      })
      return { ok: true, kind, id }
    } catch (e) {
      return { ok: false, kind: "unknown", error: e instanceof Error ? e.message : String(e) }
    }
  })

export const uploadCapture = createServerFn({ method: "POST" })
  .inputValidator((data: FormData) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const file = data.get("file")
    if (!(file instanceof File)) return { ok: false, error: "no file" }
    const isPdf = file.type.includes("pdf") || /\.pdf$/i.test(file.name)
    try {
      const { id } = await postCapture(await file.arrayBuffer(), {
        kind: isPdf ? "pdf" : "screenshot",
        filename: file.name,
        contentType: file.type || (isPdf ? "application/pdf" : "image/png"),
      })
      return { ok: true, id }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
```

- [ ] **Step 2: Type-check**

Run: `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit`
Expected: no errors. (If `FormData`/`File` validator typing complains, ensure `lib` includes `DOM` — it does in tsconfig from Plan 1.)

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/server/ingest.fn.ts && git commit -m "feat(server): ingestUrl + uploadCapture server functions"
```

---

### Task 5: Add New modal

**Files:**
- Create: `src/components/AddNewModal.tsx`

- [ ] **Step 1: Install dropzone**

Run: `cd ~/Development/copythe-hub && pnpm add @mantine/dropzone`
Expected: added.

- [ ] **Step 2: Write `src/components/AddNewModal.tsx`**

```tsx
import { useState } from "react"
import { Modal, Tabs, TextInput, Button, Group, Text, Stack, Loader } from "@mantine/core"
import { Dropzone } from "@mantine/dropzone"
import "@mantine/dropzone/styles.css"
import { ingestUrl, uploadCapture } from "~/server/ingest.fn"

export function AddNewModal({
  opened, onClose, onAdded,
}: { opened: boolean; onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const done = (ok: boolean, err?: string) => {
    setBusy(false)
    if (ok) { setUrl(""); onAdded(); onClose() } else setError(err ?? "Failed")
  }

  const submitUrl = async () => {
    if (!url.trim()) return
    setBusy(true); setError(null)
    const r = await ingestUrl({ data: { url } })
    done(r.ok, r.error)
  }

  const submitFile = async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setBusy(true); setError(null)
    const fd = new FormData(); fd.set("file", file)
    const r = await uploadCapture({ data: fd })
    done(r.ok, r.error)
  }

  return (
    <Modal opened={opened} onClose={onClose} title="Add to your library" radius="lg" centered>
      <Tabs defaultValue="url">
        <Tabs.List mb="md">
          <Tabs.Tab value="url">Paste a link</Tabs.Tab>
          <Tabs.Tab value="upload">Upload</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="url">
          <Stack gap="sm">
            <TextInput
              placeholder="https://…  (article, image, or PDF)"
              value={url}
              onChange={(e) => setUrl(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitUrl() }}
              disabled={busy}
              radius="md"
            />
            <Group justify="flex-end">
              <Button onClick={() => void submitUrl()} disabled={busy || !url.trim()} radius="xl">
                {busy ? <Loader size="xs" color="white" /> : "Save"}
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="upload">
          <Dropzone onDrop={(f) => void submitFile(f)} loading={busy} radius="md"
            accept={["image/png", "image/jpeg", "image/webp", "application/pdf"]}>
            <Text ta="center" py="xl" c="dimmed">Drop an image or PDF, or click to pick</Text>
          </Dropzone>
        </Tabs.Panel>
      </Tabs>
      {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
    </Modal>
  )
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/Development/copythe-hub && git add src/components/AddNewModal.tsx package.json pnpm-lock.yaml && git commit -m "feat(ui): Add New modal (paste URL + upload)"
```

---

### Task 6: Wire the modal into the dashboard

**Files:**
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Add modal state, router invalidation, and open handler.** Edit the imports and `Home` component:

At the top, add:
```tsx
import { useRouter } from "@tanstack/react-router"
import { useDisclosure } from "@mantine/hooks"
import { AddNewModal } from "~/components/AddNewModal"
```

Inside `Home()`, after `const { items } = Route.useLoaderData()`, add:
```tsx
  const router = useRouter()
  const [addOpen, addHandlers] = useDisclosure(false)
```

Change the Add New button to:
```tsx
        <Button fullWidth onClick={addHandlers.open}>Add New</Button>
```

Before the closing `</AppShell>`, add:
```tsx
        <AddNewModal
          opened={addOpen}
          onClose={addHandlers.close}
          onAdded={() => router.invalidate()}
        />
```

- [ ] **Step 2: Build**

Run: `cd ~/Development/copythe-hub && pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Run dev and add a real URL**

Run: `cd ~/Development/copythe-hub && pnpm dev`, open the localhost URL, click **Add New**, paste a real article URL, Save.
Expected: modal closes, library refreshes, the new article card appears (type "Link", with extracted title + excerpt). Try an image URL and a PDF URL too. Stop with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/index.tsx && git commit -m "feat(dashboard): wire Add New modal + invalidate on success"
```

---

### Task 7: Deploy + verify

- [ ] **Step 1: Deploy**

Run: `cd ~/Development/copythe-hub && pnpm run deploy`
Expected: build + deploy succeed.

- [ ] **Step 2: Verify gating**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://hub.copythe.link/`
Expected: `302` (Access). Authenticated browser: Add New → paste URL → item appears.

- [ ] **Step 3: Push**

```bash
cd ~/Development/copythe-hub && git push
```

---

## Self-Review

**Spec coverage (Phase 5 of §14):** paste-URL → fetch + classify + extract ✓ (Tasks 1,2,4), article via Readability ✓ (Task 2), image/pdf via captures ✓ (Task 4), file upload ✓ (Tasks 4,5), Add New modal + library refresh ✓ (Tasks 5,6). **Deliberately deferred (noted):** full reader-body text + Vectorize indexing of article bodies needs sidebar-api article columns (spec §6) — MVP stores articles as enriched links (title+excerpt+article tag), which is searchable by title/excerpt today and upgrades cleanly later. Webpage full-screenshot snapshots are out of MVP (image/pdf/article cover the common cases).

**Placeholder scan:** No TODO/TBD. The deferred article-body indexing is an explicit scope line with a working fallback, not missing code.

**Type consistency:** `classifyContent(url, contentType)` (Task 1) is called in `ingestUrl` (Task 4). `extractArticle(html, url)` → `{title, excerpt, textLength}` (Task 2) consumed in Task 4. `postLink(NewLink)` and `postCapture(bytes, CaptureMeta)` (Task 3) match the calls in Task 4. `ingestUrl({data:{url}})` / `uploadCapture({data: FormData})` (Task 4) match the modal calls (Task 5). `onAdded`/`opened`/`onClose` modal props (Task 5) match the wiring (Task 6). `router.invalidate()` re-runs the `listLibrary` loader from Plan 2.

**Risks:** `@mozilla/readability` + `linkedom` running under the Workers runtime is the main bet — proven by `pnpm build` (bundles for workerd) + the Task 6 live add. Readability's `Document` typing is pre-cast. Server-function `FormData` input is the second bet, exercised by the Task 6 upload.
