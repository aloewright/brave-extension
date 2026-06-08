import { vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
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
  // Apply every numbered migration in order so the test schema tracks prod.
  const dir = join(__dirname, "..", "migrations")
  const files = readdirSync(dir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()
  for (const f of files) {
    db.exec(readFileSync(join(dir, f), "utf8"))
  }
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
  return {
    prepare: (sql: string) => makePrepared(sql),
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => {
      const out = []
      for (const s of stmts) out.push(await s.run())
      return out
    }
  } as unknown as D1Database
}

export function makeEnv(overrides?: Partial<Env>): Env {
  const { DatabaseSync } = loadSqlite()
  const sqlite = new DatabaseSync(":memory:")
  applyMigrations(sqlite)
  const db = wrapAsD1(sqlite)

  const vectorsStore = new Map<
    string,
    { values: number[]; metadata: Record<string, unknown> }
  >()
  const vectors = {
    upsert: vi.fn(async (vs: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>) => {
      for (const v of vs) vectorsStore.set(v.id, { values: v.values, metadata: v.metadata ?? {} })
      return { mutationId: "test" }
    }),
    query: vi.fn(async (_vec: number[], opts?: { topK?: number; filter?: Record<string, unknown> }) => {
      const filter = opts?.filter ?? {}
      const matches = Array.from(vectorsStore.entries())
        .filter(([, v]) =>
          Object.entries(filter).every(([k, val]) => v.metadata[k] === val)
        )
        .slice(0, opts?.topK ?? 5)
        .map(([id, v]) => ({ id, score: 1, metadata: v.metadata }))
      return { matches, count: matches.length }
    })
  } as unknown as VectorizeIndex

  const ai = {
    run: vi.fn(async (model: string) => {
      if (String(model).includes("bge")) return { data: [new Array(768).fill(0.01)] }
      throw new Error(`unstubbed AI model: ${model}`)
    })
  } as unknown as Ai

  return {
    DB: db,
    BLOBS: {} as R2Bucket,
    VECTORS: vectors,
    AI: ai,
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
