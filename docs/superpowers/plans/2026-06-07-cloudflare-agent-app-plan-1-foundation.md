# Cloudflare Agent App — Plan 1: Foundation (Scaffold + Auth + Agent/D1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new `agent-app/` Cloudflare Worker (Hono API + Agents SDK Durable Object) that authenticates via Cloudflare Access (service token *or* SSO JWT) and persists chat sessions/messages to the shared `sidebar` D1.

**Architecture:** A single Worker exports a Hono app wrapped with `hono-agents` middleware. `/api/*` routes are guarded by a dual-mode auth middleware. A `ChatAgent` Durable Object (Cloudflare Agents SDK) holds live session state and writes a durable ledger to the shared D1 (`agent_sessions`, `agent_messages`). LLM streaming and the model picker are deliberately out of scope here (Plan 2) — turns are echoed so the pipeline is end-to-end testable now.

**Tech Stack:** TypeScript, Hono, `agents` + `hono-agents` (Cloudflare Agents SDK), Cloudflare Workers (D1 / KV / Durable Objects), Wrangler, Vitest with the `node:sqlite` D1 adapter.

**Covers spec sections:** §1 (topology, minus TanStack Start UI → Plan 7), §2 (agent runtime), §3 (D1 + KV bindings), §5 (auth + Doppler). §4 models, §6 sidebar tab, §7 web UI, Hindsight (§3 Hindsight half) are later plans.

---

## File structure (created by this plan)

```
agent-app/
  package.json            # deps + scripts (dev, deploy, test, typecheck, d1:migrate)
  tsconfig.json
  wrangler.toml           # bindings: DB, BLOBS, VECTORS, AI, AGENT_KV, CHAT_AGENT (DO)
  vitest.config.ts
  DEPLOY.md               # Doppler-wrapped deploy + Access setup notes
  migrations/
    0001_agent_core.sql   # agent_sessions, agent_messages, agent_memories
  src/
    env.ts                # Env interface + constants
    index.ts              # Hono app + hono-agents middleware + fetch entry
    auth.ts               # dual-mode Access auth middleware (service token | SSO JWT)
    access-jwt.ts         # Access JWT (JWKS) verification helper
    db.ts                 # D1 row types + session/message queries
    ulid.ts               # copied from worker/src/ulid.ts (id generation)
    agents/
      chat-agent.ts       # ChatAgent Durable Object (Agents SDK)
    routes/
      sessions.ts         # /api/sessions CRUD + message append (calls the DO)
  tests/
    helpers.ts            # makeEnv() with node:sqlite D1 + stubs (adapted from worker)
    auth.test.ts
    access-jwt.test.ts
    db.test.ts
    sessions.test.ts
```

---

## Task 1: Scaffold the project skeleton

**Files:**
- Create: `agent-app/package.json`
- Create: `agent-app/tsconfig.json`
- Create: `agent-app/vitest.config.ts`

- [ ] **Step 1: Create `agent-app/package.json`**

```json
{
  "name": "agent-app",
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
    "agents": "^0.2.0",
    "hono": "^4.6.0",
    "hono-agents": "^0.2.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260520.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.7",
    "wrangler": "^4.0.0"
  }
}
```

> NOTE for implementer: pin `agents` / `hono-agents` to the latest published versions at install time (`npm view agents version`); the `^0.2.0` above is a floor. Run `pnpm install` inside `agent-app/`.

- [ ] **Step 2: Create `agent-app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types", "node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "verbatimModuleSyntax": false,
    "experimentalDecorators": true,
    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `agent-app/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
})
```

- [ ] **Step 4: Install and verify typecheck runs**

Run: `cd agent-app && pnpm install && pnpm typecheck`
Expected: PASS (no source files yet → tsc succeeds with no errors).

- [ ] **Step 5: Commit**

```bash
git add agent-app/package.json agent-app/tsconfig.json agent-app/vitest.config.ts agent-app/pnpm-lock.yaml
git commit -m "chore(agent-app): scaffold project skeleton"
```

---

## Task 2: Wrangler config + bindings

**Files:**
- Create: `agent-app/wrangler.toml`

- [ ] **Step 1: Create `agent-app/wrangler.toml`**

```toml
name = "agent-app"
main = "src/index.ts"
compatibility_date = "2025-01-28"
compatibility_flags = ["nodejs_compat"]

