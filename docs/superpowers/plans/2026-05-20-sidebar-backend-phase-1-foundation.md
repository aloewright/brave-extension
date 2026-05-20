# Sidebar Backend — Phase 1: Worker Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployed Cloudflare Worker (`sidebar-api`) that authenticates with a shared token, persists conversations and links into D1, embeds text into Vectorize, and exposes a unified semantic search endpoint.

**Architecture:** Single Hono Worker. All AI calls use `env.AI.run("@cf/<model>", payload, { gateway: { id: "x" } })` per the project's AI Gateway policy. D1 holds metadata; Vectorize holds embeddings with deterministic vector ids `${type}:${id}:${chunkIndex}` so deletes don't need a side index. Tests run on `@cloudflare/vitest-pool-workers` so D1 is the real miniflare-backed SQLite; AI and Vectorize are stubbed at the binding boundary.

**Tech Stack:** Hono 4.x, Workers AI (`@cf/baai/bge-base-en-v1.5`, 768-dim), Vectorize, D1, Wrangler 3.x, Vitest with `@cloudflare/vitest-pool-workers`, ULID for ids.

**Spec:** `docs/superpowers/specs/2026-05-20-sidebar-backend-worker-design.md`

**Phase roadmap (this plan covers Phase 1 only):**

| Phase | Scope | Status |
|---|---|---|
| 1 | Worker skeleton + auth + D1 + Vectorize + conversations + links + search | **this plan** |
| 2 | Bookmarks snapshot endpoint + bookmark-side embedding | future |
| 3 | R2 + recordings/PDFs upload + ingest Workflow (transcription, OCR, async embed) | future |
| 4 | Web UI (Vite + React SPA served from same Worker via `[assets]`) | future |
| 5 | Extension-side cutover: `sidebar-api` client, settings migration, sync hooks for all 5 resource types | future |

---

## File Structure (Phase 1)

```
worker/
├── package.json                       # hono, vitest, wrangler, ulid, @cloudflare/workers-types, @cloudflare/vitest-pool-workers
├── tsconfig.json
├── wrangler.toml                      # bindings: DB, VECTORS, AI, SIDEBAR_TOKEN
├── vitest.config.ts
├── migrations/
│   └── 0001_init.sql                  # all 5 tables (only conversations + links exercised in Phase 1)
├── src/
│   ├── index.ts                       # Hono app entry, mounts routes
│   ├── env.ts                         # Env interface
│   ├── auth.ts                        # X-Sidebar-Token middleware
│   ├── ai.ts                          # embed(env, text|text[]), transcribe stub for later phases
│   ├── chunk.ts                       # chunkText(text, opts) → string[]
│   ├── vectors.ts                     # chunkAndEmbed, upsertFor, deleteFor, search
│   ├── db.ts                          # typed helpers for conversations + links rows
│   ├── ulid.ts                        # 26-char ULID generator (no external dep needed)
│   └── routes/
│       ├── conversations.ts
│       ├── links.ts
│       └── search.ts
└── tests/
    ├── helpers.ts                     # makeEnv() stub builder + applyMigrations()
    ├── auth.test.ts
    ├── chunk.test.ts
    ├── vectors.test.ts
    ├── routes/
    │   ├── conversations.test.ts
    │   ├── links.test.ts
    │   └── search.test.ts
    └── integration.test.ts            # end-to-end: POST conversation → search finds it
```

Each file has one clear purpose. Files that change together live together (one route file pairs with one test file).

---

## Task 1: Initialize the worker subdirectory and toolchain

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/vitest.config.ts`
- Create: `worker/src/index.ts`
- Create: `worker/.gitignore`

- [ ] **Step 1: Create `worker/package.json`**

```json
{
  "name": "sidebar-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p .",
    "d1:migrate:local": "wrangler d1 migrations apply sidebar --local",
    "d1:migrate:remote": "wrangler d1 migrations apply sidebar --remote"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20260520.0",
    "typescript": "^5.6.0",
    "vitest": "~2.1.0",
    "wrangler": "^3.80.0"
  }
}
```

- [ ] **Step 2: Create `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/2024-09-23", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Create `worker/wrangler.toml`** (bindings without ids; ids filled in Task 9)

```toml
name = "sidebar-api"
main = "src/index.ts"
compatibility_date = "2026-05-01"
compatibility_flags = ["nodejs_compat"]

# D1 — filled in after `wrangler d1 create sidebar` in Task 9
[[d1_databases]]
binding = "DB"
database_name = "sidebar"
database_id = "REPLACE_WITH_D1_ID"
migrations_dir = "./migrations"

# Vectorize — filled in after `wrangler vectorize create sidebar-search` in Task 9
[[vectorize]]
binding = "VECTORS"
index_name = "sidebar-search"

# Workers AI — always available
[ai]
binding = "AI"
```

- [ ] **Step 4: Create `worker/vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config"

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Vectorize and AI are stubbed by test helpers; the real D1 from
          // miniflare is what we want for migrations + queries.
          compatibilityFlags: ["nodejs_compat"]
        }
      }
    }
  }
})
```

- [ ] **Step 5: Create `worker/src/index.ts`** (minimal entry; routes wired in later tasks)

```ts
import { Hono } from "hono"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
```

- [ ] **Step 6: Create `worker/src/env.ts`** (stub — extended in Task 2)

```ts
export interface Env {
  DB: D1Database
  VECTORS: VectorizeIndex
  AI: Ai
  SIDEBAR_TOKEN: string
}
```

- [ ] **Step 7: Create `worker/.gitignore`**

```
node_modules
.wrangler
.dev.vars
dist
*.log
```

- [ ] **Step 8: Install dependencies**

Run from the repo root:
```bash
cd worker && pnpm install
```
Expected: dependencies install without errors. A `pnpm-lock.yaml` appears in `worker/`.

- [ ] **Step 9: Verify the Worker boots locally**

Run:
```bash
cd worker && pnpm dev
```
In another terminal:
```bash
curl http://127.0.0.1:8787/api/health
```
Expected response (truncated):
```json
{"ok":true,"version":"0.1.0","deployedAt":"..."}
```
Stop the dev server with Ctrl-C.

- [ ] **Step 10: Commit**

```bash
git add worker/
git commit -m "feat(worker): scaffold sidebar-api Worker with health route"
```

---

## Task 2: Env interface and AI wrapper

**Files:**
- Modify: `worker/src/env.ts`
- Create: `worker/src/ai.ts`
- Create: `worker/tests/helpers.ts`
- Create: `worker/tests/ai.test.ts`

- [ ] **Step 1: Replace `worker/src/env.ts`** with the full Env interface

```ts
// Bindings declared in wrangler.toml + the SIDEBAR_TOKEN secret.
// INGEST + BLOBS + ASSETS are reserved for later phases.
export interface Env {
  DB: D1Database
  VECTORS: VectorizeIndex
  AI: Ai
  SIDEBAR_TOKEN: string
}

// Workers AI model ids used in Phase 1.
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5" as const
export const EMBED_DIMS = 768 as const

// AI Gateway id from the account's existing config. Per CLAUDE.md, dynamic/*
// routes are broken inside a Worker; we route specific @cf/* models through
// gateway "x" instead. Swap to dynamic/* when upstream is fixed.
export const AI_GATEWAY_ID = "x" as const
```

