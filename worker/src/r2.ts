import type { Env } from "./env"

export type BlobType = "recording" | "pdf"

/** Deterministic R2 key for a given resource. */
export function keyFor(type: BlobType, id: string, ext: string): string {
  const cleanExt = ext.replace(/^\./, "").toLowerCase()
  return type === "recording" ? `recordings/${id}.${cleanExt}` : `pdfs/${id}.${cleanExt}`
}

export async function putBlob(
  env: Env,
  key: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | Blob,
  opts: { contentType: string; size?: number }
): Promise<{ etag: string }> {
  const obj = await env.BLOBS.put(key, body, {
    httpMetadata: { contentType: opts.contentType }
  })
  if (!obj) throw new Error(`R2 put failed for key: ${key}`)
  return { etag: obj.etag }
}

export async function getBlob(env: Env, key: string): Promise<R2ObjectBody | null> {
  return (await env.BLOBS.get(key)) ?? null
}

export async function deleteBlob(env: Env, key: string): Promise<void> {
  await env.BLOBS.delete(key)
}
