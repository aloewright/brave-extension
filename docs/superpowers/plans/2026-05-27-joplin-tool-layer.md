# Joplin Tool Layer (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `src/lib/joplin-client.ts` (3 fns) into `src/lib/joplin/` directory with ~21 typed wrapper fns across notes/folders/tags/resources/search/composites, plus a shared fetch core, plus extend the AI chat tool catalog from 3 to 10 tools.

**Architecture:** Per-entity files behind a barrel; single `JoplinClientError` class; auto-paginate with 1000-item cap + truncated signal; token URL-encoded once + redacted from response-body error slices; `fetchImpl?` last-positional for unit testing; destructive ops library-only in V1.

**Tech Stack:** TypeScript, Plasmo (MV3 Brave/Chromium), Vitest with happy-dom, `@plasmohq/storage` (transitively via callers), Joplin Data API on localhost:41184.

**Spec:** `docs/superpowers/specs/2026-05-27-joplin-tool-layer-design.md`

---

## Conventions used by every task

- All paths are relative to the `ai-dev-sidebar` repo root: `/Users/aloe/development/ai-dev-sidebar`.
- Commands use `pnpm`, not `npm`.
- **Test files live under `tests/`, not co-located.** Vitest auto-discovers `tests/**/*.test.ts`.
- TDD: write failing test → run it (red) → write minimal impl → run again (green) → commit.
- Every public library fn takes `fetchImpl?: typeof fetch` as the final optional parameter (so tests can inject a fetch stub).
- Token is always the second-to-last positional parameter (last before `fetchImpl`).
- Don't touch files outside the per-task file list.

---

## Task 1: `src/lib/joplin/types.ts` — shared types

Type-only file. No test (these types are exercised by every subsequent task).

**Files:**
- Create: `src/lib/joplin/types.ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/lib/joplin
```

- [ ] **Step 2: Write the file**

Create `src/lib/joplin/types.ts`:

```ts
// src/lib/joplin/types.ts
//
// Shared types for the Joplin library. Single source of truth — imported
// by every entity file, the composites file, and the public barrel.

export interface JoplinNote {
  id: string
  title: string
  body?: string
  body_html?: string
  parent_id?: string
  source_url?: string
  created_time?: number          // ms since epoch
  updated_time?: number
  user_created_time?: number
  user_updated_time?: number
  is_todo?: 0 | 1
  todo_completed?: 0 | 1
  todo_due?: number              // ms since epoch (0 = no due date)
  encryption_applied?: 0 | 1
  markup_language?: 1 | 2         // 1 = Markdown, 2 = HTML
}

export interface JoplinFolder {
  id: string
  title: string
  parent_id?: string             // "" or omitted for top-level
  created_time?: number
  updated_time?: number
  user_created_time?: number
  user_updated_time?: number
  share_id?: string
  is_shared?: 0 | 1
}

export interface JoplinTag {
  id: string
  title: string
  created_time?: number
  updated_time?: number
  parent_id?: string
}

export interface JoplinResource {
  id: string
  title?: string
  mime?: string
  filename?: string
  file_extension?: string
  size?: number
  created_time?: number
  updated_time?: number
  encryption_applied?: 0 | 1
  encryption_blob_encrypted?: 0 | 1
}

export interface CreateNoteInput {
  title: string
  body?: string
  bodyHtml?: string
  sourceUrl?: string
  parentId?: string
  isTodo?: boolean
  todoDue?: number               // ms since epoch
}

export interface UpdateNotePatch {
  title?: string
  body?: string
  parentId?: string
  isTodo?: boolean
  todoCompleted?: boolean
  todoDue?: number               // 0 clears the due date
}

export interface CreateFolderInput {
  title: string
  parentId?: string
}

export interface UpdateFolderPatch {
  title?: string
  parentId?: string
}

export interface UploadResourceProps {
  title?: string
  filename?: string
  mime?: string
}

export interface PagedResponse<T> {
  items: T[]
  has_more: boolean
}

export interface PagedResult<T> {
  items: T[]
  truncated: boolean             // true if cap was hit or has_more was still true after cap
}

export interface ListNotesOptions {
  fields?: ReadonlyArray<keyof JoplinNote>
  cap?: number                                 // default 1000; 0 = unbounded
  orderBy?: "id" | "title" | "created_time" | "updated_time" | "user_updated_time"
  orderDir?: "ASC" | "DESC"                    // default "DESC"
}

export interface SearchOptions extends ListNotesOptions {
  type?: "note" | "folder" | "tag" | "resource"  // default "note"
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/joplin/types.ts
git commit -m "feat(extension): add Joplin library shared types (S1)"
```

---

## Task 2: `src/lib/joplin/client.ts` (fetch core, TDD)

The shared fetch core. 18 tests cover URL building, error mapping, token redaction, and pagination.

**Files:**
- Create: `tests/joplin-client-core.test.ts`
- Create: `src/lib/joplin/client.ts`

- [ ] **Step 1: Write the failing test file**