[[routes]]
pattern = "agent.fly.pm"
custom_domain = true

# Shared with worker/ (sidebar-api). Same database_id so data is shared.
[[d1_databases]]
binding = "DB"
database_name = "sidebar"
database_id = "5de7b694-0bc8-4073-9c3b-497076216901"
migrations_dir = "./migrations"

# Shared R2 bucket.
[[r2_buckets]]
binding = "BLOBS"
bucket_name = "sidebar-blobs"

# Shared Vectorize index.
[[vectorize]]
binding = "VECTORS"
index_name = "sidebar-search"

# Workers AI through gateway "x" (used in Plan 2).
[ai]
binding = "AI"

# New KV namespace for model catalog cache + per-user prefs.
# Create with: wrangler kv namespace create agent-kv  (paste the id below)
[[kv_namespaces]]
binding = "AGENT_KV"
id = "REPLACE_WITH_KV_ID"

# Agents SDK Durable Object.
[[durable_objects.bindings]]
name = "CHAT_AGENT"
class_name = "ChatAgent"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChatAgent"]
```

- [ ] **Step 2: Create the KV namespace and paste its id**

Run: `cd agent-app && wrangler kv namespace create agent-kv`
Then replace `REPLACE_WITH_KV_ID` in `wrangler.toml` with the printed `id`.
Expected: command prints a namespace `id`.

> If not authenticated to Cloudflare, this is the one manual step — tell the user to run `! wrangler login` or supply `CLOUDFLARE_API_TOKEN`. Leave the placeholder if unavailable and note it in DEPLOY.md.

- [ ] **Step 3: Commit**

```bash
git add agent-app/wrangler.toml
git commit -m "chore(agent-app): wrangler config with shared + new bindings"
```

---

## Task 3: Env types + ulid

**Files:**
- Create: `agent-app/src/env.ts`
- Create: `agent-app/src/ulid.ts` (copy of `worker/src/ulid.ts`)

- [ ] **Step 1: Copy ulid helper**

Run: `cp worker/src/ulid.ts agent-app/src/ulid.ts`
Expected: file exists. (It exports `ulid(): string`.)

- [ ] **Step 2: Create `agent-app/src/env.ts`**

```ts
import type { ChatAgent } from "./agents/chat-agent"

// Bindings declared in wrangler.toml + secrets managed via Doppler.
export interface Env {
  DB: D1Database
  BLOBS: R2Bucket
  VECTORS: VectorizeIndex
  AI: Ai
  AGENT_KV: KVNamespace
  CHAT_AGENT: DurableObjectNamespace<ChatAgent>

