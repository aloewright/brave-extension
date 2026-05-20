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