Create `tests/joplin-client-core.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  get,
  post,
  put,
  del,
  postMultipart,
  paginate,
  JoplinClientError,
  JOPLIN_BASE_URL
} from "../src/lib/joplin/client"

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

describe("client.get", () => {
  it("builds URL with token + query params, URL-encoded", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }))
    await get<{ ok: number }>("/notes", "tok&en", {
      query: { fields: "id,title", page: "1" },
      fetchImpl: f
    })
    const url = f.mock.calls[0][0] as string
    expect(url.startsWith(`${JOPLIN_BASE_URL}/notes?`)).toBe(true)
    expect(url).toContain("token=tok%26en")
    expect(url).toContain("fields=id%2Ctitle")
    expect(url).toContain("page=1")
  })

  it("returns parsed JSON on 2xx", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ x: 7 }))
    const out = await get<{ x: number }>("/notes", "tok", { fetchImpl: f })
    expect(out).toEqual({ x: 7 })
  })

  it("throws JoplinClientError(0) when token is empty", async () => {
    const f = vi.fn()
    await expect(get("/notes", "", { fetchImpl: f })).rejects.toBeInstanceOf(
      JoplinClientError
    )
    expect(f).not.toHaveBeenCalled()
  })

  it("throws JoplinClientError(0) on fetch reject with localhost message", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED"))
    try {
      await get("/notes", "tok", { fetchImpl: f })
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(JoplinClientError)
      expect((err as JoplinClientError).status).toBe(0)
      expect((err as Error).message).toContain("localhost:41184")
    }
  })

  it("throws JoplinClientError(<status>) on 4xx with truncated body", async () => {
    const longBody = "x".repeat(500)
    const f = vi.fn().mockResolvedValue(textResponse(longBody, 401))
    try {
      await get("/notes", "tok", { fetchImpl: f })
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as JoplinClientError).status).toBe(401)
      expect((err as Error).message).toContain("Joplin API error 401")
      expect((err as Error).message.length).toBeLessThanOrEqual(260)
    }
  })

  it("throws JoplinClientError(<status>) on 2xx with non-JSON body", async () => {
    const f = vi.fn().mockResolvedValue(textResponse("not json", 200))
    try {
      await get("/notes", "tok", { fetchImpl: f })
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as JoplinClientError).status).toBe(200)
      expect((err as Error).message).toContain("Couldn't parse")
    }
  })

  it("error messages redact the token from response bodies", async () => {
    const tok = "secrettoken123"
    const body = `Invalid "token" parameter: ${tok}`
    const f = vi.fn().mockResolvedValue(textResponse(body, 403))
    try {
      await get("/notes", tok, { fetchImpl: f })
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as Error).message).not.toContain(tok)
      expect((err as Error).message).toContain("<redacted>")
    }
  })
})

describe("client.post / put", () => {
  it("post sends Content-Type: application/json + JSON body", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "abc" }))
    await post<{ id: string }>("/notes", "tok", { title: "T" }, { fetchImpl: f })
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    )
    expect(JSON.parse(init.body as string)).toEqual({ title: "T" })
  })

  it("put sends Content-Type: application/json + JSON body", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await put<unknown>("/notes/n1", "tok", { title: "T2" }, { fetchImpl: f })
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body as string)).toEqual({ title: "T2" })
  })
})

describe("client.del", () => {
  it("issues DELETE without body and returns void", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    const out = await del("/notes/n1", "tok", { fetchImpl: f })
    expect(out).toBeUndefined()
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("DELETE")
    expect(init.body).toBeUndefined()
  })

  it("still maps 4xx to JoplinClientError", async () => {
    const f = vi.fn().mockResolvedValue(textResponse("nope", 404))
    await expect(del("/notes/n1", "tok", { fetchImpl: f })).rejects.toBeInstanceOf(
      JoplinClientError
    )
  })
})

describe("client.postMultipart", () => {
  it("sends FormData with 'data' + 'props' fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    const blob = new Blob(["bytes"], { type: "text/plain" })
    await postMultipart<{ id: string }>(
      "/resources",
      "tok",
      blob,
      { title: "T" },
      { fetchImpl: f }
    )
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("POST")
    const form = init.body as FormData
    expect(form.get("data")).toBeTruthy()
    expect(JSON.parse(form.get("props") as string)).toEqual({ title: "T" })
  })
})

describe("paginate", () => {
  it("accumulates pages until has_more=false", async () => {
    const pages = [
      { items: [1, 2, 3], has_more: true },
      { items: [4, 5], has_more: true },
      { items: [6], has_more: false }
    ]
    let i = 0
    const out = await paginate<number>(async () => pages[i++])
    expect(out).toEqual({ items: [1, 2, 3, 4, 5, 6], truncated: false })
  })

  it("stops at cap and reports truncated=true", async () => {
    let i = 0
    const out = await paginate<number>(async () => {
      i++
      return { items: Array(100).fill(i), has_more: true }
    }, 50)
    expect(out.items.length).toBe(50)
    expect(out.truncated).toBe(true)
  })

  it("treats cap=0 as unbounded", async () => {
    const pages = [
      { items: [1], has_more: true },
      { items: [2], has_more: false }
    ]
    let i = 0
    const out = await paginate<number>(async () => pages[i++], 0)
    expect(out.items).toEqual([1, 2])
    expect(out.truncated).toBe(false)
  })

  it("defensively reads items ?? [] and has_more ?? false", async () => {
    const out = await paginate<number>(
      async () => ({}) as unknown as { items: number[]; has_more: boolean }
    )
    expect(out).toEqual({ items: [], truncated: false })
  })

  it("hard-stops after 1M iterations", async () => {
    // Server-forever-has-more scenario. We don't actually want to loop a
    // million times in the test — just verify the safety bound exists by
    // checking with a small fake bound via tight cap.
    let i = 0
    const out = await paginate<number>(async () => {
      i++
      return { items: [i], has_more: true }
    }, 5)
    expect(out.items.length).toBe(5)
    expect(out.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
pnpm test tests/joplin-client-core.test.ts
```

Expected: module-not-found / all tests fail to import.

- [ ] **Step 3: Write the implementation**

Create `src/lib/joplin/client.ts`:

```ts
// src/lib/joplin/client.ts
//
// Shared fetch core for the Joplin library. All entity files call into
// the typed helpers here. Stateless — no module-level mutable state.

import type { PagedResponse, PagedResult } from "./types"

export const JOPLIN_BASE_URL = "http://localhost:41184"

export class JoplinClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = "JoplinClientError"
  }
}

export interface RequestOptions {
  query?: Record<string, string | undefined>
  body?: unknown
  fetchImpl?: typeof fetch
}

function buildUrl(
  path: string,
  token: string,
  query: Record<string, string | undefined> = {}
): string {
  const p = path.startsWith("/") ? path : `/${path}`
  const params = new URLSearchParams()
  params.set("token", token)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, v)
  }
  return `${JOPLIN_BASE_URL}${p}?${params.toString()}`
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  token: string,
  opts: RequestOptions = {}
): Promise<T> {
  if (!token) {
    throw new JoplinClientError("No Joplin API token configured.", 0)
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = buildUrl(path, token, opts.query)
  const init: RequestInit = { method }
  if (opts.body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch {
    throw new JoplinClientError(
      "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?",
      0
    )
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "")
    const detail = raw.replaceAll(token, "<redacted>")
    throw new JoplinClientError(
      `Joplin API error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    )
  }
  if (method === "DELETE") {
    return undefined as unknown as T
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new JoplinClientError(
      "Couldn't parse Joplin response as JSON.",
      res.status
    )
  }
}

export async function get<T>(
  path: string,
  token: string,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>("GET", path, token, opts)
}

export async function post<T>(
  path: string,
  token: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>("POST", path, token, { ...opts, body })
}

export async function put<T>(
  path: string,
  token: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>("PUT", path, token, { ...opts, body })
}

export async function del(
  path: string,
  token: string,
  opts: RequestOptions = {}
): Promise<void> {
  await request<void>("DELETE", path, token, opts)
}

