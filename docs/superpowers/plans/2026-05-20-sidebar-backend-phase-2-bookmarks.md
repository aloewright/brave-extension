# Sidebar Backend — Phase 2: Bookmarks Snapshot

> **For agentic workers:** Phase 2 is small enough to land in one commit pass. Same TDD pattern as Phase 1 (test first, implement, verify, commit). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `/api/bookmarks` endpoints (snapshot push + list + read) so the extension can push the entire bookmark tree on every change and have it land in D1 + Vectorize with idempotent server-side diffing.

**Architecture:** Bookmarks are different from conversations/links — the source of truth is `chrome.bookmarks`, not the backend, so the extension treats the Worker as a write-through cache. One POST `/api/bookmarks/snapshot` accepts the full flattened tree and the server diffs: upserts present rows, deletes absent rows. Re-embed only when title or url changed.

**Tech Stack:** Same as Phase 1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-20-sidebar-backend-worker-design.md` §5.4.

---

## Task 1: Bookmark DB helpers

**Files:**
- Modify: `worker/src/db.ts` — add `BookmarkRow`, `getBookmark`, `listBookmarks`, `insertBookmark`, `updateBookmark`, `deleteBookmark`, `listAllBookmarkIdsAndContent` (for the diff)

- [ ] **Step 1: Add the row type + helpers** at the bottom of `worker/src/db.ts`

```ts
// ── Bookmark queries ───────────────────────────────────────────────────────
export interface BookmarkRow {
  id: string
  url: string
  title: string
  parent_id: string | null
  path: string                 // JSON array stored as TEXT
  category: string
  is_favorite: number          // 0 | 1
  date_added: number | null
  position: number | null
  chunk_count: number
  synced_at: number
}

export async function getBookmark(env: Env, id: string): Promise<BookmarkRow | null> {
  return (await env.DB.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<BookmarkRow>()) ?? null
}

export async function listBookmarks(
  env: Env,
  opts: { category?: string; favorite?: boolean; limit?: number } = {}
): Promise<BookmarkRow[]> {
  const limit = Math.min(opts.limit ?? 500, 2000)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.category) { where.push("category = ?"); binds.push(opts.category) }
  if (opts.favorite !== undefined) { where.push("is_favorite = ?"); binds.push(opts.favorite ? 1 : 0) }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM bookmarks ${whereSql} ORDER BY category, position LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<BookmarkRow>()
  return results ?? []
}

export async function insertBookmark(env: Env, row: BookmarkRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO bookmarks
       (id, url, title, parent_id, path, category, is_favorite,
        date_added, position, chunk_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.url, row.title, row.parent_id, row.path, row.category,
      row.is_favorite, row.date_added, row.position, row.chunk_count, row.synced_at
    )
    .run()
}

export async function updateBookmark(env: Env, row: BookmarkRow): Promise<void> {
  await env.DB.prepare(
    `UPDATE bookmarks SET
       url = ?, title = ?, parent_id = ?, path = ?, category = ?,
       is_favorite = ?, date_added = ?, position = ?, chunk_count = ?, synced_at = ?
     WHERE id = ?`
  )
    .bind(
      row.url, row.title, row.parent_id, row.path, row.category,
      row.is_favorite, row.date_added, row.position, row.chunk_count, row.synced_at,
      row.id
    )
    .run()
}

export async function deleteBookmark(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run()
}

/** Used by snapshot diff — returns the columns we need to detect changes. */
export async function listAllBookmarksDiffShape(
  env: Env
): Promise<{ id: string; url: string; title: string; chunk_count: number }[]> {
  const { results } = await env.DB
    .prepare("SELECT id, url, title, chunk_count FROM bookmarks")
    .all<{ id: string; url: string; title: string; chunk_count: number }>()
  return results ?? []
}
```

- [ ] **Step 2:** Add db tests at the bottom of `worker/tests/db.test.ts` (one for each new helper).

```ts
import {
  insertBookmark, getBookmark, listBookmarks, updateBookmark, deleteBookmark,
  listAllBookmarksDiffShape
} from "../src/db"