- [ ] **Step 2: Create `worker/src/ai.ts`**

```ts
import { AI_GATEWAY_ID, EMBED_MODEL, type Env } from "./env"

/**
 * Embed one or many strings via Workers AI through AI Gateway "x".
 * Returns a 2-D array: [text][dim]. Single-string input returns [1][dim].
 */
export async function embed(env: Env, input: string | string[]): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input]
  if (texts.length === 0) return []

  const res = (await env.AI.run(
    EMBED_MODEL,
    { text: texts },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as { data: number[][] }

  if (!res?.data || !Array.isArray(res.data)) {
    throw new Error(`embed: unexpected AI response shape (got ${JSON.stringify(res).slice(0, 80)})`)
  }
  return res.data
}
```

- [ ] **Step 3: Create `worker/tests/helpers.ts`** — central stub builder for tests

```ts
import { vi } from "vitest"
import { env as miniflareEnv } from "cloudflare:test"
// Vite/vitest `?raw` import — loads the SQL file as a string at build time.
// @ts-expect-error - resolved by Vite, not TS
import initSql from "../migrations/0001_init.sql?raw"
import type { Env } from "../src/env"
import { EMBED_DIMS } from "../src/env"

/**
 * Build a test Env using miniflare's real D1 + a stubbed AI/Vectorize.
 * Each test gets a fresh AI vi.fn() so call assertions are isolated.
 */
export function makeEnv(overrides?: Partial<Env>): Env {
  const aiRun = vi.fn(async (model: string, payload: any) => {
    if (model.endsWith("bge-base-en-v1.5")) {
      const texts: string[] = payload?.text ?? []
      return { data: texts.map(() => fakeVector(EMBED_DIMS)) }
    }
    throw new Error(`unstubbed AI model: ${model}`)
  })

  const vectorsStore = new Map<string, { values: number[]; metadata: Record<string, unknown> }>()

  return {
    DB: (miniflareEnv as unknown as { DB: D1Database }).DB,
    AI: { run: aiRun } as unknown as Ai,
    VECTORS: {
      upsert: vi.fn(async (vectors: VectorizeVector[]) => {
        for (const v of vectors) vectorsStore.set(v.id, { values: v.values as number[], metadata: v.metadata ?? {} })
        return { mutationId: "test" }
      }),
      deleteByIds: vi.fn(async (ids: string[]) => {
        for (const id of ids) vectorsStore.delete(id)
        return { mutationId: "test" }
      }),
      query: vi.fn(async (vec: number[], opts?: VectorizeQueryOptions) => {
        // naive: return all stored vectors as matches with score = 1
        const matches: VectorizeMatch[] = Array.from(vectorsStore.entries())
          .slice(0, opts?.topK ?? 10)
          .map(([id, { metadata }]) => ({
            id,
            score: 1,
            metadata: metadata as Record<string, VectorizeVectorMetadataValue>
          }))
        return { matches, count: matches.length } as VectorizeMatches
      })
    } as unknown as VectorizeIndex,
    SIDEBAR_TOKEN: "test-token",
    ...overrides
  }
}

function fakeVector(dims: number): number[] {
  const v: number[] = []
  for (let i = 0; i < dims; i++) v.push(((i + 1) * 0.001) % 1)
  return v
}

/** Run every SQL statement in migrations/0001_init.sql against the test DB. */
export async function applyMigrations(env: Env): Promise<void> {
  const statements = String(initSql)
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("--"))
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run()
  }
}
```

> **Note:** `cloudflare:test` exposes `env` populated from `wrangler.toml`. We pull `DB` from there because that's the real D1; the rest we replace with stubs so tests stay focused.

- [ ] **Step 4: Write `worker/tests/ai.test.ts`**

```ts
import { describe, expect, it } from "vitest"
import { embed } from "../src/ai"
import { makeEnv } from "./helpers"
import { EMBED_DIMS } from "../src/env"

describe("embed", () => {
  it("returns one vector per input string", async () => {
    const env = makeEnv()
    const out = await embed(env, ["hello", "world"])
    expect(out).toHaveLength(2)
    expect(out[0]).toHaveLength(EMBED_DIMS)
    expect(out[1]).toHaveLength(EMBED_DIMS)
  })

  it("accepts a single string and returns a single vector", async () => {
    const env = makeEnv()
    const out = await embed(env, "hi")
    expect(out).toHaveLength(1)
  })

  it("returns [] for empty input", async () => {
    const env = makeEnv()
    expect(await embed(env, [])).toEqual([])
  })

  it("passes gateway id 'x' on every call", async () => {
    const env = makeEnv()
    await embed(env, "test")
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/baai/bge-base-en-v1.5",
      { text: ["test"] },
      { gateway: { id: "x" } }
    )
  })
})
```

- [ ] **Step 5: Run the tests, verify pass**

Run:
```bash
cd worker && pnpm test ai.test
```
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add worker/src/env.ts worker/src/ai.ts worker/tests/helpers.ts worker/tests/ai.test.ts
git commit -m "feat(worker): add Env type and embed() wrapper using gateway 'x'"
```

---

## Task 3: Auth middleware

**Files:**
- Create: `worker/src/auth.ts`
- Create: `worker/tests/auth.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write the failing test first** — `worker/tests/auth.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { requireToken } from "../src/auth"
import type { Env } from "../src/env"
import { makeEnv } from "./helpers"

function buildApp() {
  const app = new Hono<{ Bindings: Env }>()
  app.use("/api/*", requireToken())
  app.get("/api/health", (c) => c.json({ ok: true }))
  app.get("/api/secret", (c) => c.json({ secret: 42 }))
  return app
}

describe("requireToken", () => {
  const env = makeEnv()

  it("lets /api/health through without a token", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/health"), env)
    expect(res.status).toBe(200)
  })

  it("returns 401 when token is missing on a guarded route", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/secret"), env)
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe("unauthorized")
  })

  it("returns 401 when token is wrong", async () => {
    const req = new Request("http://x/api/secret", { headers: { "x-sidebar-token": "nope" } })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(401)
  })

  it("passes through when token matches", async () => {
    const req = new Request("http://x/api/secret", { headers: { "x-sidebar-token": "test-token" } })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { secret: number }
    expect(body.secret).toBe(42)
  })

  it("is case-insensitive on the header name", async () => {
    const req = new Request("http://x/api/secret", { headers: { "X-Sidebar-Token": "test-token" } })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

Run:
```bash
cd worker && pnpm test auth.test
```
Expected: FAIL — `Cannot find module '../src/auth'`.

- [ ] **Step 3: Implement `worker/src/auth.ts`**

```ts
import type { MiddlewareHandler } from "hono"
import type { Env } from "./env"

/**
 * Constant-time check of the X-Sidebar-Token header against env.SIDEBAR_TOKEN.
 * The /api/health route is allow-listed inside this middleware so callers can
 * health-check the deployed Worker without holding a token.
 */