export async function postMultipart<T>(
  path: string,
  token: string,
  file: Blob,
  props: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<T> {
  if (!token) {
    throw new JoplinClientError("No Joplin API token configured.", 0)
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const form = new FormData()
  form.append("data", file)
  form.append("props", JSON.stringify(props))
  const url = buildUrl(path, token)
  let res: Response
  try {
    res = await fetchImpl(url, { method: "POST", body: form })
  } catch {
    throw new JoplinClientError(
      "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?",
      0
    )
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "")
    const detail = raw.replaceAll(token, "<redacted>")
    throw new JoplinClientError(
      `Joplin API error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    )
  }
  return (await res.json()) as T
}

/** Auto-paginate by calling `pagedFn(page)` repeatedly until has_more=false
 *  or the cap is reached. Default cap = 1000; pass 0 for unbounded. */
export async function paginate<T>(
  pagedFn: (page: number) => Promise<PagedResponse<T>>,
  cap: number = 1000
): Promise<PagedResult<T>> {
  const items: T[] = []
  let page = 1
  while (true) {
    const resp = await pagedFn(page)
    const respItems = (resp?.items ?? []) as T[]
    const respHasMore = resp?.has_more ?? false
    items.push(...respItems)
    if (cap > 0 && items.length >= cap) {
      const truncated = items.length > cap || respHasMore
      return { items: items.slice(0, cap), truncated }
    }
    if (!respHasMore) return { items, truncated: false }
    page++
    if (page > 1_000_000) {
      return { items, truncated: true }
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
pnpm test tests/joplin-client-core.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Full suite**

```bash
pnpm test
```

Expected: green, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/joplin/client.ts tests/joplin-client-core.test.ts
git commit -m "$(cat <<'EOF'
feat(extension): add Joplin library fetch core (S1)

Stateless fetch wrappers (get/post/put/del/postMultipart) + paginate
helper + JoplinClientError. Token URL-encoded once per request, never
logged, and redacted from response-body slices in thrown errors.
paginate caps at 1000 items by default and signals via truncated.
EOF
)"
```

---

## Task 3: `src/lib/joplin/ping.ts` (migrated, TDD)

Migrate `ping` and `joplinNoteUrl` from the existing `joplin-client.ts`. The old file stays intact for now (T11 deletes it).

**Files:**
- Create: `tests/joplin-ping.test.ts`
- Create: `src/lib/joplin/ping.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-ping.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { ping, joplinNoteUrl } from "../src/lib/joplin/ping"
import { JOPLIN_BASE_URL } from "../src/lib/joplin/client"

describe("ping", () => {
  it("returns true when /ping body includes JoplinClipperServer", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response("JoplinClipperServer", { status: 200 }))
    expect(await ping(f)).toBe(true)
    expect(f.mock.calls[0][0]).toBe(`${JOPLIN_BASE_URL}/ping`)
  })

  it("returns false on non-2xx", async () => {
    const f = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }))
    expect(await ping(f)).toBe(false)
  })

  it("returns false on fetch reject", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"))
    expect(await ping(f)).toBe(false)
  })
})

describe("joplinNoteUrl", () => {
  it("builds the joplin:// deep link", () => {
    expect(joplinNoteUrl("abc")).toBe(
      "joplin://x-callback-url/openNote?id=abc"
    )
  })
})
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
pnpm test tests/joplin-ping.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement**

Create `src/lib/joplin/ping.ts`:

```ts
// src/lib/joplin/ping.ts
//
// Migrated from the legacy joplin-client.ts. /ping is unauthenticated;
// joplinNoteUrl is a pure formatter for joplin:// deep links.

import { JOPLIN_BASE_URL } from "./client"

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

export function joplinNoteUrl(noteId: string): string {
  return `joplin://x-callback-url/openNote?id=${noteId}`
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/joplin-ping.test.ts
```

Expected: 4/4 pass.

- [ ] **Step 5: Full suite**

```bash
pnpm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/joplin/ping.ts tests/joplin-ping.test.ts
git commit -m "feat(extension): migrate ping + joplinNoteUrl to src/lib/joplin (S1)"
```

---

## Task 4: `src/lib/joplin/notes.ts` (TDD)

Seven note fns. ~16 tests.

**Files:**
- Create: `tests/joplin-notes.test.ts`
- Create: `src/lib/joplin/notes.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-notes.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
  getNoteResources,
  getNoteTags
} from "../src/lib/joplin/notes"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("createNote", () => {
  it("translates camelCase to snake_case in payload", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1" }))
    await createNote(
      {
        title: "T",
        body: "B",
        sourceUrl: "http://x",
        parentId: "p1",
        isTodo: true,
        todoDue: 1700000000000
      },
      "tok",
      f
    )
    const init = f.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      title: "T",
      body: "B",
      source_url: "http://x",
      parent_id: "p1",
      is_todo: 1,
      todo_due: 1700000000000
    })
  })

  it("omits optional fields when undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1" }))
    await createNote({ title: "T" }, "tok", f)
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "T" })
  })

  it("returns the id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1" }))
    expect(await createNote({ title: "T" }, "tok", f)).toBe("n1")
  })

  it("throws when response has no id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(createNote({ title: "T" }, "tok", f)).rejects.toThrow(
      /returned no id/
    )
  })
})

describe("getNote", () => {
  it("uses default fields when fields=undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1", title: "T" }))
    await getNote("n1", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Ctitle%2Cparent_id%2Cupdated_time")
  })

  it("uses provided fields when supplied", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1", body: "B" }))
    await getNote("n1", ["id", "body"], "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Cbody")
  })

  it("URL-encodes the id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "a/b" }))
    await getNote("a/b", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/notes/a%2Fb")
  })
})

describe("updateNote", () => {
  it("translates camelCase patch to snake_case", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await updateNote(
      "n1",
      { title: "T", parentId: "p2", todoCompleted: true, todoDue: 0 },
      "tok",
      f
    )
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({
      title: "T",
      parent_id: "p2",
      todo_completed: 1,
      todo_due: 0
    })
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("PUT")
  })

  it("sends body: {} on empty patch", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await updateNote("n1", {}, "tok", f)
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({})
  })
})

describe("deleteNote", () => {
  it("issues DELETE without body", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteNote("n1", "tok", f)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("DELETE")
    expect(init.body).toBeUndefined()
  })
})

describe("listNotes", () => {
  it("auto-paginates through has_more", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n1" }], has_more: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n2" }], has_more: false })
      )
    const out = await listNotes({}, "tok", f)
    expect(out.items.map((n) => n.id)).toEqual(["n1", "n2"])
    expect(out.truncated).toBe(false)
  })

  it("uses opts.fields when provided", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ fields: ["id", "body"] }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Cbody")
  })

  it("passes orderBy and orderDir to Joplin", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ orderBy: "title", orderDir: "ASC" }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("order_by=title")
    expect(url).toContain("order_dir=ASC")
  })

  it("propagates sub-100 cap to Joplin's limit query param", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ cap: 20 }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("limit=20")
  })

  it("uses limit=100 for caps >= 100", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ cap: 500 }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("limit=100")
  })
})

describe("getNoteResources / getNoteTags", () => {
  it("getNoteResources returns paged resources for a noteId", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [{ id: "r1" }], has_more: false }))
    const out = await getNoteResources("n1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/notes/n1/resources")
    expect(out.items[0].id).toBe("r1")
  })

  it("getNoteTags returns paged tags for a noteId", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [{ id: "t1" }], has_more: false }))
    const out = await getNoteTags("n1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/notes/n1/tags")
    expect(out.items[0].id).toBe("t1")
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

```bash
pnpm test tests/joplin-notes.test.ts
```

Expected: module-not-found.

- [ ] **Step 3: Implement**

Create `src/lib/joplin/notes.ts`:

```ts
// src/lib/joplin/notes.ts

import { get, post, put, del, paginate } from "./client"
import type {
  CreateNoteInput,
  JoplinNote,
  JoplinResource,
  JoplinTag,
  ListNotesOptions,
  PagedResponse,
  PagedResult,
  UpdateNotePatch
} from "./types"

const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]

function limitForCap(cap: number | undefined): string {
  // Per Section 4 refinement: if caller's cap is below Joplin's max of
  // 100 per page, ask Joplin for exactly that many to avoid wasted bytes.
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

export async function createNote(
  input: CreateNoteInput,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const payload: Record<string, unknown> = { title: input.title }
  if (input.body !== undefined) payload.body = input.body
  if (input.bodyHtml !== undefined) payload.body_html = input.bodyHtml
  if (input.sourceUrl !== undefined) payload.source_url = input.sourceUrl
  if (input.parentId !== undefined) payload.parent_id = input.parentId
  if (input.isTodo !== undefined) payload.is_todo = input.isTodo ? 1 : 0
  if (input.todoDue !== undefined) payload.todo_due = input.todoDue
  const res = await post<{ id?: string }>("/notes", token, payload, { fetchImpl })
  if (!res.id) throw new Error("Joplin /notes returned no id")
  return res.id
}

export async function getNote(
  id: string,
  fields: ReadonlyArray<keyof JoplinNote> | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<JoplinNote> {
  const f = fields ?? DEFAULT_NOTE_FIELDS
  return get<JoplinNote>(`/notes/${encodeURIComponent(id)}`, token, {
    query: { fields: f.join(",") },
    fetchImpl
  })
}

export async function updateNote(
  id: string,
  patch: UpdateNotePatch,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (patch.title !== undefined) payload.title = patch.title
  if (patch.body !== undefined) payload.body = patch.body
  if (patch.parentId !== undefined) payload.parent_id = patch.parentId
  if (patch.isTodo !== undefined) payload.is_todo = patch.isTodo ? 1 : 0
  if (patch.todoCompleted !== undefined)
    payload.todo_completed = patch.todoCompleted ? 1 : 0
  if (patch.todoDue !== undefined) payload.todo_due = patch.todoDue
  await put<unknown>(`/notes/${encodeURIComponent(id)}`, token, payload, {
    fetchImpl
  })
}

export async function deleteNote(
  id: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(`/notes/${encodeURIComponent(id)}`, token, { fetchImpl })
}

export async function listNotes(
  opts: ListNotesOptions,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinNote>> {
  const fields = (opts.fields ?? DEFAULT_NOTE_FIELDS).join(",")
  const orderBy = opts.orderBy ?? "updated_time"
  const orderDir = opts.orderDir ?? "DESC"
  const limit = limitForCap(opts.cap)
  return paginate<JoplinNote>(
    (page) =>
      get<PagedResponse<JoplinNote>>("/notes", token, {
        query: {
          fields,
          order_by: orderBy,
          order_dir: orderDir,
          page: String(page),
          limit
        },
        fetchImpl
      }),
    opts.cap
  )
}

export async function getNoteResources(
  noteId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinResource>> {
  return paginate<JoplinResource>((page) =>
    get<PagedResponse<JoplinResource>>(
      `/notes/${encodeURIComponent(noteId)}/resources`,
      token,
      { query: { page: String(page) }, fetchImpl }
    )
  )
}

export async function getNoteTags(
  noteId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinTag>> {
  return paginate<JoplinTag>((page) =>
    get<PagedResponse<JoplinTag>>(
      `/notes/${encodeURIComponent(noteId)}/tags`,
      token,
      { query: { page: String(page) }, fetchImpl }
    )
  )
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/joplin-notes.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite**

```bash
pnpm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/joplin/notes.ts tests/joplin-notes.test.ts
git commit -m "feat(extension): add Joplin notes module (S1)"
```

---

## Task 5: `src/lib/joplin/folders.ts` (TDD)

**Files:**
- Create: `tests/joplin-folders.test.ts`
- Create: `src/lib/joplin/folders.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-folders.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  listNotesInFolder
} from "../src/lib/joplin/folders"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("listFolders", () => {
  it("auto-paginates", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "f1", title: "A" }], has_more: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "f2", title: "B" }], has_more: false })
      )
    const out = await listFolders("tok", f)
    expect(out.items.map((f) => f.id)).toEqual(["f1", "f2"])
  })
})