describe("db - bookmarks", () => {
  let env = makeEnv()
  beforeEach(() => { env = makeEnv() })

  function row(id: string, overrides: Partial<BookmarkRow> = {}): BookmarkRow {
    return {
      id, url: `https://${id}.example`, title: `t-${id}`, parent_id: null,
      path: "[]", category: "Unfiled", is_favorite: 0, date_added: null,
      position: null, chunk_count: 0, synced_at: 1,
      ...overrides
    }
  }

  it("inserts and reads a bookmark", async () => {
    await insertBookmark(env, row("b1"))
    const got = await getBookmark(env, "b1")
    expect(got?.title).toBe("t-b1")
  })

  it("filters by category", async () => {
    await insertBookmark(env, row("b1", { category: "Work" }))
    await insertBookmark(env, row("b2", { category: "Personal" }))
    const rows = await listBookmarks(env, { category: "Work" })
    expect(rows.map((r) => r.id)).toEqual(["b1"])
  })

  it("filters favorites", async () => {
    await insertBookmark(env, row("b1", { is_favorite: 1 }))
    await insertBookmark(env, row("b2", { is_favorite: 0 }))
    const favs = await listBookmarks(env, { favorite: true })
    expect(favs.map((r) => r.id)).toEqual(["b1"])
  })

  it("updates a bookmark", async () => {
    await insertBookmark(env, row("b1", { title: "old" }))
    await updateBookmark(env, row("b1", { title: "new", synced_at: 5 }))
    expect((await getBookmark(env, "b1"))?.title).toBe("new")
  })

  it("deletes a bookmark", async () => {
    await insertBookmark(env, row("b1"))
    await deleteBookmark(env, "b1")
    expect(await getBookmark(env, "b1")).toBeNull()
  })

  it("listAllBookmarksDiffShape returns the diff columns", async () => {
    await insertBookmark(env, row("b1", { chunk_count: 2 }))
    const all = await listAllBookmarksDiffShape(env)
    expect(all).toEqual([{ id: "b1", url: "https://b1.example", title: "t-b1", chunk_count: 2 }])
  })
})
```

- [ ] **Step 3:** Add the `BookmarkRow` import to the test's existing import line if needed.

- [ ] **Step 4: Run tests + typecheck**

```bash
cd worker && pnpm test db.test && pnpm typecheck
```
Expected: 15 db tests passing (9 from Phase 1 + 6 new), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db.ts worker/tests/db.test.ts
git commit -m "feat(worker): D1 helpers for bookmarks (insert/get/list/update/delete + diff)"
```

---

## Task 2: Bookmarks routes

**Files:**
- Create: `worker/src/routes/bookmarks.ts`
- Modify: `worker/src/index.ts` — mount `/api/bookmarks`
- Create: `worker/tests/routes/bookmarks.test.ts`

- [ ] **Step 1: Create the route file** `worker/src/routes/bookmarks.ts`

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteBookmark, getBookmark, insertBookmark, listAllBookmarksDiffShape,
  listBookmarks, updateBookmark, type BookmarkRow
} from "../db"
import { deleteFor, upsertFor } from "../vectors"

const bookmarks = new Hono<{ Bindings: Env }>()

interface IncomingBookmark {
  id: string
  url: string
  title: string
  parentId?: string | null
  path?: string[]
  category: string
  isFavorite?: boolean
  dateAdded?: number | null
  index?: number | null
}

interface SnapshotBody {
  bookmarks?: IncomingBookmark[]
  pulledAt?: string
}

function embedTextFor(b: IncomingBookmark): string {
  return [b.title, b.url, b.category].filter(Boolean).join("\n")
}

function rowFromIncoming(b: IncomingBookmark, syncedAt: number, chunkCount: number): BookmarkRow {
  return {
    id: b.id,
    url: b.url,
    title: b.title,
    parent_id: b.parentId ?? null,
    path: JSON.stringify(b.path ?? []),
    category: b.category,
    is_favorite: b.isFavorite ? 1 : 0,
    date_added: b.dateAdded ?? null,
    position: b.index ?? null,
    chunk_count: chunkCount,
    synced_at: syncedAt
  }
}