export function requireToken(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next()
    const got = c.req.header("x-sidebar-token") ?? ""
    const want = c.env.SIDEBAR_TOKEN ?? ""
    if (!want || !timingSafeEqual(got, want)) {
      return c.json({ error: { code: "unauthorized", message: "missing or invalid token" } }, 401)
    }
    await next()
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
```

- [ ] **Step 4: Wire the middleware in `worker/src/index.ts`**

Replace the file with:

```ts
import { Hono } from "hono"
import { requireToken } from "./auth"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
```

- [ ] **Step 5: Run the test, verify pass**

Run:
```bash
cd worker && pnpm test auth.test
```
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add worker/src/auth.ts worker/src/index.ts worker/tests/auth.test.ts
git commit -m "feat(worker): add X-Sidebar-Token middleware with health bypass"
```

---

## Task 4: D1 schema + initial migration

**Files:**
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/src/ulid.ts`
- Create: `worker/src/db.ts`
- Create: `worker/tests/db.test.ts`

- [ ] **Step 1: Create the migration `worker/migrations/0001_init.sql`**

```sql
-- 0001_init.sql — initial schema for all five resource types.
-- Phase 1 only exercises conversations + links; the other tables exist so
-- Phase 2/3 don't need a follow-up structural migration.

CREATE TABLE IF NOT EXISTS conversations (
  id            TEXT PRIMARY KEY,
  backend       TEXT NOT NULL,
  title         TEXT NOT NULL,
  content_text  TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  chunk_count   INTEGER NOT NULL DEFAULT 0,
  started_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_backend ON conversations(backend, updated_at DESC);

CREATE TABLE IF NOT EXISTS links (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  favicon     TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_links_url ON links(url);
CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  parent_id   TEXT,
  path        TEXT NOT NULL DEFAULT '[]',
  category    TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  date_added  INTEGER,
  position    INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  synced_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_synced   ON bookmarks(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(category);

CREATE TABLE IF NOT EXISTS recordings (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  size_bytes     INTEGER NOT NULL,
  source         TEXT NOT NULL,
  origin_url     TEXT,
  r2_key         TEXT NOT NULL,
  transcript     TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  workflow_id    TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_status  ON recordings(status);

CREATE TABLE IF NOT EXISTS pdfs (
  id             TEXT PRIMARY KEY,
  filename       TEXT NOT NULL,
  title          TEXT,
  source_url     TEXT,
  size_bytes     INTEGER NOT NULL,
  page_count     INTEGER,
  r2_key         TEXT NOT NULL,
  text_content   TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  status_message TEXT,
  workflow_id    TEXT,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pdfs_created ON pdfs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pdfs_status  ON pdfs(status);
```

- [ ] **Step 2: Create `worker/src/ulid.ts`** — small ULID generator (no dep)

```ts
// Crockford-base32 ULID. 48-bit timestamp + 80-bit randomness = 26 chars.
const ENCODE = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

export function ulid(now: number = Date.now()): string {
  if (now < 0 || now > 281474976710655) throw new Error("ulid: timestamp out of range")
  let time = now
  let timeChars = ""
  for (let i = 9; i >= 0; i--) {
    const mod = time % 32
    timeChars = ENCODE[mod] + timeChars
    time = (time - mod) / 32
  }
  let randomChars = ""
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  for (let i = 0; i < 16; i++) randomChars += ENCODE[bytes[i] % 32]
  return timeChars + randomChars
}
```

- [ ] **Step 3: Create the DB helpers `worker/src/db.ts`**

```ts
import type { Env } from "./env"

// ── Row shapes ─────────────────────────────────────────────────────────────
export interface ConversationRow {
  id: string
  backend: string
  title: string
  content_text: string
  message_count: number
  chunk_count: number
  started_at: number
  updated_at: number
}

export interface LinkRow {
  id: string
  url: string
  title: string
  description: string | null
  tags: string                 // JSON array stored as TEXT
  favicon: string | null
  source: string
  chunk_count: number
  created_at: number
  updated_at: number
}

// ── Conversation queries ───────────────────────────────────────────────────
export async function insertConversation(env: Env, row: ConversationRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO conversations
       (id, backend, title, content_text, message_count, chunk_count, started_at, updated_at)
     VALUES (?,  ?,       ?,     ?,            ?,             ?,           ?,          ?)`
  )
    .bind(
      row.id, row.backend, row.title, row.content_text,
      row.message_count, row.chunk_count, row.started_at, row.updated_at
    )
    .run()
}

export async function getConversation(env: Env, id: string): Promise<ConversationRow | null> {
  return (await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first<ConversationRow>()) ?? null
}

export async function listConversations(
  env: Env,
  opts: { backend?: string; limit?: number; before?: number } = {}
): Promise<ConversationRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.backend) {
    where.push("backend = ?")
    binds.push(opts.backend)
  }
  if (opts.before) {
    where.push("updated_at < ?")
    binds.push(opts.before)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM conversations ${whereSql} ORDER BY updated_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<ConversationRow>()
  return results ?? []
}

export async function updateConversation(
  env: Env,
  id: string,
  patch: { title?: string; content_text?: string; message_count?: number; chunk_count?: number; updated_at: number }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number)[] = []
  if (patch.title !== undefined) { sets.push("title = ?"); binds.push(patch.title) }
  if (patch.content_text !== undefined) { sets.push("content_text = ?"); binds.push(patch.content_text) }
  if (patch.message_count !== undefined) { sets.push("message_count = ?"); binds.push(patch.message_count) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deleteConversation(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run()
}

// ── Link queries ───────────────────────────────────────────────────────────
export async function upsertLink(env: Env, row: LinkRow): Promise<{ id: string; created: boolean }> {
  const existing = await env.DB.prepare("SELECT id FROM links WHERE url = ?").bind(row.url).first<{ id: string }>()
  if (existing) {
    await env.DB.prepare(
      `UPDATE links SET
         title = ?, description = ?, tags = ?, favicon = ?, source = ?,
         chunk_count = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(row.title, row.description, row.tags, row.favicon, row.source, row.chunk_count, row.updated_at, existing.id)
      .run()
    return { id: existing.id, created: false }
  }
  await env.DB.prepare(
    `INSERT INTO links
       (id, url, title, description, tags, favicon, source, chunk_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.url, row.title, row.description, row.tags, row.favicon, row.source,
      row.chunk_count, row.created_at, row.updated_at
    )
    .run()
  return { id: row.id, created: true }
}

export async function getLink(env: Env, id: string): Promise<LinkRow | null> {
  return (await env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>()) ?? null
}

export async function listLinks(
  env: Env,
  opts: { tag?: string; limit?: number; before?: number } = {}
): Promise<LinkRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.before) {
    where.push("created_at < ?")
    binds.push(opts.before)
  }
  if (opts.tag) {
    where.push("tags LIKE ?")
    binds.push(`%"${opts.tag}"%`)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM links ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<LinkRow>()
  return results ?? []
}

export async function deleteLink(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM links WHERE id = ?").bind(id).run()
}
```

- [ ] **Step 4: Write `worker/tests/db.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { applyMigrations, makeEnv } from "./helpers"
import {
  deleteConversation,
  getConversation,
  insertConversation,
  listConversations,
  updateConversation,
  upsertLink,
  getLink,
  listLinks,
  deleteLink
} from "../src/db"

describe("db", () => {
  let env = makeEnv()

  beforeEach(async () => {
    env = makeEnv()
    await applyMigrations(env)
  })

  it("inserts and reads a conversation", async () => {
    await insertConversation(env, {
      id: "c1", backend: "claude", title: "t", content_text: "x",
      message_count: 1, chunk_count: 0, started_at: 1, updated_at: 1
    })
    const got = await getConversation(env, "c1")
    expect(got?.title).toBe("t")
  })

  it("lists conversations newest-first and respects limit", async () => {
    for (let i = 1; i <= 3; i++) {
      await insertConversation(env, {
        id: `c${i}`, backend: "claude", title: `t${i}`, content_text: "",
        message_count: 0, chunk_count: 0, started_at: i, updated_at: i
      })
    }
    const rows = await listConversations(env, { limit: 2 })
    expect(rows.map((r) => r.id)).toEqual(["c3", "c2"])
  })

  it("filters conversations by backend", async () => {
    await insertConversation(env, {
      id: "a", backend: "claude", title: "", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    await insertConversation(env, {
      id: "b", backend: "gemini", title: "", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    const rows = await listConversations(env, { backend: "gemini" })
    expect(rows.map((r) => r.id)).toEqual(["b"])
  })

  it("updates a conversation and bumps updated_at", async () => {
    await insertConversation(env, {
      id: "c1", backend: "claude", title: "old", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    await updateConversation(env, "c1", { title: "new", updated_at: 5 })
    const got = await getConversation(env, "c1")
    expect(got?.title).toBe("new")
    expect(got?.updated_at).toBe(5)
  })

  it("deletes a conversation", async () => {
    await insertConversation(env, {
      id: "c1", backend: "claude", title: "", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    await deleteConversation(env, "c1")
    expect(await getConversation(env, "c1")).toBeNull()
  })

  it("upserts a link by URL (creates new)", async () => {
    const r = await upsertLink(env, {
      id: "l1", url: "https://example.com", title: "ex", description: null,
      tags: '["a"]', favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    expect(r).toEqual({ id: "l1", created: true })
  })

  it("upserts a link by URL (updates existing, keeps original id)", async () => {
    await upsertLink(env, {
      id: "l1", url: "https://example.com", title: "first", description: null,
      tags: "[]", favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    const r = await upsertLink(env, {
      id: "l2", url: "https://example.com", title: "second", description: null,
      tags: "[]", favicon: null, source: "manual", chunk_count: 0,
      created_at: 2, updated_at: 2
    })
    expect(r).toEqual({ id: "l1", created: false })
    expect((await getLink(env, "l1"))?.title).toBe("second")
    expect(await getLink(env, "l2")).toBeNull()
  })

  it("lists and filters links by tag", async () => {
    await upsertLink(env, {
      id: "l1", url: "https://a.com", title: "a", description: null,
      tags: '["red","blue"]', favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    await upsertLink(env, {
      id: "l2", url: "https://b.com", title: "b", description: null,
      tags: '["green"]', favicon: null, source: "manual", chunk_count: 0,
      created_at: 2, updated_at: 2
    })
    const red = await listLinks(env, { tag: "red" })
    expect(red.map((r) => r.id)).toEqual(["l1"])
  })

  it("deletes a link", async () => {
    await upsertLink(env, {
      id: "l1", url: "https://a.com", title: "a", description: null,
      tags: "[]", favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    await deleteLink(env, "l1")
    expect(await getLink(env, "l1")).toBeNull()
  })
})
```

- [ ] **Step 5: Run db tests**

Run:
```bash
cd worker && pnpm test db.test
```
Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add worker/migrations/ worker/src/ulid.ts worker/src/db.ts worker/tests/db.test.ts
git commit -m "feat(worker): D1 schema + typed helpers for conversations/links"
```

---

## Task 5: Chunker and Vectorize helpers

**Files:**
- Create: `worker/src/chunk.ts`
- Create: `worker/src/vectors.ts`
- Create: `worker/tests/chunk.test.ts`
- Create: `worker/tests/vectors.test.ts`

- [ ] **Step 1: Write the chunker test** — `worker/tests/chunk.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { chunkText } from "../src/chunk"

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("hello world", { maxChars: 1000, overlapChars: 100 })
    expect(chunks).toEqual(["hello world"])
  })

  it("returns [] for empty/whitespace input", () => {
    expect(chunkText("", { maxChars: 100, overlapChars: 10 })).toEqual([])
    expect(chunkText("   \n  ", { maxChars: 100, overlapChars: 10 })).toEqual([])
  })

  it("splits long text into overlapping windows", () => {
    const text = "a".repeat(2500)
    const chunks = chunkText(text, { maxChars: 1000, overlapChars: 100 })
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks[0].length).toBeLessThanOrEqual(1000)
    // each chunk after the first should start with the tail of the previous chunk
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1].slice(-100)
      expect(chunks[i].startsWith(prevTail)).toBe(true)
    }
  })

  it("prefers splitting at paragraph boundaries when possible", () => {
    const text = "para one.\n\n" + "para two has more content. ".repeat(50)
    const chunks = chunkText(text, { maxChars: 200, overlapChars: 20 })
    // first chunk should end at the paragraph break, not mid-word
    expect(chunks[0].endsWith("\n\n") || chunks[0].endsWith(".") || chunks[0].endsWith(" ")).toBe(true)
  })
})
```

- [ ] **Step 2: Run, expect failure** (`Cannot find module '../src/chunk'`)

```bash
cd worker && pnpm test chunk.test
```

- [ ] **Step 3: Implement `worker/src/chunk.ts`**

```ts
export interface ChunkOptions {
  maxChars: number      // soft upper bound
  overlapChars: number  // tail of previous chunk prepended to next
}