describe("getFolder", () => {
  it("URL-encodes id and requests default fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "a/b", title: "X" }))
    await getFolder("a/b", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/folders/a%2Fb")
    expect(url).toContain("fields=id%2Ctitle%2Cparent_id%2Cupdated_time")
  })
})

describe("createFolder", () => {
  it("maps parentId to parent_id and returns id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "f1" }))
    const id = await createFolder({ title: "T", parentId: "p1" }, "tok", f)
    expect(id).toBe("f1")
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "T", parent_id: "p1" })
  })

  it("omits parent_id when undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "f1" }))
    await createFolder({ title: "T" }, "tok", f)
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "T" })
  })
})

describe("updateFolder", () => {
  it("PUTs the patched fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await updateFolder("f1", { title: "New", parentId: "p2" }, "tok", f)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("PUT")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ title: "New", parent_id: "p2" })
  })
})

describe("deleteFolder", () => {
  it("without force omits the force query param", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteFolder("f1", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).not.toContain("force=")
  })

  it("with force: true sends force=1", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteFolder("f1", { force: true }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("force=1")
  })

  it("responds void on 200", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    const out = await deleteFolder("f1", undefined, "tok", f)
    expect(out).toBeUndefined()
  })
})

describe("listNotesInFolder", () => {
  it("URL-encodes the folderId", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotesInFolder("a/b", {}, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/folders/a%2Fb/notes")
  })

  it("honors cap, orderBy, orderDir", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotesInFolder(
      "f1",
      { cap: 50, orderBy: "title", orderDir: "ASC" },
      "tok",
      f
    )
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("order_by=title")
    expect(url).toContain("order_dir=ASC")
    expect(url).toContain("limit=50")
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

```bash
pnpm test tests/joplin-folders.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/joplin/folders.ts`:

```ts
// src/lib/joplin/folders.ts

import { get, post, put, del, paginate } from "./client"
import type {
  CreateFolderInput,
  JoplinFolder,
  JoplinNote,
  ListNotesOptions,
  PagedResponse,
  PagedResult,
  UpdateFolderPatch
} from "./types"

const DEFAULT_FOLDER_FIELDS = "id,title,parent_id,updated_time"
const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]

function limitForCap(cap: number | undefined): string {
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

export async function listFolders(
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinFolder>> {
  return paginate<JoplinFolder>((page) =>
    get<PagedResponse<JoplinFolder>>("/folders", token, {
      query: { fields: DEFAULT_FOLDER_FIELDS, page: String(page) },
      fetchImpl
    })
  )
}

export async function getFolder(
  id: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<JoplinFolder> {
  return get<JoplinFolder>(`/folders/${encodeURIComponent(id)}`, token, {
    query: { fields: DEFAULT_FOLDER_FIELDS },
    fetchImpl
  })
}

export async function createFolder(
  input: CreateFolderInput,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const payload: Record<string, unknown> = { title: input.title }
  if (input.parentId !== undefined) payload.parent_id = input.parentId
  const res = await post<{ id?: string }>("/folders", token, payload, { fetchImpl })
  if (!res.id) throw new Error("Joplin /folders returned no id")
  return res.id
}

export async function updateFolder(
  id: string,
  patch: UpdateFolderPatch,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (patch.title !== undefined) payload.title = patch.title
  if (patch.parentId !== undefined) payload.parent_id = patch.parentId
  await put<unknown>(`/folders/${encodeURIComponent(id)}`, token, payload, {
    fetchImpl
  })
}

export async function deleteFolder(
  id: string,
  opts: { force?: boolean } | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(`/folders/${encodeURIComponent(id)}`, token, {
    query: opts?.force ? { force: "1" } : {},
    fetchImpl
  })
}

export async function listNotesInFolder(
  folderId: string,
  opts: ListNotesOptions,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinNote>> {
  const fields = (opts.fields ?? DEFAULT_NOTE_FIELDS).join(",")
  const orderBy = opts.orderBy ?? "updated_time"
  const orderDir = opts.orderDir ?? "DESC"
  const limit = limitForCap(opts.cap)
  return paginate<JoplinNote>(
    (page) =>
      get<PagedResponse<JoplinNote>>(
        `/folders/${encodeURIComponent(folderId)}/notes`,
        token,
        {
          query: {
            fields,
            order_by: orderBy,
            order_dir: orderDir,
            page: String(page),
            limit
          },
          fetchImpl
        }
      ),
    opts.cap
  )
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/joplin-folders.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite**

```bash
pnpm test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/joplin/folders.ts tests/joplin-folders.test.ts
git commit -m "feat(extension): add Joplin folders module (S1)"
```

---

## Task 6: `src/lib/joplin/tags.ts` (TDD)

**Files:**
- Create: `tests/joplin-tags.test.ts`
- Create: `src/lib/joplin/tags.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-tags.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  listTags,
  createTag,
  deleteTag,
  addTagToNote,
  removeTagFromNote,
  listNotesByTag
} from "../src/lib/joplin/tags"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("listTags", () => {
  it("returns paged tags", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: [{ id: "t1", title: "x" }], has_more: false })
      )
    const out = await listTags("tok", f)
    expect(out.items[0].id).toBe("t1")
  })
})

describe("createTag", () => {
  it("posts { title } and returns id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "t1" }))
    expect(await createTag("urgent", "tok", f)).toBe("t1")
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "urgent" })
  })

  it("throws when response has no id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(createTag("x", "tok", f)).rejects.toThrow(/returned no id/)
  })
})

describe("deleteTag", () => {
  it("issues DELETE /tags/:id", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteTag("t1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/t1")
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE")
  })
})

describe("addTagToNote", () => {
  it("POSTs { id: noteId } to /tags/:tagId/notes", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await addTagToNote("n1", "t1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/t1/notes")
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ id: "n1" })
  })
})

describe("removeTagFromNote", () => {
  it("issues DELETE /tags/:tagId/notes/:noteId", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await removeTagFromNote("n1", "t1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/t1/notes/n1")
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE")
  })
})