  // --- Cloudflare Access secrets (Doppler → wrangler secret put) ---
  /** Access service-token client id the extension must present. */
  ACCESS_CLIENT_ID?: string
  /** Access service-token client secret the extension must present. */
  ACCESS_CLIENT_SECRET?: string
  /** Access application audience (AUD) tag for SSO JWT verification. */
  ACCESS_AUD?: string
  /** Access team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string

  // --- AI Gateway (used in Plan 2) ---
  CF_ACCOUNT_ID?: string
  CF_AIG_TOKEN?: string
}

// AI Gateway id per CLAUDE.md. Dynamic routes are broken inside a Worker;
// Plan 2 routes specific @cf/* models through gateway "x".
export const AI_GATEWAY_ID = "x" as const
```

- [ ] **Step 3: Commit**

```bash
git add agent-app/src/env.ts agent-app/src/ulid.ts
git commit -m "feat(agent-app): env types and ulid helper"
```

---

## Task 4: D1 migration for agent core tables

**Files:**
- Create: `agent-app/migrations/0001_agent_core.sql`

- [ ] **Step 1: Create `agent-app/migrations/0001_agent_core.sql`**

```sql
-- Agent app core tables. Lives in the shared "sidebar" D1.
-- Prefixed agent_ to avoid collision with sidebar-api tables.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id          TEXT PRIMARY KEY,        -- ulid
  user_id     TEXT NOT NULL,           -- Access identity (email or service-token id)
  title       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user
  ON agent_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id          TEXT PRIMARY KEY,        -- ulid
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,           -- 'user' | 'assistant' | 'system'
  content     TEXT NOT NULL,
  model       TEXT,                    -- model/route used (null for user msgs)
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES agent_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session
  ON agent_messages(session_id, created_at ASC);

-- Mirror/index of Hindsight memories (populated in a later plan).
CREATE TABLE IF NOT EXISTS agent_memories (
  id          TEXT PRIMARY KEY,        -- ulid
  user_id     TEXT NOT NULL,
  session_id  TEXT,                    -- nullable: cross-session memories
  kind        TEXT NOT NULL,           -- 'fact' | 'reflection' | 'mental_model'
  content     TEXT NOT NULL,
  hindsight_ref TEXT,                  -- external Hindsight id, if any
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_user
  ON agent_memories(user_id, created_at DESC);
```

- [ ] **Step 2: Apply locally**

Run: `cd agent-app && pnpm d1:migrate:local`
Expected: migration `0001_agent_core.sql` applied; "3 tables" created.

- [ ] **Step 3: Commit**

```bash
git add agent-app/migrations/0001_agent_core.sql
git commit -m "feat(agent-app): D1 migration for agent core tables"
```

---

## Task 5: Test harness (node:sqlite D1 adapter)

**Files:**
- Create: `agent-app/tests/helpers.ts`

- [ ] **Step 1: Create `agent-app/tests/helpers.ts`**

Adapted from `worker/tests/helpers.ts` — applies the migration SQL into an in-memory SQLite and wraps it as a D1 `Database`.

```ts
import { vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import type { Env } from "../src/env"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

type SqliteStmt = {
  run: (...p: unknown[]) => { changes: number; lastInsertRowid: bigint | number }
  get: (...p: unknown[]) => unknown
  all: (...p: unknown[]) => unknown[]
}
type DatabaseSync = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStmt
}

function loadSqlite(): { DatabaseSync: new (path: string) => DatabaseSync } {
  return require("node:sqlite")
}

function applyMigrations(db: DatabaseSync): void {
  const sql = readFileSync(
    join(__dirname, "..", "migrations", "0001_agent_core.sql"),
    "utf8"
  )
  db.exec(sql)
}

// Minimal D1 shim over node:sqlite. Supports the prepare().bind().run/first/all
// surface our queries use.
function wrapAsD1(sqlite: DatabaseSync): D1Database {
  const makePrepared = (sql: string, bound: unknown[] = []) => ({
    bind: (...params: unknown[]) => makePrepared(sql, params),
    run: async () => {
      const r = sqlite.prepare(sql).run(...bound)
      return { success: true, meta: { changes: r.changes } }
    },
    first: async (col?: string) => {
      const row = sqlite.prepare(sql).get(...bound) as Record<string, unknown> | undefined
      if (!row) return null
      return col ? (row[col] ?? null) : row
    },
    all: async () => {
      const rows = sqlite.prepare(sql).all(...bound)
      return { results: rows, success: true, meta: {} }
    }
  })
  return { prepare: (sql: string) => makePrepared(sql) } as unknown as D1Database
}

export function makeEnv(overrides?: Partial<Env>): Env {
  const { DatabaseSync } = loadSqlite()
  const sqlite = new DatabaseSync(":memory:")
  applyMigrations(sqlite)
  const db = wrapAsD1(sqlite)

  return {
    DB: db,
    BLOBS: {} as R2Bucket,
    VECTORS: {} as VectorizeIndex,
    AI: { run: vi.fn() } as unknown as Ai,
    AGENT_KV: makeFakeKV(),
    CHAT_AGENT: {} as DurableObjectNamespace,
    ACCESS_CLIENT_ID: "svc-client-id",
    ACCESS_CLIENT_SECRET: "svc-client-secret",
    ACCESS_AUD: "test-aud",
    ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    ...overrides
  } as Env
}

function makeFakeKV(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k)
  } as unknown as KVNamespace
}
```

- [ ] **Step 2: Smoke-test the harness compiles**

Run: `cd agent-app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent-app/tests/helpers.ts
git commit -m "test(agent-app): node:sqlite D1 test harness"
```

---

## Task 6: Access JWT verification helper

**Files:**
- Create: `agent-app/src/access-jwt.ts`
- Test: `agent-app/tests/access-jwt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { verifyAccessJwt } from "../src/access-jwt"

describe("verifyAccessJwt", () => {
  it("returns null for an empty token", async () => {
    const r = await verifyAccessJwt("", "aud", "team.cloudflareaccess.com")
    expect(r).toBeNull()
  })

  it("returns null for a malformed token (not 3 segments)", async () => {
    const r = await verifyAccessJwt("abc.def", "aud", "team.cloudflareaccess.com")
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/access-jwt.test.ts`
Expected: FAIL — cannot find module `../src/access-jwt`.

- [ ] **Step 3: Write the implementation**

```ts
// Verifies a Cloudflare Access SSO JWT (Cf-Access-Jwt-Assertion) against the
// team's JWKS. Returns the verified identity (email/sub) or null. Uses Web
// Crypto only — no node deps — so it runs in the Worker. JWKS is fetched from
// https://<team>/cdn-cgi/access/certs and cached in module memory.

interface AccessIdentity {
  sub: string
  email?: string
}

interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}

let jwksCache: { domain: string; keys: Jwk[]; fetchedAt: number } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  if (
    jwksCache &&
    jwksCache.domain === teamDomain &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!res.ok) return []
  const body = (await res.json()) as { keys: Jwk[] }
  jwksCache = { domain: teamDomain, keys: body.keys ?? [], fetchedAt: Date.now() }
  return jwksCache.keys
}

export async function verifyAccessJwt(
  token: string,
  expectedAud: string,
  teamDomain: string
): Promise<AccessIdentity | null> {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null

  let header: { kid?: string; alg?: string }
  let payload: {
    aud?: string | string[]
    exp?: number
    iss?: string
    sub?: string
    email?: string
  }
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]!)))
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!)))
  } catch {
    return null
  }

  // Standard claim checks.
  if (payload.exp && payload.exp * 1000 < Date.now()) return null
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : []
  if (!auds.includes(expectedAud)) return null
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return null

  const jwks = await getJwks(teamDomain)
  const jwk = jwks.find((k) => k.kid === header.kid)
  if (!jwk) return null

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  )
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  const sig = b64urlToBytes(parts[2]!)
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed)
  if (!ok) return null

  return { sub: payload.sub ?? payload.email ?? "unknown", email: payload.email }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/access-jwt.test.ts`
Expected: PASS (2 passing). The empty/malformed paths short-circuit before any network call.

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/access-jwt.ts agent-app/tests/access-jwt.test.ts
git commit -m "feat(agent-app): Cloudflare Access JWT verification helper"
```

---

## Task 7: Dual-mode auth middleware

**Files:**
- Create: `agent-app/src/auth.ts`
- Test: `agent-app/tests/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { requireAccess } from "../src/auth"
import type { Env } from "../src/env"
import { makeEnv } from "./helpers"

function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>()
  app.use("/api/*", requireAccess())
  app.get("/api/health", (c) => c.json({ ok: true }))
  app.get("/api/whoami", (c) => c.json({ userId: c.get("userId") }))
  return app
}

describe("requireAccess", () => {
  const env = makeEnv()

  it("lets /api/health through unauthenticated", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/health"), env)
    expect(res.status).toBe(200)
  })

  it("401s a guarded route with no credentials", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/whoami"), env)
    expect(res.status).toBe(401)
  })

  it("accepts a valid service token and sets userId", async () => {
    const req = new Request("http://x/api/whoami", {
      headers: {
        "cf-access-client-id": "svc-client-id",
        "cf-access-client-secret": "svc-client-secret"
      }
    })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { userId: string }
    expect(body.userId).toBe("svc-client-id")
  })

  it("401s a wrong service-token secret", async () => {
    const req = new Request("http://x/api/whoami", {
      headers: {
        "cf-access-client-id": "svc-client-id",
        "cf-access-client-secret": "WRONG"
      }
    })
    const res = await buildApp().fetch(req, env)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/auth.test.ts`
Expected: FAIL — cannot find module `../src/auth`.

- [ ] **Step 3: Write the implementation**

```ts
import type { MiddlewareHandler } from "hono"
import type { Env } from "./env"
import { verifyAccessJwt } from "./access-jwt"

type Vars = { userId: string }

/**
 * Dual-mode Cloudflare Access auth:
 *  - Service token: CF-Access-Client-Id / CF-Access-Client-Secret matched
 *    (constant-time) against ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET. Used by
 *    the sidebar extension. userId = the client id.
 *  - SSO JWT: Cf-Access-Jwt-Assertion verified against the team JWKS. Used by
 *    the web UI. userId = the verified email/sub.
 * /api/health is allow-listed.
 */
export function requireAccess(): MiddlewareHandler<{ Bindings: Env; Variables: Vars }> {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next()

    // 1. Service token
    const cid = c.req.header("cf-access-client-id")
    const csec = c.req.header("cf-access-client-secret")
    if (cid && csec) {
      const wantId = c.env.ACCESS_CLIENT_ID ?? ""
      const wantSec = c.env.ACCESS_CLIENT_SECRET ?? ""
      if (wantId && wantSec && timingSafeEqual(cid, wantId) && timingSafeEqual(csec, wantSec)) {
        c.set("userId", cid)
        return next()
      }
      return unauthorized(c)
    }

    // 2. SSO JWT
    const jwt = c.req.header("cf-access-jwt-assertion")
    if (jwt && c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN) {
      const id = await verifyAccessJwt(jwt, c.env.ACCESS_AUD, c.env.ACCESS_TEAM_DOMAIN)
      if (id) {
        c.set("userId", id.email ?? id.sub)
        return next()
      }
    }

    return unauthorized(c)
  }
}