export function chunkText(text: string, opts: ChunkOptions): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= opts.maxChars) return [trimmed]

  const chunks: string[] = []
  let i = 0
  while (i < trimmed.length) {
    let end = Math.min(i + opts.maxChars, trimmed.length)
    if (end < trimmed.length) {
      // try to step back to a boundary: paragraph > sentence > whitespace
      const back = Math.max(i + opts.maxChars / 2, end - 300)
      const slice = trimmed.slice(i, end)
      const para = slice.lastIndexOf("\n\n")
      const sent = slice.lastIndexOf(". ")
      const space = slice.lastIndexOf(" ")
      const candidate = para >= 0 ? para + 2 : sent >= 0 ? sent + 2 : space >= 0 ? space + 1 : -1
      if (candidate > 0 && i + candidate > back) end = i + candidate
    }
    chunks.push(trimmed.slice(i, end))
    if (end >= trimmed.length) break
    i = Math.max(end - opts.overlapChars, i + 1)
  }
  return chunks
}
```

- [ ] **Step 4: Run chunk tests, verify pass**

```bash
cd worker && pnpm test chunk.test
```
Expected: 4 passed.

- [ ] **Step 5: Write the vectors test** — `worker/tests/vectors.test.ts`

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { chunkAndEmbed, upsertFor, deleteFor, search, vectorIdFor } from "../src/vectors"

describe("vectors", () => {
  it("computes a deterministic vector id", () => {
    expect(vectorIdFor("conversation", "abc", 0)).toBe("conversation:abc:0")
    expect(vectorIdFor("link", "01HV", 12)).toBe("link:01HV:12")
  })

  it("chunkAndEmbed returns one embedding per chunk", async () => {
    const env = makeEnv()
    const chunks = await chunkAndEmbed(env, "hello world", { maxChars: 5, overlapChars: 1 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]).toHaveProperty("text")
    expect(chunks[0]).toHaveProperty("values")
  })

  it("upsertFor writes vectors with type+id namespacing and metadata", async () => {
    const env = makeEnv()
    const result = await upsertFor(env, "link", "L1", "hello world", {
      title: "T", createdAt: 1, maxChars: 50, overlapChars: 5
    })
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(1)
    const arg = (env.VECTORS.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as VectorizeVector[]
    expect(arg[0].id).toBe("link:L1:0")
    expect(arg[0].metadata).toMatchObject({ type: "link", id: "L1", title: "T", createdAt: 1, chunkIndex: 0 })
  })

  it("deleteFor removes all vectors for a resource by chunk_count", async () => {
    const env = makeEnv()
    await deleteFor(env, "link", "L1", 3)
    expect(env.VECTORS.deleteByIds).toHaveBeenCalledWith(["link:L1:0", "link:L1:1", "link:L1:2"])
  })

  it("deleteFor is a no-op when chunkCount is 0", async () => {
    const env = makeEnv()
    await deleteFor(env, "link", "L1", 0)
    expect(env.VECTORS.deleteByIds).not.toHaveBeenCalled()
  })

  it("search embeds the query and returns Vectorize matches", async () => {
    const env = makeEnv()
    await upsertFor(env, "link", "L1", "hello", { title: "T", createdAt: 1, maxChars: 50, overlapChars: 5 })
    const hits = await search(env, "hello", { limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toHaveProperty("score")
    expect(hits[0]).toHaveProperty("metadata")
  })
})
```