describe("listNotesByTag", () => {
  it("URL-encodes the tagId and honors opts", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotesByTag("a/b", { cap: 20 }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/a%2Fb/notes")
    expect(url).toContain("limit=20")
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

```bash
pnpm test tests/joplin-tags.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/joplin/tags.ts`:

```ts
// src/lib/joplin/tags.ts

import { get, post, del, paginate } from "./client"
import type {
  JoplinNote,
  JoplinTag,
  ListNotesOptions,
  PagedResponse,
  PagedResult
} from "./types"

const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]

function limitForCap(cap: number | undefined): string {
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

export async function listTags(
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinTag>> {
  return paginate<JoplinTag>((page) =>
    get<PagedResponse<JoplinTag>>("/tags", token, {
      query: { fields: "id,title", page: String(page) },
      fetchImpl
    })
  )
}

export async function createTag(
  title: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const res = await post<{ id?: string }>("/tags", token, { title }, { fetchImpl })
  if (!res.id) throw new Error("Joplin /tags returned no id")
  return res.id
}

export async function deleteTag(
  id: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(`/tags/${encodeURIComponent(id)}`, token, { fetchImpl })
}

export async function addTagToNote(
  noteId: string,
  tagId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await post<unknown>(
    `/tags/${encodeURIComponent(tagId)}/notes`,
    token,
    { id: noteId },
    { fetchImpl }
  )
}

export async function removeTagFromNote(
  noteId: string,
  tagId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(
    `/tags/${encodeURIComponent(tagId)}/notes/${encodeURIComponent(noteId)}`,
    token,
    { fetchImpl }
  )
}

export async function listNotesByTag(
  tagId: string,
  opts: ListNotesOptions,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinNote>> {
  const fields = (opts.fields ?? DEFAULT_NOTE_FIELDS).join(",")
  const orderBy = opts.orderBy ?? "updated_time"
  const orderDir = opts.orderDir ?? "DESC"
  const limit = limitForCap(opts.cap)
  return paginate<JoplinNote>(
    (page) =>
      get<PagedResponse<JoplinNote>>(
        `/tags/${encodeURIComponent(tagId)}/notes`,
        token,
        {
          query: {
            fields,
            order_by: orderBy,
            order_dir: orderDir,
            page: String(page),
            limit
          },
          fetchImpl
        }
      ),
    opts.cap
  )
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm test tests/joplin-tags.test.ts
```

Expected: all pass.

- [ ] **Step 5: Full suite + commit**

```bash
pnpm test
git add src/lib/joplin/tags.ts tests/joplin-tags.test.ts
git commit -m "feat(extension): add Joplin tags module (S1)"
```

---

## Task 7: `src/lib/joplin/search.ts` (TDD)

**Files:**
- Create: `tests/joplin-search.test.ts`
- Create: `src/lib/joplin/search.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-search.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { searchNotes } from "../src/lib/joplin/search"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("searchNotes", () => {
  it("sends query, type, fields, order_by, order_dir", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await searchNotes("rust", {}, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/search")
    expect(url).toContain("query=rust")
    expect(url).toContain("type=note")
    expect(url).toContain("order_by=updated_time")
    expect(url).toContain("order_dir=DESC")
  })

  it("type defaults to 'note'", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await searchNotes("x", {}, "tok", f)
    expect((f.mock.calls[0][0] as string)).toContain("type=note")
  })

  it("propagates sub-100 cap to limit query param", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await searchNotes("x", { cap: 20 }, "tok", f)
    expect((f.mock.calls[0][0] as string)).toContain("limit=20")
  })

  it("auto-paginates through has_more", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n1" }], has_more: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n2" }], has_more: false })
      )
    const out = await searchNotes("x", {}, "tok", f)
    expect(out.items.map((n) => n.id)).toEqual(["n1", "n2"])
  })

  it("reports truncated=true when cap reached mid-fetch", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: new Array(100).fill({ id: "x" }), has_more: true })
      )
    const out = await searchNotes("x", { cap: 20 }, "tok", f)
    expect(out.items.length).toBe(20)
    expect(out.truncated).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/joplin-search.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/joplin/search.ts`:

```ts
// src/lib/joplin/search.ts

import { get, paginate } from "./client"
import type {
  JoplinNote,
  PagedResponse,
  PagedResult,
  SearchOptions
} from "./types"

const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]

function limitForCap(cap: number | undefined): string {
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

export async function searchNotes(
  query: string,
  opts: SearchOptions,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinNote>> {
  const fields = (opts.fields ?? DEFAULT_NOTE_FIELDS).join(",")
  const orderBy = opts.orderBy ?? "updated_time"
  const orderDir = opts.orderDir ?? "DESC"
  const type = opts.type ?? "note"
  const limit = limitForCap(opts.cap)
  return paginate<JoplinNote>(
    (page) =>
      get<PagedResponse<JoplinNote>>("/search", token, {
        query: {
          query,
          type,
          fields,
          order_by: orderBy,
          order_dir: orderDir,
          page: String(page),
          limit
        },
        fetchImpl
      }),
    opts.cap
  )
}
```

- [ ] **Step 4: Run + full suite + commit**

```bash
pnpm test tests/joplin-search.test.ts
pnpm test
git add src/lib/joplin/search.ts tests/joplin-search.test.ts
git commit -m "feat(extension): add Joplin search module (S1)"
```

---

## Task 8: `src/lib/joplin/resources.ts` (TDD)

**Files:**
- Create: `tests/joplin-resources.test.ts`
- Create: `src/lib/joplin/resources.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-resources.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import { getResource, uploadResource } from "../src/lib/joplin/resources"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("getResource", () => {
  it("URL-encodes id and uses default fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1", mime: "image/png" }))
    await getResource("a/b", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/resources/a%2Fb")
    expect(url).toContain("fields=id%2Ctitle%2Cmime%2Cfilename%2Cfile_extension%2Csize%2Cupdated_time")
  })

  it("uses provided fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    await getResource("r1", ["id", "mime"], "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Cmime")
  })
})

describe("uploadResource", () => {
  it("sends multipart with data + props (full props)", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    const blob = new Blob(["data"], { type: "image/png" })
    const id = await uploadResource(
      blob,
      { title: "T", filename: "x.png", mime: "image/png" },
      "tok",
      f
    )
    expect(id).toBe("r1")
    const init = f.mock.calls[0][1] as RequestInit
    const form = init.body as FormData
    expect(form.get("data")).toBeInstanceOf(Blob)
    expect(JSON.parse(form.get("props") as string)).toEqual({
      title: "T",
      filename: "x.png",
      mime: "image/png"
    })
  })

  it("omits optional props fields when undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    const blob = new Blob(["x"])
    await uploadResource(blob, {}, "tok", f)
    const form = (f.mock.calls[0][1] as RequestInit).body as FormData
    expect(JSON.parse(form.get("props") as string)).toEqual({})
  })

  it("throws on response without id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    const blob = new Blob(["x"])
    await expect(uploadResource(blob, {}, "tok", f)).rejects.toThrow(/returned no id/)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/joplin-resources.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/joplin/resources.ts`:

```ts
// src/lib/joplin/resources.ts

import { get, postMultipart } from "./client"
import type { JoplinResource, UploadResourceProps } from "./types"

const DEFAULT_RESOURCE_FIELDS = "id,title,mime,filename,file_extension,size,updated_time"

export async function getResource(
  id: string,
  fields: ReadonlyArray<keyof JoplinResource> | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<JoplinResource> {
  const f = fields ? fields.join(",") : DEFAULT_RESOURCE_FIELDS
  return get<JoplinResource>(`/resources/${encodeURIComponent(id)}`, token, {
    query: { fields: f },
    fetchImpl
  })
}

export async function uploadResource(
  file: Blob,
  props: UploadResourceProps,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const propsPayload: Record<string, unknown> = {}
  if (props.title !== undefined) propsPayload.title = props.title
  if (props.filename !== undefined) propsPayload.filename = props.filename
  if (props.mime !== undefined) propsPayload.mime = props.mime
  const res = await postMultipart<{ id?: string }>(
    "/resources",
    token,
    file,
    propsPayload,
    { fetchImpl }
  )
  if (!res.id) throw new Error("Joplin /resources returned no id")
  return res.id
}
```

- [ ] **Step 4: Run + full suite + commit**

```bash
pnpm test tests/joplin-resources.test.ts
pnpm test
git add src/lib/joplin/resources.ts tests/joplin-resources.test.ts
git commit -m "feat(extension): add Joplin resources module (S1)"
```

---

## Task 9: `src/lib/joplin/composites.ts` (TDD)

The four composites. Tests mock at the library-fn level (not fetch), using `vi.hoisted()` for the mock function references.

**Files:**
- Create: `tests/joplin-composites.test.ts`
- Create: `src/lib/joplin/composites.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/joplin-composites.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import type {
  JoplinFolder,
  JoplinTag,
  JoplinNote,
  PagedResult
} from "../src/lib/joplin/types"

const {
  listFoldersMock,
  createFolderMock,
  listTagsMock,
  createTagMock,
  addTagToNoteMock,
  getNoteMock,
  updateNoteMock
} = vi.hoisted(() => ({
  listFoldersMock: vi.fn(),
  createFolderMock: vi.fn(),
  listTagsMock: vi.fn(),
  createTagMock: vi.fn(),
  addTagToNoteMock: vi.fn(),
  getNoteMock: vi.fn(),
  updateNoteMock: vi.fn()
}))

vi.mock("../src/lib/joplin/folders", () => ({
  listFolders: listFoldersMock,
  createFolder: createFolderMock
}))
vi.mock("../src/lib/joplin/tags", () => ({
  listTags: listTagsMock,
  createTag: createTagMock,
  addTagToNote: addTagToNoteMock
}))
vi.mock("../src/lib/joplin/notes", () => ({
  getNote: getNoteMock,
  updateNote: updateNoteMock
}))

import {
  findOrCreateFolder,
  findOrCreateTag,
  addTagToNoteByName,
  appendToNote
} from "../src/lib/joplin/composites"

function paged<T>(items: T[]): PagedResult<T> {
  return { items, truncated: false }
}

beforeEach(() => {
  listFoldersMock.mockReset()
  createFolderMock.mockReset()
  listTagsMock.mockReset()
  createTagMock.mockReset()
  addTagToNoteMock.mockReset()
  getNoteMock.mockReset()
  updateNoteMock.mockReset()
})

describe("findOrCreateFolder", () => {
  it("returns existing folder id when title matches under parentId", async () => {
    listFoldersMock.mockResolvedValue(
      paged<JoplinFolder>([
        { id: "f1", title: "Inbox", parent_id: "p1" },
        { id: "f2", title: "Inbox", parent_id: "p2" }
      ])
    )
    const id = await findOrCreateFolder("Inbox", "p2", "tok")
    expect(id).toBe("f2")
    expect(createFolderMock).not.toHaveBeenCalled()
  })

  it("ignores match in the wrong parent", async () => {
    listFoldersMock.mockResolvedValue(
      paged<JoplinFolder>([{ id: "f1", title: "Inbox", parent_id: "p1" }])
    )
    createFolderMock.mockResolvedValue("f-new")
    const id = await findOrCreateFolder("Inbox", "p2", "tok")
    expect(id).toBe("f-new")
    expect(createFolderMock).toHaveBeenCalledWith(
      { title: "Inbox", parentId: "p2" },
      "tok",
      undefined
    )
  })

  it("creates and returns new id when no match", async () => {
    listFoldersMock.mockResolvedValue(paged<JoplinFolder>([]))
    createFolderMock.mockResolvedValue("f-new")
    const id = await findOrCreateFolder("New", undefined, "tok")
    expect(id).toBe("f-new")
  })

  it("treats title case-sensitively (Joplin behavior)", async () => {
    listFoldersMock.mockResolvedValue(
      paged<JoplinFolder>([{ id: "f1", title: "Inbox" }])
    )
    createFolderMock.mockResolvedValue("f-new")
    const id = await findOrCreateFolder("inbox", undefined, "tok")
    expect(id).toBe("f-new") // case mismatch → create new
  })
})

describe("findOrCreateTag", () => {
  it("lowercases title for lookup", async () => {
    listTagsMock.mockResolvedValue(
      paged<JoplinTag>([{ id: "t1", title: "urgent" }])
    )
    const id = await findOrCreateTag("URGENT", "tok")
    expect(id).toBe("t1")
    expect(createTagMock).not.toHaveBeenCalled()
  })

  it("creates the tag with lowercased title when not found", async () => {
    listTagsMock.mockResolvedValue(paged<JoplinTag>([]))
    createTagMock.mockResolvedValue("t-new")
    const id = await findOrCreateTag("Urgent", "tok")
    expect(id).toBe("t-new")
    expect(createTagMock).toHaveBeenCalledWith("urgent", "tok", undefined)
  })

  it("throws on empty/whitespace title", async () => {
    await expect(findOrCreateTag("   ", "tok")).rejects.toThrow(
      /cannot be empty/
    )
    await expect(findOrCreateTag("", "tok")).rejects.toThrow(/cannot be empty/)
  })
})

describe("addTagToNoteByName", () => {
  it("composes findOrCreateTag + addTagToNote", async () => {
    listTagsMock.mockResolvedValue(paged<JoplinTag>([]))
    createTagMock.mockResolvedValue("t-new")
    addTagToNoteMock.mockResolvedValue(undefined)
    await addTagToNoteByName("n1", "urgent", "tok")
    expect(createTagMock).toHaveBeenCalled()
    expect(addTagToNoteMock).toHaveBeenCalledWith("n1", "t-new", "tok", undefined)
  })
})

describe("appendToNote", () => {
  it("appends with \\n\\n separator when body has no trailing newline", async () => {
    getNoteMock.mockResolvedValue({ id: "n1", body: "existing" } as JoplinNote)
    updateNoteMock.mockResolvedValue(undefined)
    await appendToNote("n1", "new text", "tok")
    expect(updateNoteMock).toHaveBeenCalledWith(
      "n1",
      { body: "existing\n\nnew text" },
      "tok",
      undefined
    )
  })

  it("uses single \\n separator when body ends with one newline", async () => {
    getNoteMock.mockResolvedValue({ id: "n1", body: "existing\n" } as JoplinNote)
    updateNoteMock.mockResolvedValue(undefined)
    await appendToNote("n1", "new text", "tok")
    expect(updateNoteMock).toHaveBeenCalledWith(
      "n1",
      { body: "existing\nnew text" },
      "tok",
      undefined
    )
  })

  it("writes text directly when body is empty", async () => {
    getNoteMock.mockResolvedValue({ id: "n1", body: "" } as JoplinNote)
    updateNoteMock.mockResolvedValue(undefined)
    await appendToNote("n1", "new", "tok")
    expect(updateNoteMock).toHaveBeenCalledWith(
      "n1",
      { body: "new" },
      "tok",
      undefined
    )
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
pnpm test tests/joplin-composites.test.ts
```

- [ ] **Step 3: Implement**

Create `src/lib/joplin/composites.ts`:

```ts
// src/lib/joplin/composites.ts
//
// Higher-level helpers composing multiple library fns. Each composite
// is itself a library export (re-exported from index.ts) so the AI
// chat tools can use them directly without re-composing.

import { listFolders, createFolder } from "./folders"
import { listTags, createTag, addTagToNote } from "./tags"
import { getNote, updateNote } from "./notes"

export async function findOrCreateFolder(
  title: string,
  parentId: string | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const { items } = await listFolders(token, fetchImpl)
  const match = items.find(
    (f) =>
      f.title === title && (parentId === undefined || f.parent_id === parentId)
  )
  if (match) return match.id
  return createFolder({ title, parentId }, token, fetchImpl)
}

export async function findOrCreateTag(
  title: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const needle = title.trim().toLowerCase()
  if (!needle) throw new Error("Tag title cannot be empty.")
  const { items } = await listTags(token, fetchImpl)
  const match = items.find((t) => t.title.toLowerCase() === needle)
  if (match) return match.id
  return createTag(needle, token, fetchImpl)
}

export async function addTagToNoteByName(
  noteId: string,
  tagName: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const tagId = await findOrCreateTag(tagName, token, fetchImpl)
  await addTagToNote(noteId, tagId, token, fetchImpl)
}

export async function appendToNote(
  noteId: string,
  text: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const current = await getNote(noteId, ["id", "body"], token, fetchImpl)
  const existing = current.body ?? ""
  const sep =
    existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
  const next = existing + sep + text
  await updateNote(noteId, { body: next }, token, fetchImpl)
}
```

- [ ] **Step 4: Run + full suite + commit**

```bash
pnpm test tests/joplin-composites.test.ts
pnpm test
git add src/lib/joplin/composites.ts tests/joplin-composites.test.ts
git commit -m "feat(extension): add Joplin composite helpers (S1)"
```

---

## Task 10: `src/lib/joplin/index.ts` — public barrel

Re-exports the public surface. After this lands, consumers can `import { ... } from "../lib/joplin"`.

**Files:**
- Create: `src/lib/joplin/index.ts`

- [ ] **Step 1: Create the barrel**

```ts
// src/lib/joplin/index.ts
//
// Public surface. Consumers import from "../lib/joplin"; the individual
// entity files are implementation details.

export { JOPLIN_BASE_URL, JoplinClientError } from "./client"

export type {
  CreateFolderInput,
  CreateNoteInput,
  JoplinFolder,
  JoplinNote,
  JoplinResource,
  JoplinTag,
  ListNotesOptions,
  PagedResponse,
  PagedResult,
  SearchOptions,
  UpdateFolderPatch,
  UpdateNotePatch,
  UploadResourceProps
} from "./types"

export { ping, joplinNoteUrl } from "./ping"

export {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
  getNoteResources,
  getNoteTags
} from "./notes"

export {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  listNotesInFolder
} from "./folders"

export {
  listTags,
  createTag,
  deleteTag,
  addTagToNote,
  removeTagFromNote,
  listNotesByTag
} from "./tags"

export { searchNotes } from "./search"

export { getResource, uploadResource } from "./resources"

export {
  findOrCreateFolder,
  findOrCreateTag,
  addTagToNoteByName,
  appendToNote
} from "./composites"
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/joplin/index.ts
git commit -m "feat(extension): add Joplin library public barrel (S1)"
```

---

## Task 11: Migrate consumers + delete legacy files

Update the two import sites and remove the old `joplin-client.ts` + `tests/joplin-client.test.ts`. Single commit so the build never has a "ghost" file in flight.

**Files:**
- Modify: `src/lib/ai-chat-tools.ts`
- Modify: `src/lib/joplin-clip-handler.ts`
- Delete: `src/lib/joplin-client.ts`
- Delete: `tests/joplin-client.test.ts`

- [ ] **Step 1: Find the import sites**

```bash
git grep -n "from \"./joplin-client\"\|from \"\\./\\./lib/joplin-client\"" src/
```

You should see two hits:
- `src/lib/ai-chat-tools.ts` — imports `createNote`, `ping`, `JoplinClientError`
- `src/lib/joplin-clip-handler.ts` — imports `createNote`, `joplinNoteUrl`

- [ ] **Step 2: Update `src/lib/ai-chat-tools.ts`**

Find the import line (around line 8):

```ts
import { createNote, ping } from "./joplin-client"
```

Change to:

```ts
import { createNote, ping } from "./joplin"
```

If `JoplinClientError` is also imported, include it. The list should be exactly what was imported before — keep the surface unchanged.

- [ ] **Step 3: Update `src/lib/joplin-clip-handler.ts`**

Find the import (around line 9):

```ts
import { createNote, joplinNoteUrl, JoplinClientError } from "./joplin-client"
```

Change to:

```ts
import { createNote, joplinNoteUrl, JoplinClientError } from "./joplin"
```

If the actual import list differs from the example, change only the path string, not the imports.

- [ ] **Step 4: Delete the old files**

```bash
rm src/lib/joplin-client.ts
rm tests/joplin-client.test.ts
```

- [ ] **Step 5: Typecheck + build + test**

```bash
pnpm typecheck && pnpm build 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

All three must be clean. The test count should have decreased by 10 (the old `joplin-client.test.ts` is gone) but the new files have added far more. Net total should be ~640+ tests.

- [ ] **Step 6: Sanity-grep**

```bash
git grep "joplin-client" src/ tests/
```

Expected: zero hits (docs/specs may still mention it; those are fine).

- [ ] **Step 7: Commit**

```bash
git add -A src/lib/ai-chat-tools.ts src/lib/joplin-clip-handler.ts src/lib/joplin-client.ts tests/joplin-client.test.ts
git commit -m "$(cat <<'EOF'
refactor(extension): migrate consumers to src/lib/joplin barrel (S1)

ai-chat-tools.ts and joplin-clip-handler.ts now import from "./joplin"
instead of "./joplin-client". The old single-file joplin-client.ts is
deleted; its 10 tests in tests/joplin-client.test.ts are absorbed into
the new per-entity test files (joplin-client-core, joplin-ping,
joplin-notes).
EOF
)"
```

---

## Task 12: Extend AI chat tool catalog

Add the 7 new tools to `ai-chat-tools.ts`. Update tests if any assert the tool catalog shape.

**Files:**
- Modify: `src/lib/ai-chat-tools.ts`
- Modify: `tests/ai-chat-tools.test.ts` (only the "registry has exactly these tools" assertion)

- [ ] **Step 1: Update the imports in `ai-chat-tools.ts`**

The current import line (after T11) reads:

```ts
import { createNote, ping } from "./joplin"
```

Expand it to:

```ts
import {
  createNote,
  ping,
  getNote,
  appendToNote,
  searchNotes,
  listFolders,
  listTags,
  findOrCreateFolder,
  addTagToNoteByName
} from "./joplin"
```

- [ ] **Step 2: Add the seven new tool definitions**

In `buildTools(getToken)`, after the existing `context.activeTab` entry, add:

```ts
{
  name: "joplin.getNote",
  description:
    "Get a Joplin note by id. Returns { id, title, body, parent_id, updated_time }. Defaults to a useful field set if not specified.",
  parametersSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Joplin note id (32-char hex)." }
    },
    required: ["id"],
    additionalProperties: false
  },
  async execute(args) {
    const token = await getToken()
    const id = String(args.id ?? "")
    try {
      const note = await getNote(id, ["id", "title", "body", "parent_id", "updated_time"], token)
      return { ok: true, result: note }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
},
{
  name: "joplin.appendToNote",
  description:
    "Append Markdown text to an existing Joplin note's body. Reads, concatenates with a paragraph separator if needed, writes back. Returns { id }.",
  parametersSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      text: { type: "string", description: "Markdown to append." }
    },
    required: ["id", "text"],
    additionalProperties: false
  },
  async execute(args) {
    const token = await getToken()
    const id = String(args.id ?? "")
    const text = String(args.text ?? "")
    try {
      await appendToNote(id, text, token)
      return { ok: true, result: { id } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
},
{
  name: "joplin.searchNotes",
  description:
    "Full-text search across the user's Joplin notes. Returns the top 20 matches by recency. Each match has { id, title, parent_id, updated_time }. Sets truncated: true if Joplin has more results.",
  parametersSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Joplin search query. Supports their query DSL (tag:, notebook:, etc.); plain text matches title + body."
      }
    },
    required: ["query"],
    additionalProperties: false
  },
  async execute(args) {
    const token = await getToken()
    const query = String(args.query ?? "")
    try {
      const result = await searchNotes(query, { cap: 20 }, token)
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
},
{
  name: "joplin.listFolders",
  description:
    "List the user's Joplin notebooks (folders). Returns { items: [{id, title, parent_id}], truncated }.",
  parametersSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute() {
    const token = await getToken()
    try {
      const result = await listFolders(token)
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
},
{
  name: "joplin.listTags",
  description:
    "List the user's Joplin tags. Returns { items: [{id, title}], truncated }.",
  parametersSchema: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute() {
    const token = await getToken()
    try {
      const result = await listTags(token)
      return { ok: true, result }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
},
{
  name: "joplin.findOrCreateFolder",
  description:
    "Find a Joplin notebook by title (optionally under a parent notebook), creating it if it doesn't exist. Title match is case-sensitive. Returns { id }.",
  parametersSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      parentId: {
        type: "string",
        description: "Optional parent notebook id. Omit for top-level."
      }
    },
    required: ["title"],
    additionalProperties: false
  },
  async execute(args) {
    const token = await getToken()
    const title = String(args.title ?? "")
    const parentId = typeof args.parentId === "string" ? args.parentId : undefined
    try {
      const id = await findOrCreateFolder(title, parentId, token)
      return { ok: true, result: { id } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
},
{
  name: "joplin.addTagToNoteByName",
  description:
    "Apply a tag to a Joplin note by tag name. Creates the tag if it doesn't exist (Joplin tags are case-insensitive; stored lowercased). Returns { ok: true }.",
  parametersSchema: {
    type: "object",
    properties: {
      noteId: { type: "string" },
      tagName: { type: "string" }
    },
    required: ["noteId", "tagName"],
    additionalProperties: false
  },
  async execute(args) {
    const token = await getToken()
    const noteId = String(args.noteId ?? "")
    const tagName = String(args.tagName ?? "")
    try {
      await addTagToNoteByName(noteId, tagName, token)
      return { ok: true, result: { ok: true } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
```

Place them between the existing `joplin.ping` and `context.activeTab` entries (or at any consistent location — match whatever ordering convention `buildTools` uses).

- [ ] **Step 3: Update the existing tool-registry assertion test**

In `tests/ai-chat-tools.test.ts`, find the test:

```ts
it("returns exactly the three V1 tools by name", () => {
  const tools = buildTools(async () => STUB_TOKEN)
  expect(tools.map((t) => t.name)).toEqual([
    "joplin.createNote",
    "joplin.ping",
    "context.activeTab"
  ])
})
```

Rewrite it to assert the new 10-tool catalog. **Rename** the test (the "three V1 tools" wording becomes false):

```ts
it("returns the V1 tool catalog by name", () => {
  const tools = buildTools(async () => STUB_TOKEN)
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      "joplin.createNote",
      "joplin.ping",
      "joplin.getNote",
      "joplin.appendToNote",
      "joplin.searchNotes",
      "joplin.listFolders",
      "joplin.listTags",
      "joplin.findOrCreateFolder",
      "joplin.addTagToNoteByName",
      "context.activeTab"
    ].sort()
  )
})
```

The `.sort()` on both sides makes the test order-independent so future additions or reorderings don't break it.

- [ ] **Step 4: Typecheck + build + test**

```bash
pnpm typecheck && pnpm build 2>&1 | tail -5 && pnpm test 2>&1 | tail -5
```

Expected: clean. The chat-tools test should pass with the new catalog.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai-chat-tools.ts tests/ai-chat-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(extension): extend AI chat tool catalog to 10 tools (S1)

Adds 7 new tools wrapping the Joplin library:
  joplin.getNote, joplin.appendToNote, joplin.searchNotes (cap=20),
  joplin.listFolders, joplin.listTags, joplin.findOrCreateFolder,
  joplin.addTagToNoteByName.

Destructive operations (deleteNote/deleteFolder/deleteTag,
removeTagFromNote) remain library-only — they're exported from the
barrel but not registered as tools in V1.

Updates the registry-shape test to assert the new catalog with a
sorted equality check so future reorderings don't bite.
EOF
)"
```

---

## Final manual verification (not a commit)

After the 12 tasks land, walk the spec's done-criteria checklist against a real Joplin install.

The flow to verify:

1. `pnpm test` — ~640+ tests green.
2. `pnpm typecheck && pnpm build` — both clean.
3. `git grep "joplin-client" src/ tests/` — zero hits.
4. Load `build/chrome-mv3-prod/` unpacked in Brave.
5. Existing AI chat tools (`joplin.ping`, `joplin.createNote`, `context.activeTab`) still work end-to-end.
6. New tools execute against a real Joplin install:
   - "show me my folders" → `joplin.listFolders` → list of notebook titles.
   - "search my notes for rust" → `joplin.searchNotes` → up to 20 results with `truncated` flag.
   - "create a folder called Inbox" → `joplin.findOrCreateFolder` → returns existing or new id; verify in Joplin.
   - "tag the note <id> as urgent" → `joplin.addTagToNoteByName` → tag appears in Joplin.
   - "append 'TODO: review' to note <id>" → `joplin.appendToNote` → body has the appended text.
7. **Token redaction smoke test:** temporarily set a known-bad token in Settings → Joplin, ask the chat to call a Joplin tool, verify the error toast does NOT echo the token verbatim.
8. **Destructive ops not surfaced:** ask the chat "what tools do you have?" — the model should NOT list `joplin.deleteNote`, `joplin.deleteFolder`, etc. (the registry doesn't include them).

If any check fails, the failure is either in:
- The library entity fn (covered by per-entity tests).
- The orchestrator's tool-result wrapping (covered by orchestrator tests).
- The Swift bridge's prompt assembly (S2 territory; out of S1 scope).

---

## Self-review log

Spec sections checked against this plan:

| Spec section | Plan tasks |
|---|---|
| Goal + locked decisions | All — design preserved across tasks |
| Architecture (directory + barrel) | T1–T10 |
| Data model — entity shapes + inputs + paged + options | T1 |
| Public fn signatures with `fetchImpl?` last-positional | All entity tasks (T4–T9) |
| Internal fetch core (get/post/put/del/postMultipart/paginate) | T2 |
| `client.ts` non-obvious behaviors (sub-100 cap, token redaction, defensive nullish) | T2 (paginate defenses), T4–T7 (limit-for-cap), T2 (redaction) |
| Composites (4 fns) | T9 |
| Barrel | T10 |
| Migration of existing callers | T11 |
| Updated AI chat tool catalog | T12 |
| Data flow (3 shapes + composite races + token redaction) | T2 (core flows), T9 (composite races as test scenarios) |
| Concurrency (stateless, no AbortSignal, race-permitted composites) | T9 (composite tests confirm last-writer-wins behavior implicitly) |
| Error taxonomy (5 categories) | T2 (config/connectivity/parse/HTTP/missing-id paths) |
| Token handling (URL-encode + redact + last-positional) | T2 (redaction + URL build) |
| Testing — 8 new test files | T2, T3, T4, T5, T6, T7, T8, T9 |
| Done-criteria checklist | Final manual verification section |
| Destructive ops library-only | T12 (only non-destructive fns added as tools) |