function unauthorized(c: Parameters<MiddlewareHandler>[0]) {
  return c.json({ error: { code: "unauthorized", message: "Access denied" } }, 401)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/auth.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/auth.ts agent-app/tests/auth.test.ts
git commit -m "feat(agent-app): dual-mode Cloudflare Access auth middleware"
```

---

## Task 8: D1 query layer

**Files:**
- Create: `agent-app/src/db.ts`
- Test: `agent-app/tests/db.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import {
  createSession,
  listSessions,
  insertMessage,
  listMessages
} from "../src/db"

describe("db", () => {
  it("creates and lists sessions for a user", async () => {
    const env = makeEnv()
    const s = await createSession(env, "user-a", "First chat")
    expect(s.id).toBeTruthy()
    const list = await listSessions(env, "user-a")
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe("First chat")
  })

  it("scopes sessions by user", async () => {
    const env = makeEnv()
    await createSession(env, "user-a", "A")
    await createSession(env, "user-b", "B")
    expect(await listSessions(env, "user-a")).toHaveLength(1)
  })

  it("inserts and lists messages in created_at order", async () => {
    const env = makeEnv()
    const s = await createSession(env, "user-a", "chat")
    await insertMessage(env, { sessionId: s.id, role: "user", content: "hi", model: null })
    await insertMessage(env, {
      sessionId: s.id,
      role: "assistant",
      content: "hello",
      model: "echo"
    })
    const msgs = await listMessages(env, s.id)
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(msgs[1]!.model).toBe("echo")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/db.test.ts`
Expected: FAIL — cannot find module `../src/db`.

- [ ] **Step 3: Write the implementation**

```ts
import type { Env } from "./env"
import { ulid } from "./ulid"

export interface SessionRow {
  id: string
  user_id: string
  title: string
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  model: string | null
  created_at: number
}

export async function createSession(
  env: Env,
  userId: string,
  title: string
): Promise<SessionRow> {
  const now = Date.now()
  const row: SessionRow = {
    id: ulid(),
    user_id: userId,
    title,
    created_at: now,
    updated_at: now
  }
  await env.DB.prepare(
    `INSERT INTO agent_sessions (id, user_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.user_id, row.title, row.created_at, row.updated_at)
    .run()
  return row
}

export async function listSessions(env: Env, userId: string): Promise<SessionRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC`
  )
    .bind(userId)
    .all()
  return (res.results ?? []) as unknown as SessionRow[]
}

export async function getSession(
  env: Env,
  userId: string,
  id: string
): Promise<SessionRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM agent_sessions WHERE id = ? AND user_id = ?`
  )
    .bind(id, userId)
    .first()
  return (row as unknown as SessionRow) ?? null
}

export async function insertMessage(
  env: Env,
  m: { sessionId: string; role: string; content: string; model: string | null }
): Promise<MessageRow> {
  const row: MessageRow = {
    id: ulid(),
    session_id: m.sessionId,
    role: m.role,
    content: m.content,
    model: m.model,
    created_at: Date.now()
  }
  await env.DB.prepare(
    `INSERT INTO agent_messages (id, session_id, role, content, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.session_id, row.role, row.content, row.model, row.created_at)
    .run()
  await env.DB.prepare(`UPDATE agent_sessions SET updated_at = ? WHERE id = ?`)
    .bind(row.created_at, m.sessionId)
    .run()
  return row
}

export async function listMessages(env: Env, sessionId: string): Promise<MessageRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC`
  )
    .bind(sessionId)
    .all()
  return (res.results ?? []) as unknown as MessageRow[]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/db.test.ts`
Expected: PASS (3 passing).

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/db.ts agent-app/tests/db.test.ts
git commit -m "feat(agent-app): D1 session/message query layer"
```

---

## Task 9: ChatAgent Durable Object (Agents SDK)

**Files:**
- Create: `agent-app/src/agents/chat-agent.ts`

This task has no standalone unit test (the DO runtime needs `wrangler dev`/Miniflare which this repo's harness can't init — see the memory note on vitest-pool-workers). It is exercised end-to-end via the `/api/sessions` route test in Task 10, which calls the agent through a stubbed namespace. The DO logic that touches D1 is kept thin and delegates to `src/db.ts` (already tested).

- [ ] **Step 1: Create `agent-app/src/agents/chat-agent.ts`**

```ts
import { Agent } from "agents"
import type { Env } from "../env"
import { insertMessage } from "../db"

export interface ChatAgentState {
  sessionId: string | null
  // Live mirror of the turn currently being assembled. Full history is the
  // D1 ledger; this is just hot working state for the Session API.
  lastTurn: { user: string; assistant: string } | null
}

/**
 * ChatAgent — one Durable Object instance per session (named by session id).
 * Plan 1 scope: persist the user message + an echoed assistant reply to D1 so
 * the full request → agent → D1 pipeline is real and testable. Plan 2 replaces
 * `generateReply` with a streamed AI Gateway completion + model selection.
 */
export class ChatAgent extends Agent<Env, ChatAgentState> {
  initialState: ChatAgentState = { sessionId: null, lastTurn: null }

  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }
    const body = (await request.json()) as { sessionId: string; content: string }
    if (!body?.sessionId || !body?.content) {
      return Response.json({ error: "sessionId and content required" }, { status: 400 })
    }

    await insertMessage(this.env, {
      sessionId: body.sessionId,
      role: "user",
      content: body.content,
      model: null
    })

    const reply = this.generateReply(body.content)
    const assistant = await insertMessage(this.env, {
      sessionId: body.sessionId,
      role: "assistant",
      content: reply,
      model: "echo"
    })

    this.setState({
      sessionId: body.sessionId,
      lastTurn: { user: body.content, assistant: reply }
    })

    return Response.json({ message: assistant })
  }

  // Plan 2 swaps this for an AI Gateway streamed completion.
  private generateReply(userContent: string): string {
    return `echo: ${userContent}`
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd agent-app && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add agent-app/src/agents/chat-agent.ts
git commit -m "feat(agent-app): ChatAgent Durable Object with D1-backed turns"
```

---

## Task 10: Sessions routes + app entry

**Files:**
- Create: `agent-app/src/routes/sessions.ts`
- Create: `agent-app/src/index.ts`
- Test: `agent-app/tests/sessions.test.ts`

- [ ] **Step 1: Write the failing test**

The route's message-send path calls the ChatAgent DO via `getAgentByName`. In tests we inject a fake `CHAT_AGENT` namespace whose stub performs the same D1 writes the real DO would, so the route contract is verified without Miniflare.

```ts
import { describe, expect, it, vi } from "vitest"
import { makeEnv } from "./helpers"
import { buildApp } from "../src/index"
import { insertMessage } from "../src/db"
import type { Env } from "../src/env"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret"
}

// Fake DO namespace: get(id) → stub with fetch() that writes to D1 like the
// real ChatAgent.onRequest, returning the assistant message.
function withFakeAgent(env: Env): Env {
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: (_id: { name: string }) => ({
      fetch: async (req: Request) => {
        const body = (await req.json()) as { sessionId: string; content: string }
        await insertMessage(env, {
          sessionId: body.sessionId,
          role: "user",
          content: body.content,
          model: null
        })
        const msg = await insertMessage(env, {
          sessionId: body.sessionId,
          role: "assistant",
          content: `echo: ${body.content}`,
          model: "echo"
        })
        return Response.json({ message: msg })
      }
    })
  }
  return { ...env, CHAT_AGENT: ns as unknown as Env["CHAT_AGENT"] }
}

describe("sessions routes", () => {
  it("creates a session", async () => {
    const env = makeEnv()
    const res = await buildApp().fetch(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { ...SVC, "content-type": "application/json" },
        body: JSON.stringify({ title: "Hello" })
      }),
      env
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { session: { id: string; title: string } }
    expect(body.session.title).toBe("Hello")
  })

  it("sends a message and gets an echoed assistant reply", async () => {
    const env = withFakeAgent(makeEnv())
    const created = await buildApp().fetch(
      new Request("http://x/api/sessions", {
        method: "POST",
        headers: { ...SVC, "content-type": "application/json" },
        body: JSON.stringify({ title: "chat" })
      }),
      env
    )
    const { session } = (await created.json()) as { session: { id: string } }

    const sent = await buildApp().fetch(
      new Request(`http://x/api/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { ...SVC, "content-type": "application/json" },
        body: JSON.stringify({ content: "ping" })
      }),
      env
    )
    expect(sent.status).toBe(200)
    const out = (await sent.json()) as { message: { role: string; content: string } }
    expect(out.message.role).toBe("assistant")
    expect(out.message.content).toBe("echo: ping")
  })

  it("401s without credentials", async () => {
    const res = await buildApp().fetch(
      new Request("http://x/api/sessions", { method: "POST" }),
      makeEnv()
    )
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/sessions.test.ts`
Expected: FAIL — cannot find module `../src/index`.

- [ ] **Step 3: Create `agent-app/src/routes/sessions.ts`**

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import { createSession, getSession, listSessions, listMessages } from "../db"

type Vars = { userId: string }
const sessions = new Hono<{ Bindings: Env; Variables: Vars }>()

// List the caller's sessions.
sessions.get("/", async (c) => {
  const rows = await listSessions(c.env, c.get("userId"))
  return c.json({ sessions: rows })
})

// Create a session.
sessions.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string }
  const row = await createSession(c.env, c.get("userId"), body.title?.trim() || "New chat")
  return c.json({ session: row })
})

// List messages in a session (ownership enforced).
sessions.get("/:id/messages", async (c) => {
  const sess = await getSession(c.env, c.get("userId"), c.req.param("id"))
  if (!sess) return c.json({ error: { code: "not_found", message: "no such session" } }, 404)
  const msgs = await listMessages(c.env, sess.id)
  return c.json({ messages: msgs })
})

// Send a message → routed to the ChatAgent DO (one instance per session id).
sessions.post("/:id/messages", async (c) => {
  const sess = await getSession(c.env, c.get("userId"), c.req.param("id"))
  if (!sess) return c.json({ error: { code: "not_found", message: "no such session" } }, 404)
  const body = (await c.req.json().catch(() => ({}))) as { content?: string }
  if (!body.content?.trim()) {
    return c.json({ error: { code: "bad_request", message: "content required" } }, 400)
  }

  const id = c.env.CHAT_AGENT.idFromName(sess.id)
  const stub = c.env.CHAT_AGENT.get(id)
  const res = await stub.fetch(
    new Request("https://agent/internal/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: sess.id, content: body.content })
    })
  )
  return new Response(res.body, { status: res.status, headers: res.headers })
})

export default sessions
```

- [ ] **Step 4: Create `agent-app/src/index.ts`**

```ts
import { Hono } from "hono"
import { agentsMiddleware } from "hono-agents"
import { requireAccess } from "./auth"
import sessions from "./routes/sessions"
import type { Env } from "./env"

// Re-export so the [[durable_objects]] binding resolves the class.
export { ChatAgent } from "./agents/chat-agent"

type Vars = { userId: string }

export function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>()

  // Agents SDK: handles agent WebSocket upgrades + /agents/* HTTP routing.
  app.use("*", agentsMiddleware())

  // Auth guard for our REST API.
  app.use("/api/*", requireAccess())

  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "agent-app", version: "0.1.0" })
  )

  app.route("/api/sessions", sessions)

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "no such route" } }, 404)
  )

  return app
}