- [ ] **Step 6: Implement `worker/src/vectors.ts`**

```ts
import type { Env } from "./env"
import { embed } from "./ai"
import { chunkText } from "./chunk"

export type ResourceType = "conversation" | "link" | "bookmark" | "recording" | "pdf"

export interface ResourceMeta {
  title: string
  createdAt: number
  maxChars?: number     // default 2000
  overlapChars?: number // default 200
}

export interface ChunkVector {
  text: string
  values: number[]
}

export interface UpsertResult {
  chunkCount: number
}

export interface SearchHit {
  id: string                                  // vector id, e.g. "link:L1:0"
  score: number
  metadata: { type: ResourceType; id: string; chunkIndex: number; createdAt: number; title: string; snippet: string }
}

export function vectorIdFor(type: ResourceType, id: string, chunkIndex: number): string {
  return `${type}:${id}:${chunkIndex}`
}

export async function chunkAndEmbed(
  env: Env,
  text: string,
  opts: { maxChars: number; overlapChars: number }
): Promise<ChunkVector[]> {
  const chunks = chunkText(text, opts)
  if (chunks.length === 0) return []
  const vectors = await embed(env, chunks)
  return chunks.map((c, i) => ({ text: c, values: vectors[i] }))
}

export async function upsertFor(
  env: Env,
  type: ResourceType,
  id: string,
  text: string,
  meta: ResourceMeta
): Promise<UpsertResult> {
  const maxChars = meta.maxChars ?? 2000
  const overlapChars = meta.overlapChars ?? 200
  const chunks = await chunkAndEmbed(env, text, { maxChars, overlapChars })
  if (chunks.length === 0) return { chunkCount: 0 }

  const vectors: VectorizeVector[] = chunks.map((c, i) => ({
    id: vectorIdFor(type, id, i),
    values: c.values,
    metadata: {
      type,
      id,
      chunkIndex: i,
      createdAt: meta.createdAt,
      title: meta.title,
      snippet: c.text.slice(0, 200)
    }
  }))
  await env.VECTORS.upsert(vectors)
  return { chunkCount: vectors.length }
}

export async function deleteFor(env: Env, type: ResourceType, id: string, chunkCount: number): Promise<void> {
  if (chunkCount <= 0) return
  const ids: string[] = []
  for (let i = 0; i < chunkCount; i++) ids.push(vectorIdFor(type, id, i))
  await env.VECTORS.deleteByIds(ids)
}

export async function search(
  env: Env,
  query: string,
  opts: { types?: ResourceType[]; limit?: number } = {}
): Promise<SearchHit[]> {
  const trimmed = query.trim()
  if (!trimmed) return []
  const [qv] = await embed(env, trimmed)
  const limit = opts.limit ?? 20
  const result = await env.VECTORS.query(qv, {
    topK: limit,
    returnMetadata: "all"
  })
  let hits = (result.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata as unknown as SearchHit["metadata"]
  }))
  if (opts.types && opts.types.length) {
    hits = hits.filter((h) => opts.types!.includes(h.metadata.type))
  }
  return hits
}
```

- [ ] **Step 7: Run vectors tests, verify pass**

```bash
cd worker && pnpm test vectors.test
```
Expected: 6 passed.

- [ ] **Step 8: Commit**

```bash
git add worker/src/chunk.ts worker/src/vectors.ts worker/tests/chunk.test.ts worker/tests/vectors.test.ts
git commit -m "feat(worker): chunker + Vectorize helpers (upsert/delete/search)"
```

---

## Task 6: Conversations routes

**Files:**
- Create: `worker/src/routes/conversations.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/routes/conversations.test.ts`

- [ ] **Step 1: Write the route test** — `worker/tests/routes/conversations.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { applyMigrations, makeEnv } from "../helpers"
import { getConversation, listConversations } from "../../src/db"

function authed(path: string, init?: RequestInit, env?: Env): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/conversations", () => {
  let env: Env

  beforeEach(async () => {
    env = makeEnv()
    await applyMigrations(env)
  })

  it("POST creates a conversation, embeds it, and returns the id", async () => {
    const res = await authed(
      "/api/conversations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          backend: "claude",
          title: "hello",
          content_text: "this is a chat about widgets",
          started_at: 100,
          message_count: 2
        })
      },
      env
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; chunkCount: number }
    expect(body.id).toMatch(/^[0-9A-Z]{26}$/)
    expect(body.chunkCount).toBeGreaterThan(0)

    const row = await getConversation(env, body.id)
    expect(row?.title).toBe("hello")
    expect(env.VECTORS.upsert).toHaveBeenCalled()
  })

  it("POST with id replays as an update for the same id", async () => {
    const create = await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "v1", content_text: "x", started_at: 100, message_count: 1 })
    }, env)
    const { id } = (await create.json()) as { id: string }

    const update = await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, backend: "claude", title: "v2", content_text: "x", started_at: 100, message_count: 1 })
    }, env)
    expect(update.status).toBe(200)
    expect((await getConversation(env, id))?.title).toBe("v2")
  })

  it("GET /api/conversations lists rows newest-first", async () => {
    for (let i = 1; i <= 3; i++) {
      await authed("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backend: "claude", title: `t${i}`, content_text: "x", started_at: i, message_count: 1 })
      }, env)
    }
    const res = await authed("/api/conversations", undefined, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { conversations: { title: string }[] }
    expect(body.conversations.map((c) => c.title)).toEqual(["t3", "t2", "t1"])
  })

  it("GET /api/conversations/:id returns 404 when missing", async () => {
    const res = await authed("/api/conversations/nope", undefined, env)
    expect(res.status).toBe(404)
  })

  it("PUT updates and re-embeds", async () => {
    const create = await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "v1", content_text: "x", started_at: 1, message_count: 1 })
    }, env)
    const { id } = (await create.json()) as { id: string }
    const before = ((env.VECTORS.upsert as ReturnType<typeof vi.fn>).mock.calls.length)

    const res = await authed(`/api/conversations/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "v2", content_text: "longer text now", message_count: 2 })
    }, env)
    expect(res.status).toBe(200)
    expect((await getConversation(env, id))?.title).toBe("v2")
    expect((env.VECTORS.upsert as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before)
  })

  it("DELETE removes the row and its vectors", async () => {
    const create = await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "t", content_text: "x", started_at: 1, message_count: 1 })
    }, env)
    const { id } = (await create.json()) as { id: string }

    const res = await authed(`/api/conversations/${id}`, { method: "DELETE" }, env)
    expect(res.status).toBe(204)
    expect(await getConversation(env, id)).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("returns 401 without a token", async () => {
    const res = await app.fetch(new Request("http://x/api/conversations"), env)
    expect(res.status).toBe(401)
  })

  it("validates required fields on POST", async () => {
    const res = await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "missing backend" })
    }, env)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Implement `worker/src/routes/conversations.ts`**

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteConversation, getConversation, insertConversation, listConversations,
  updateConversation, type ConversationRow
} from "../db"
import { deleteFor, upsertFor } from "../vectors"
import { ulid } from "../ulid"

