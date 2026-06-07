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