bookmarks.post("/snapshot", async (c) => {
  const body = await c.req.json<SnapshotBody>().catch(() => null)
  if (!body || !Array.isArray(body.bookmarks)) {
    return c.json({ error: { code: "bad_request", message: "bookmarks[] required" } }, 400)
  }
  const incoming = body.bookmarks
  const now = Date.now()

  // Validate every entry has id + url + title + category.
  for (const b of incoming) {
    if (!b || typeof b.id !== "string" || typeof b.url !== "string" || typeof b.title !== "string" || typeof b.category !== "string") {
      return c.json({ error: { code: "bad_request", message: "each bookmark needs {id, url, title, category}" } }, 400)
    }
  }

  // Build a map of existing rows for the diff. We only need id/url/title/chunk_count.
  const existing = new Map((await listAllBookmarksDiffShape(c.env)).map((r) => [r.id, r]))
  const incomingIds = new Set(incoming.map((b) => b.id))

  let upserted = 0
  let inserted = 0
  let updated = 0
  let reembedded = 0

  for (const b of incoming) {
    const prev = existing.get(b.id)
    if (prev) {
      const needsEmbed = prev.url !== b.url || prev.title !== b.title
      let chunkCount = prev.chunk_count
      if (needsEmbed) {
        const r = await upsertFor(c.env, "bookmark", b.id, embedTextFor(b), {
          title: b.title, createdAt: now
        })
        if (r.chunkCount < prev.chunk_count) {
          const ids: string[] = []
          for (let i = r.chunkCount; i < prev.chunk_count; i++) ids.push(`bookmark:${b.id}:${i}`)
          if (ids.length) await c.env.VECTORS.deleteByIds(ids)
        }
        chunkCount = r.chunkCount
        reembedded++
      }
      await updateBookmark(c.env, rowFromIncoming(b, now, chunkCount))
      updated++
    } else {
      const r = await upsertFor(c.env, "bookmark", b.id, embedTextFor(b), {
        title: b.title, createdAt: now
      })
      await insertBookmark(c.env, rowFromIncoming(b, now, r.chunkCount))
      inserted++
      reembedded++
    }
    upserted++
  }

  // Delete rows missing from the snapshot (plus their vectors).
  let deleted = 0
  for (const [id, prev] of existing) {
    if (!incomingIds.has(id)) {
      await deleteFor(c.env, "bookmark", id, prev.chunk_count)
      await deleteBookmark(c.env, id)
      deleted++
    }
  }

  return c.json({
    pulledAt: body.pulledAt ?? null,
    upserted, inserted, updated, deleted, reembedded
  })
})

bookmarks.get("/", async (c) => {
  const category = c.req.query("category") ?? undefined
  const favoriteRaw = c.req.query("favorite")
  const favorite = favoriteRaw === undefined ? undefined : favoriteRaw === "true" || favoriteRaw === "1"
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const rows = await listBookmarks(c.env, { category, favorite, limit })
  return c.json({ bookmarks: rows })
})