export default buildApp()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/sessions.test.ts`
Expected: PASS (3 passing).

> If `agentsMiddleware()` throws under the plain-node test env (it may expect a DO-capable runtime), wrap its registration so it is skipped when `c.env.CHAT_AGENT` lacks `idFromName`, OR register it only in the default export (real Worker) and not inside `buildApp()` used by tests. Preferred fix: move `app.use("*", agentsMiddleware())` out of `buildApp()` into the default export composition:
> ```ts
> const app = buildApp()
> app.use("*", agentsMiddleware()) // only in the deployed Worker
> export default app
> ```
> Keep `buildApp()` middleware-free of `agentsMiddleware` so tests stay hermetic. Re-run the test after this adjustment.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `cd agent-app && pnpm test && pnpm typecheck`
Expected: all tests PASS, typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add agent-app/src/routes/sessions.ts agent-app/src/index.ts agent-app/tests/sessions.test.ts
git commit -m "feat(agent-app): sessions routes + Hono app entry with agents middleware"
```

---

## Task 11: DEPLOY.md (Doppler + Access setup)

**Files:**
- Create: `agent-app/DEPLOY.md`

- [ ] **Step 1: Create `agent-app/DEPLOY.md`**

````markdown
# agent-app deploy

## Secrets (Doppler → wrangler)

