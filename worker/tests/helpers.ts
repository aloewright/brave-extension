import { vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createRequire } from "node:module"
import type { Env } from "../src/env"
import { EMBED_DIMS } from "../src/env"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// node:sqlite is loaded via createRequire so vite/vitest can't try to
// pre-bundle it. The DatabaseSync class is API-stable since Node 22.5.
type DatabaseSync = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    run: (...params: unknown[]) => { changes: number; lastInsertRowid: bigint | number }
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
  }
}

function loadSqlite(): { DatabaseSync: new (path: string) => DatabaseSync } {
  return require("node:sqlite")
}

/**
 * Build a test Env with a real in-memory SQLite acting as D1, plus stubbed
 * AI/Vectorize. Each call returns a fresh DB so tests are isolated.
 */
export function makeEnv(overrides?: Partial<Env>): Env {
  const { DatabaseSync } = loadSqlite()
  const sqlite = new DatabaseSync(":memory:")
  applyMigrationsSync(sqlite)

  const db = wrapAsD1(sqlite)

  const aiRun = vi.fn(async (model: string, payload: unknown) => {
    const m = model as string
    const p = (payload ?? {}) as { text?: string[] }
    if (m.endsWith("bge-base-en-v1.5")) {
      const texts: string[] = p.text ?? []
      return { data: texts.map(() => fakeVector(EMBED_DIMS)) }
    }
    throw new Error(`unstubbed AI model: ${model}`)
  })

  const vectorsStore = new Map<string, { values: number[]; metadata: Record<string, unknown> }>()
  const blobs = makeFakeR2()

  return {
    DB: db,
    AI: { run: aiRun } as unknown as Ai,
    BLOBS: blobs,
    VECTORS: {
      upsert: vi.fn(async (vectors: VectorizeVector[]) => {
        for (const v of vectors)
          vectorsStore.set(v.id, {
            values: v.values as number[],
            metadata: (v.metadata ?? {}) as Record<string, unknown>
          })
        return { mutationId: "test" }
      }),
      deleteByIds: vi.fn(async (ids: string[]) => {
        for (const id of ids) vectorsStore.delete(id)
        return { mutationId: "test" }
      }),
      query: vi.fn(async (_vec: number[], opts?: VectorizeQueryOptions) => {
        const matches = Array.from(vectorsStore.entries())
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

// ── fake R2 bucket ─────────────────────────────────────────────────────────
function makeFakeR2(): R2Bucket {
  const store = new Map<string, { body: Uint8Array; contentType: string; etag: string }>()
  let counter = 0

  return {
    async put(
      key: string,
      body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | Blob | string | null,
      opts?: R2PutOptions
    ) {
      const bytes = await toUint8(body)
      const etag = `etag-${++counter}`
      const contentType = opts?.httpMetadata && "contentType" in opts.httpMetadata
        ? (opts.httpMetadata.contentType ?? "application/octet-stream")
        : "application/octet-stream"
      store.set(key, { body: bytes, contentType, etag })
      return {
        key,
        version: "1",
        size: bytes.byteLength,
        etag,
        httpEtag: `"${etag}"`,
        uploaded: new Date(),
        httpMetadata: { contentType }
      } as unknown as R2Object
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const entry = store.get(key)
      if (!entry) return null
      const arr = entry.body
      return {
        key,
        size: arr.byteLength,
        etag: entry.etag,
        httpEtag: `"${entry.etag}"`,
        uploaded: new Date(),
        httpMetadata: { contentType: entry.contentType },
        body: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(arr)
            ctrl.close()
          }
        }),
        async arrayBuffer() {
          const buf = new ArrayBuffer(arr.byteLength)
          new Uint8Array(buf).set(arr)
          return buf
        },
        async text() {
          return new TextDecoder().decode(arr)
        },
        async json<T>() {
          return JSON.parse(new TextDecoder().decode(arr)) as T
        },
        async blob() {
          return new Blob(
            [arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer],
            { type: entry.contentType }
          )
        },
        writeHttpMetadata() {},
        bodyUsed: false
      } as unknown as R2ObjectBody
    },
    async delete(key: string) {
      store.delete(key)
    },
    async head(key: string) {
      const e = store.get(key)
      return e ? ({ key, size: e.body.byteLength, etag: e.etag } as unknown as R2Object) : null
    }
  } as unknown as R2Bucket
}

async function toUint8(
  body: ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | Blob | string | null
): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0)
  if (typeof body === "string") return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer())
  // ReadableStream
  const reader = (body as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.byteLength
    }
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

/** Kept for plan compatibility — makeEnv applies migrations itself. */
export async function applyMigrations(_env: Env): Promise<void> {}

function fakeVector(dims: number): number[] {
  const v: number[] = []
  for (let i = 0; i < dims; i++) v.push(((i + 1) * 0.001) % 1)
  return v
}

function applyMigrationsSync(sqlite: DatabaseSync): void {
  // Apply every numbered .sql file in migrations/, in order. New tables
  // (e.g. captures from 0002) become available to tests without each test
  // touching helpers.
  const dir = join(__dirname, "..", "migrations")
  const filenames = ["0001_init.sql", "0002_captures.sql"]
  for (const f of filenames) {
    const sql = readFileSync(join(dir, f), "utf-8")
    sqlite.exec(sql)
  }
}

// ── node:sqlite → D1Database adapter ───────────────────────────────────────
function wrapAsD1(sqlite: DatabaseSync): D1Database {
  function prepared(sql: string, binds: unknown[] = []): D1PreparedStatement {
    const stmt = {
      bind(...values: unknown[]): D1PreparedStatement {
        return prepared(sql, [...binds, ...values])
      },
      async first<T = unknown>(_col?: string): Promise<T | null> {
        const s = sqlite.prepare(sql)
        const row = s.get(...binds) as T | undefined
        return (row ?? null) as T | null
      },
      async run<T = Record<string, unknown>>(): Promise<unknown> {
        const s = sqlite.prepare(sql)
        const info = s.run(...binds)
        return {
          success: true,
          meta: {
            duration: 0,
            last_row_id: Number(info.lastInsertRowid),
            changes: info.changes,
            served_by: "node-sqlite-stub",
            changed_db: info.changes > 0
          },
          results: [] as T[]
        }
      },
      async all<T = Record<string, unknown>>(): Promise<{ success: true; results: T[]; meta: Record<string, unknown> }> {
        const s = sqlite.prepare(sql)
        const rows = s.all(...binds) as T[]
        return {
          success: true,
          meta: {
            duration: 0,
            last_row_id: 0,
            changes: 0,
            served_by: "node-sqlite-stub",
            rows_read: rows.length,
            changed_db: false
          },
          results: rows
        }
      },
      async raw<T = unknown[]>(): Promise<T[]> {
        const s = sqlite.prepare(sql)
        const rows = s.all(...binds) as Record<string, unknown>[]
        return rows.map((r) => Object.values(r)) as T[]
      }
    }
    return stmt as unknown as D1PreparedStatement
  }

  return {
    prepare(sql: string): D1PreparedStatement {
      return prepared(sql)
    },
    async exec(sql: string): Promise<unknown> {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
    async batch<T = unknown>(stmts: D1PreparedStatement[]): Promise<T[]> {
      const out: T[] = []
      for (const s of stmts) out.push((await (s as unknown as { all: () => Promise<T> }).all()))
      return out
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0)
    }
  } as unknown as D1Database
}