const conversations = new Hono<{ Bindings: Env }>()

interface PostBody {
  id?: string
  backend?: string
  title?: string
  content_text?: string
  started_at?: number
  message_count?: number
}

conversations.post("/", async (c) => {
  const body = await c.req.json<PostBody>().catch(() => null)
  if (!body || !body.backend || !body.title || typeof body.content_text !== "string" || typeof body.started_at !== "number") {
    return c.json({ error: { code: "bad_request", message: "backend, title, content_text, started_at required" } }, 400)
  }
  const now = Date.now()

  if (body.id) {
    const existing = await getConversation(c.env, body.id)
    if (existing) {
      const { chunkCount } = await upsertFor(c.env, "conversation", existing.id, body.content_text, {
        title: body.title, createdAt: existing.started_at
      })
      // if new chunk count is smaller, prune trailing vectors
      if (chunkCount < existing.chunk_count) {
        const ids: string[] = []
        for (let i = chunkCount; i < existing.chunk_count; i++) ids.push(`conversation:${existing.id}:${i}`)
        if (ids.length) await c.env.VECTORS.deleteByIds(ids)
      }
      await updateConversation(c.env, existing.id, {
        title: body.title, content_text: body.content_text,
        message_count: body.message_count ?? existing.message_count,
        chunk_count: chunkCount, updated_at: now
      })
      return c.json({ id: existing.id, chunkCount }, 200)
    }
  }

  const id = body.id ?? ulid()
  const row: ConversationRow = {
    id, backend: body.backend, title: body.title, content_text: body.content_text,
    message_count: body.message_count ?? 0, chunk_count: 0,
    started_at: body.started_at, updated_at: now
  }
  await insertConversation(c.env, row)
  const { chunkCount } = await upsertFor(c.env, "conversation", id, body.content_text, {
    title: body.title, createdAt: body.started_at
  })
  if (chunkCount !== 0) {
    await updateConversation(c.env, id, { chunk_count: chunkCount, updated_at: now })
  }
  return c.json({ id, chunkCount }, 201)
})

conversations.get("/", async (c) => {
  const backend = c.req.query("backend") ?? undefined
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined
  const rows = await listConversations(c.env, { backend, limit, before })
  return c.json({ conversations: rows })
})

conversations.get("/:id", async (c) => {
  const row = await getConversation(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such conversation" } }, 404)
  return c.json(row)
})

interface PutBody {
  title?: string
  content_text?: string
  message_count?: number
}

conversations.put("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getConversation(c.env, id)
  if (!existing) return c.json({ error: { code: "not_found", message: "no such conversation" } }, 404)
  const body = await c.req.json<PutBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const now = Date.now()
  const nextContent = body.content_text ?? existing.content_text
  const nextTitle = body.title ?? existing.title

  const { chunkCount } = await upsertFor(c.env, "conversation", id, nextContent, {
    title: nextTitle, createdAt: existing.started_at
  })
  if (chunkCount < existing.chunk_count) {
    const ids: string[] = []
    for (let i = chunkCount; i < existing.chunk_count; i++) ids.push(`conversation:${id}:${i}`)
    if (ids.length) await c.env.VECTORS.deleteByIds(ids)
  }
  await updateConversation(c.env, id, {
    title: nextTitle, content_text: nextContent,
    message_count: body.message_count ?? existing.message_count,
    chunk_count: chunkCount, updated_at: now
  })
  return c.json({ id, chunkCount })
})

conversations.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getConversation(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "conversation", id, existing.chunk_count)
  await deleteConversation(c.env, id)
  return c.body(null, 204)
})

export default conversations
```

- [ ] **Step 3: Wire the router in `worker/src/index.ts`**

Replace with:

```ts
import { Hono } from "hono"
import { requireToken } from "./auth"
import conversations from "./routes/conversations"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.route("/api/conversations", conversations)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
```

- [ ] **Step 4: Run conversations tests**

```bash
cd worker && pnpm test conversations.test
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/conversations.ts worker/src/index.ts worker/tests/routes/conversations.test.ts
git commit -m "feat(worker): /api/conversations CRUD with inline embedding"
```

---

## Task 7: Links routes

**Files:**
- Create: `worker/src/routes/links.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/routes/links.test.ts`

- [ ] **Step 1: Write the route test** — `worker/tests/routes/links.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { applyMigrations, makeEnv } from "../helpers"
import { getLink } from "../../src/db"

function authed(path: string, init?: RequestInit, env?: Env): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/links", () => {
  let env: Env

  beforeEach(async () => {
    env = makeEnv()
    await applyMigrations(env)
  })

  it("POST creates a link and embeds title+description", async () => {
    const res = await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com",
        title: "Example",
        description: "An example domain",
        tags: ["sample"],
        favicon: null
      })
    }, env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; created: boolean }
    expect(body.created).toBe(true)
    expect(env.VECTORS.upsert).toHaveBeenCalled()
  })

  it("POST with the same URL updates the existing row (200)", async () => {
    await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", title: "v1" })
    }, env)
    const res = await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", title: "v2" })
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; created: boolean }
    expect(body.created).toBe(false)
    expect((await getLink(env, body.id))?.title).toBe("v2")
  })

  it("GET /api/links lists rows newest-first", async () => {
    for (const u of ["https://a.com", "https://b.com", "https://c.com"]) {
      await authed("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u, title: u })
      }, env)
    }
    const res = await authed("/api/links", undefined, env)
    const body = (await res.json()) as { links: { url: string }[] }
    expect(body.links.map((l) => l.url)).toEqual(["https://c.com", "https://b.com", "https://a.com"])
  })

  it("GET /api/links?tag=red filters by tag", async () => {
    await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://a.com", title: "a", tags: ["red"] })
    }, env)
    await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://b.com", title: "b", tags: ["blue"] })
    }, env)
    const res = await authed("/api/links?tag=red", undefined, env)
    const body = (await res.json()) as { links: { url: string }[] }
    expect(body.links.map((l) => l.url)).toEqual(["https://a.com"])
  })

  it("GET /api/links/:id returns 404 when missing", async () => {
    const res = await authed("/api/links/nope", undefined, env)
    expect(res.status).toBe(404)
  })

  it("DELETE removes the row and its vectors", async () => {
    const create = await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://x.com", title: "x" })
    }, env)
    const { id } = (await create.json()) as { id: string }
    const res = await authed(`/api/links/${id}`, { method: "DELETE" }, env)
    expect(res.status).toBe(204)
    expect(await getLink(env, id)).toBeNull()
    expect(env.VECTORS.deleteByIds).toHaveBeenCalled()
  })

  it("rejects missing url with 400", async () => {
    const res = await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "no url" })
    }, env)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Implement `worker/src/routes/links.ts`**

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import { deleteLink, getLink, listLinks, upsertLink, type LinkRow } from "../db"
import { deleteFor, upsertFor } from "../vectors"
import { ulid } from "../ulid"