All secrets live in Doppler. Sync to the Worker:

```bash
doppler run -- sh -c '
  echo "$ACCESS_CLIENT_ID"     | wrangler secret put ACCESS_CLIENT_ID
  echo "$ACCESS_CLIENT_SECRET" | wrangler secret put ACCESS_CLIENT_SECRET
  echo "$ACCESS_AUD"           | wrangler secret put ACCESS_AUD
  echo "$ACCESS_TEAM_DOMAIN"   | wrangler secret put ACCESS_TEAM_DOMAIN
  echo "$CF_ACCOUNT_ID"        | wrangler secret put CF_ACCOUNT_ID
  echo "$CF_AIG_TOKEN"         | wrangler secret put CF_AIG_TOKEN
'
```

## Cloudflare Access

1. Create an Access application for `agent.fly.pm` (self-hosted).
2. Note the application **AUD** → `ACCESS_AUD`.
3. Team domain → `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`).
4. Create a **service token** for the extension → `ACCESS_CLIENT_ID` /
   `ACCESS_CLIENT_SECRET`. Add an Access policy allowing that service token.
5. Add a policy allowing your own SSO identity (for the web UI, Plan 7).

## KV namespace

```bash
wrangler kv namespace create agent-kv   # paste id into wrangler.toml
```

