import type { Env } from "./env"
import { embed } from "./ai"
import { chunkText } from "./chunk"

export type ResourceType = "conversation" | "link" | "bookmark" | "recording" | "pdf" | "capture" | "highlight" | "scrape"

export interface ResourceMeta {
  title: string
  createdAt: number
  maxChars?: number
  overlapChars?: number
}

export interface ChunkVector {
  text: string
  values: number[]
}

export interface UpsertResult {
  chunkCount: number
}

export interface SearchHitMetadata {
  type: ResourceType
  id: string
  chunkIndex: number
  createdAt: number
  title: string
  snippet: string
}

export interface SearchHit {
  id: string
  score: number
  metadata: SearchHitMetadata
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
  return chunks.map((c, i) => ({ text: c, values: vectors[i]! }))
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
  if (!qv) return []
  const limit = opts.limit ?? 20
  const result = await env.VECTORS.query(qv, { topK: limit, returnMetadata: "all" })
  let hits: SearchHit[] = (result.matches ?? []).map((m) => ({
    id: m.id,
    score: m.score,
    metadata: m.metadata as unknown as SearchHitMetadata
  }))
  if (opts.types && opts.types.length) {
    hits = hits.filter((h) => opts.types!.includes(h.metadata.type))
  }
  return hits
}