const links = new Hono<{ Bindings: Env }>()

interface PostBody {
  id?: string
  url?: string
  title?: string
  description?: string | null
  tags?: string[]
  favicon?: string | null
  source?: string
}

links.post("/", async (c) => {
  const body = await c.req.json<PostBody>().catch(() => null)
  if (!body || !body.url || !body.title) {
    return c.json({ error: { code: "bad_request", message: "url, title required" } }, 400)
  }
  const now = Date.now()
  const id = body.id ?? ulid()
  const row: LinkRow = {
    id,
    url: body.url,
    title: body.title,
    description: body.description ?? null,
    tags: JSON.stringify(body.tags ?? []),
    favicon: body.favicon ?? null,
    source: body.source ?? "manual",
    chunk_count: 0,
    created_at: now,
    updated_at: now
  }
  const { id: actualId, created } = await upsertLink(c.env, row)

  // For updates, prune trailing vectors when text shrinks.
  const before = created ? null : await getLink(c.env, actualId)

  const embedText = [body.title, body.description ?? "", (body.tags ?? []).join(" ")].filter(Boolean).join("\n")
  const { chunkCount } = await upsertFor(c.env, "link", actualId, embedText, {
    title: body.title, createdAt: now
  })
  if (before && chunkCount < before.chunk_count) {
    const ids: string[] = []
    for (let i = chunkCount; i < before.chunk_count; i++) ids.push(`link:${actualId}:${i}`)
    if (ids.length) await c.env.VECTORS.deleteByIds(ids)
  }
  // Persist chunk_count
  await c.env.DB.prepare("UPDATE links SET chunk_count = ?, updated_at = ? WHERE id = ?")
    .bind(chunkCount, now, actualId).run()

  return c.json({ id: actualId, created, chunkCount }, created ? 201 : 200)
})

links.get("/", async (c) => {
  const tag = c.req.query("tag") ?? undefined
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined
  const rows = await listLinks(c.env, { tag, limit, before })
  return c.json({ links: rows })
})

links.get("/:id", async (c) => {
  const row = await getLink(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such link" } }, 404)
  return c.json(row)
})

links.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getLink(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "link", id, existing.chunk_count)
  await deleteLink(c.env, id)
  return c.body(null, 204)
})

export default links
```

- [ ] **Step 3: Wire links into `worker/src/index.ts`**

Insert `app.route("/api/links", links)` after the conversations line:

```ts
import { Hono } from "hono"
import { requireToken } from "./auth"
import conversations from "./routes/conversations"
import links from "./routes/links"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.route("/api/conversations", conversations)
app.route("/api/links", links)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
```

- [ ] **Step 4: Run links tests**

```bash
cd worker && pnpm test links.test
```
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/links.ts worker/src/index.ts worker/tests/routes/links.test.ts
git commit -m "feat(worker): /api/links CRUD with URL upsert + inline embedding"
```

---

## Task 8: Search route

**Files:**
- Create: `worker/src/routes/search.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/routes/search.test.ts`

- [ ] **Step 1: Write the test** — `worker/tests/routes/search.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest"
import app from "../../src/index"
import type { Env } from "../../src/env"
import { applyMigrations, makeEnv } from "../helpers"

function authed(path: string, init?: RequestInit, env?: Env): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("/api/search", () => {
  let env: Env

  beforeEach(async () => {
    env = makeEnv()
    await applyMigrations(env)
  })

  it("returns [] for empty query", async () => {
    const res = await authed("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" })
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: unknown[] }
    expect(body.results).toEqual([])
  })

  it("finds an indexed conversation", async () => {
    await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "widgets", content_text: "talking about widgets", started_at: 1, message_count: 1 })
    }, env)
    const res = await authed("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "widgets" })
    }, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: { type: string; title: string }[] }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results[0].type).toBe("conversation")
  })

  it("respects the types filter", async () => {
    await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ backend: "claude", title: "c", content_text: "x", started_at: 1, message_count: 1 })
    }, env)
    await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com", title: "L" })
    }, env)

    const res = await authed("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x", types: ["link"] })
    }, env)
    const body = (await res.json()) as { results: { type: string }[] }
    for (const r of body.results) expect(r.type).toBe("link")
  })

  it("rejects malformed body with 400", async () => {
    const res = await authed("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json"
    }, env)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Implement `worker/src/routes/search.ts`**

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import { search, type ResourceType } from "../vectors"

const router = new Hono<{ Bindings: Env }>()

interface PostBody {
  query?: string
  types?: ResourceType[]
  limit?: number
}

const KNOWN_TYPES: ResourceType[] = ["conversation", "link", "bookmark", "recording", "pdf"]

router.post("/", async (c) => {
  const body = await c.req.json<PostBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const query = (body.query ?? "").trim()
  if (!query) return c.json({ results: [] })

  const types = body.types?.filter((t): t is ResourceType => KNOWN_TYPES.includes(t))
  const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 20

  const hits = await search(c.env, query, { types, limit })
  return c.json({
    results: hits.map((h) => ({
      type: h.metadata.type,
      id: h.metadata.id,
      chunkIndex: h.metadata.chunkIndex,
      score: h.score,
      title: h.metadata.title,
      snippet: h.metadata.snippet,
      createdAt: h.metadata.createdAt
    }))
  })
})

export default router
```

- [ ] **Step 3: Wire into `worker/src/index.ts`**

```ts
import { Hono } from "hono"
import { requireToken } from "./auth"
import conversations from "./routes/conversations"
import links from "./routes/links"
import search from "./routes/search"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.route("/api/conversations", conversations)
app.route("/api/links", links)
app.route("/api/search", search)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
```

- [ ] **Step 4: Run search tests**

```bash
cd worker && pnpm test search.test
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/search.ts worker/src/index.ts worker/tests/routes/search.test.ts
git commit -m "feat(worker): /api/search semantic-query endpoint"
```

---

## Task 9: Provision Cloudflare resources and first deploy

**Files:**
- Modify: `worker/wrangler.toml`

This task talks to Cloudflare. Each command must succeed before continuing. Replace `<ACCOUNT_ID>` and the printed ids in `wrangler.toml` as instructed.

- [ ] **Step 1: Authenticate Wrangler if needed**