bookmarks.get("/:id", async (c) => {
  const row = await getBookmark(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such bookmark" } }, 404)
  return c.json(row)
})

export default bookmarks
```

- [ ] **Step 2: Wire into `worker/src/index.ts`**

```ts
import { Hono } from "hono"
import { requireToken } from "./auth"
import conversations from "./routes/conversations"
import links from "./routes/links"
import bookmarks from "./routes/bookmarks"
import search from "./routes/search"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.route("/api/conversations", conversations)
app.route("/api/links", links)
app.route("/api/bookmarks", bookmarks)
app.route("/api/search", search)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
```

- [ ] **Step 3: Create the route tests** `worker/tests/routes/bookmarks.test.ts`

```ts
import { beforeEach, describe, expect, it, type Mock } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { makeEnv } from "../helpers"
import { getBookmark } from "../../src/db"

async function authed(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return await app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

function bm(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, url: `https://${id}.example`, title: `t-${id}`,
    parentId: null, path: [], category: "Unfiled", isFavorite: false,
    dateAdded: null, index: 0,
    ...overrides
  }
}

describe("/api/bookmarks", () => {
  let env: Env
  beforeEach(() => { env = makeEnv() })

  it("POST /snapshot inserts new bookmarks and embeds them", async () => {
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1"), bm("b2")], pulledAt: "2026-05-20T12:00:00Z" })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { inserted: number; reembedded: number; deleted: number }
    expect(body.inserted).toBe(2)
    expect(body.reembedded).toBe(2)
    expect(body.deleted).toBe(0)
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(2)
  })

  it("POST /snapshot is idempotent — re-sending identical payload re-embeds nothing", async () => {
    const payload = JSON.stringify({ bookmarks: [bm("b1")] })
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" }, body: payload
    })
    ;(env.VECTORS.upsert as Mock).mockClear()

    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" }, body: payload
    })
    const body = (await res.json()) as { reembedded: number; updated: number }
    expect(body.reembedded).toBe(0)
    expect(body.updated).toBe(1)
    expect(env.VECTORS.upsert).not.toHaveBeenCalled()
  })

  it("POST /snapshot re-embeds when title changes", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { title: "old" })] })
    })
    ;(env.VECTORS.upsert as Mock).mockClear()

    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { title: "new" })] })
    })
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(1)
    expect((await getBookmark(env, "b1"))?.title).toBe("new")
  })

  it("POST /snapshot deletes rows absent from the payload", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1"), bm("b2")] })
    })
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1")] })
    })
    const body = (await res.json()) as { deleted: number }
    expect(body.deleted).toBe(1)
    expect(await getBookmark(env, "b2")).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("GET /api/bookmarks lists rows", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { category: "Work" }), bm("b2", { category: "Personal" })] })
    })
    const res = await authed(env, "/api/bookmarks?category=Work")
    const body = (await res.json()) as { bookmarks: { id: string }[] }
    expect(body.bookmarks.map((b) => b.id)).toEqual(["b1"])
  })

  it("GET /api/bookmarks?favorite=true filters favorites", async () => {
    await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmarks: [bm("b1", { isFavorite: true }), bm("b2", { isFavorite: false })] })
    })
    const res = await authed(env, "/api/bookmarks?favorite=true")
    const body = (await res.json()) as { bookmarks: { id: string }[] }
    expect(body.bookmarks.map((b) => b.id)).toEqual(["b1"])
  })

  it("GET /api/bookmarks/:id returns 404 when missing", async () => {
    const res = await authed(env, "/api/bookmarks/nope")
    expect(res.status).toBe(404)
  })

  it("returns 400 on malformed payload", async () => {
    const res = await authed(env, "/api/bookmarks/snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(400)
  })

  it("requires the token", async () => {
    const res = await app.fetch(new Request("http://x/api/bookmarks/snapshot"), env)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 4: Run all tests + typecheck**

```bash
cd worker && pnpm test && pnpm typecheck
```
Expected: 49 (Phase 1) + 6 db + 9 routes = 64 tests passing.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/bookmarks.ts worker/src/index.ts worker/tests/routes/bookmarks.test.ts
git commit -m "feat(worker): /api/bookmarks snapshot endpoint with diff-based sync"
```

---

## Self-review

- §5.4 of the spec is fully implemented: snapshot diff (upsert + delete absent), re-embed only on title/url change, no DELETE, list and read endpoints.
- Bookmark embedding uses `title + url + category` (simple, deterministic, captures the searchable surface).
- Test coverage matches the spec's listed cases: idempotent re-send, change detection, deletion of absent rows, category + favorite filters, 404, 400, 401.

## Done criteria for Phase 2

- All worker tests pass (target 64+).
- `pnpm typecheck` clean.
- `wrangler deploy --dry-run` still bundles successfully.
- One commit per task, two commits total.