## Migrate + deploy

```bash
pnpm d1:migrate:remote
pnpm deploy
```

## Verify

```bash
curl https://agent.fly.pm/api/health        # { ok: true, ... }
curl -X POST https://agent.fly.pm/api/sessions \
  -H "CF-Access-Client-Id: $ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET" \
  -H 'content-type: application/json' -d '{"title":"smoke"}'
```
````

- [ ] **Step 2: Commit**

```bash
git add agent-app/DEPLOY.md
git commit -m "docs(agent-app): deploy + Access + Doppler setup"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §1 topology (Worker + Hono + shared bindings + new KV/DO) → Tasks 1,2,10; TanStack Start UI explicitly deferred to Plan 7. §2 agent runtime → Task 9. §3 D1 tables + KV → Tasks 4,8 (Hindsight memory population deferred). §5 auth (service token + SSO JWT) + Doppler → Tasks 6,7,11. §4 models, §6 sidebar, §7 web UI → later plans (noted in header).
- **Placeholder scan:** No TBDs; the only intentional placeholder is `REPLACE_WITH_KV_ID` in wrangler.toml, resolved by Task 2 Step 2.
- **Type consistency:** `SessionRow`/`MessageRow`, `createSession`/`listSessions`/`insertMessage`/`listMessages`, `requireAccess`, `verifyAccessJwt`, `buildApp`, `ChatAgent`, `CHAT_AGENT` binding name are used identically across env.ts, db.ts, auth.ts, routes, agent, tests.

## Subsequent plans (not in this plan)

- **Plan 2 — Models / AI Gateway:** model catalog, `env.AI.run` CF models (default), hybrid advanced explicit-model path, `/api/models`, streamed `/api/chat`/turn via SSE. Replaces `ChatAgent.generateReply`.
- **Plan 3 — Hindsight self-learning:** retain/recall/reflect + `agent_memories` mirror, recall-into-context on each turn.
- **Plan 4 — Sidebar `agent` tab:** absorb `src/sections/ai-chat`, background orchestrator calling `agent.fly.pm` with the service token, model picker UI.
- **Plan 5 — TanStack Start + TanStack AI web UI:** chat route behind Access SSO, model picker, served by the same Worker.