```bash
cd worker && pnpm exec wrangler whoami
```
If the command says you're not logged in, run `pnpm exec wrangler login` and complete the browser flow.

- [ ] **Step 2: Create the D1 database**

```bash
cd worker && pnpm exec wrangler d1 create sidebar
```
Expected output includes `database_id = "..."`. Copy that id.

- [ ] **Step 3: Paste the D1 id into `worker/wrangler.toml`**

Replace `REPLACE_WITH_D1_ID` with the id printed above. Save the file.

- [ ] **Step 4: Create the Vectorize index**

```bash
cd worker && pnpm exec wrangler vectorize create sidebar-search --dimensions=768 --metric=cosine
```
Expected: `Created index 'sidebar-search'`.

- [ ] **Step 5: Apply the migration locally and remotely**

```bash
cd worker && pnpm d1:migrate:local
cd worker && pnpm d1:migrate:remote
```
Expected: each command prints `🚣 Executed 1 command` (the 0001_init.sql migration).

- [ ] **Step 6: Set the shared-secret SIDEBAR_TOKEN**

Generate a 32-byte hex token locally:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Save the printed value to a password manager. Then push it as a Worker secret:
```bash
cd worker && pnpm exec wrangler secret put SIDEBAR_TOKEN
# Paste the same value when prompted, press Enter.
```

- [ ] **Step 7: Deploy**

```bash
cd worker && pnpm deploy
```
Expected: a URL like `https://sidebar-api.<account>.workers.dev`. Capture it.

- [ ] **Step 8: Smoke-test the deploy**

```bash
TOKEN=<your token>
URL=https://sidebar-api.<account>.workers.dev

# Health route — no auth needed
curl -fsS "$URL/api/health"

# Auth gate
curl -s "$URL/api/conversations" -o /dev/null -w "%{http_code}\n"   # → 401
curl -fsS -H "X-Sidebar-Token: $TOKEN" "$URL/api/conversations"      # → { "conversations": [] }

# Create + search round-trip
curl -fsS -H "X-Sidebar-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/conversations" \
  -d '{"backend":"claude","title":"hello widgets","content_text":"talking about widgets","started_at":1,"message_count":1}'

curl -fsS -H "X-Sidebar-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/search" \
  -d '{"query":"widgets"}'
```
Expected: the search response includes a result with `type: "conversation"`.

- [ ] **Step 9: Commit the populated wrangler.toml**

```bash
git add worker/wrangler.toml
git commit -m "chore(worker): wire wrangler.toml to provisioned D1 + Vectorize"
```

---

## Task 10: Integration smoke test in CI

**Files:**
- Create: `worker/tests/integration.test.ts`

- [ ] **Step 1: Write the round-trip test**

```ts
import { beforeEach, describe, expect, it } from "vitest"
import app from "../src/index"
import type { Env } from "../src/env"
import { applyMigrations, makeEnv } from "./helpers"

function authed(path: string, init?: RequestInit, env?: Env): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set("x-sidebar-token", "test-token")
  return app.fetch(new Request(`http://x${path}`, { ...init, headers }), env)
}

describe("integration: create → search", () => {
  let env: Env
  beforeEach(async () => {
    env = makeEnv()
    await applyMigrations(env)
  })

  it("conversations are searchable end-to-end", async () => {
    const create = await authed("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        backend: "claude",
        title: "Widget design notes",
        content_text: "We talked about widget colors and ergonomics.",
        started_at: 100,
        message_count: 3
      })
    }, env)
    expect(create.status).toBe(201)

    const search = await authed("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "widget colors" })
    }, env)
    const body = (await search.json()) as { results: { type: string; title: string }[] }
    expect(body.results[0].type).toBe("conversation")
    expect(body.results[0].title).toBe("Widget design notes")
  })

  it("links are searchable end-to-end", async () => {
    const create = await authed("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://example.com/cf-workers",
        title: "Cloudflare Workers docs",
        description: "Edge runtime + bindings"
      })
    }, env)
    expect(create.status).toBe(201)

    const search = await authed("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "cloudflare", types: ["link"] })
    }, env)
    const body = (await search.json()) as { results: { type: string }[] }
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results.every((r) => r.type === "link")).toBe(true)
  })
})
```

- [ ] **Step 2: Run the full worker test suite**

```bash
cd worker && pnpm test
```
Expected: all tests pass.

- [ ] **Step 3: Run typecheck**

```bash
cd worker && pnpm typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add worker/tests/integration.test.ts
git commit -m "test(worker): integration smoke covering create → search"
```

---

## Task 11: Wire the worker into existing CI

**Files:**
- Modify: `.github/workflows/test.yml` (path may differ — confirm with `ls .github/workflows/`)

- [ ] **Step 1: Inspect the existing workflow**

```bash
cat .github/workflows/test.yml
```
Note the Node version, pnpm setup, and how `pnpm test` is invoked for the extension.

- [ ] **Step 2: Add a worker job that mirrors the extension job**

In `.github/workflows/test.yml`, add a new job below the existing test job. Example shape (adapt to the file's actual structure):

```yaml
  worker:
    name: Worker tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: worker
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: "pnpm", cache-dependency-path: worker/pnpm-lock.yaml }
      - run: pnpm install --ignore-scripts
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: run worker typecheck + tests on every PR"
```

- [ ] **Step 4: Push and verify CI runs green**

```bash
git push
```
Open the PR (or branch) on GitHub and confirm the new `Worker tests` job appears and passes.

---

## Self-review (done by the author before opening PRs)

**1. Spec coverage** — every Phase 1 spec section is exercised:
- §3 architecture / bindings → Task 1 (wrangler.toml), Task 2 (Env)
- §4 schema → Task 4 (0001_init.sql, db.ts)
- §5.1 health + search → Tasks 1, 8
- §5.2 conversations CRUD → Task 6
- §5.3 links CRUD → Task 7
- §7 auth → Task 3
- §13 deployment + secrets → Task 9
- §11 testing (vitest-pool-workers, per-route happy path / 401 / 404 / 400) → Tasks 3-10

Phase 1 explicitly does NOT cover §5.4 (bookmarks), §5.5 (recordings), §5.6 (pdfs), §6 (workflow), §8 (web UI), §9 (extension client) — those are phases 2-5.

**2. Placeholder scan** — no TBD/TODO/"add error handling" in the plan.

**3. Type consistency** — `ConversationRow`, `LinkRow`, `ResourceType`, `Env` defined once in `db.ts`/`vectors.ts`/`env.ts` and imported elsewhere. Function names match across tasks (`upsertFor`, `deleteFor`, `chunkAndEmbed`, `search`).

**4. Cross-task dependencies** — every helper a route uses (`upsertFor`, `deleteFor`, `getConversation`, `upsertLink`, etc.) is defined in an earlier task. No forward references.

---

## Done criteria for Phase 1

- `pnpm test` in `worker/` passes.
- `pnpm typecheck` in `worker/` passes.
- The deployed Worker answers `GET /api/health` from the public URL.
- A token-authenticated `POST /api/conversations` followed by `POST /api/search` returns the conversation as a hit.
- A token-authenticated `POST /api/links` followed by `POST /api/search` returns the link as a hit.
- CI runs Worker tests on every PR.
