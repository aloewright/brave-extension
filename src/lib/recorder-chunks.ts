/**
 * Native messaging frame max payload is 1 MB. Chunk a base64 string into
 * pieces small enough to fit comfortably inside a single frame after JSON
 * envelope overhead. 768 KB per chunk leaves ample room for the wrapper.
 */
export const DEFAULT_CHUNK_BYTES = 768 * 1024

export function chunkBase64(b64: string, chunkSize: number = DEFAULT_CHUNK_BYTES): string[] {
  if (chunkSize <= 0) throw new Error("chunkSize must be > 0")
  if (b64.length === 0) return []
  const chunks: string[] = []
  for (let i = 0; i < b64.length; i += chunkSize) {
    chunks.push(b64.slice(i, i + chunkSize))
  }
  return chunks
}

export function joinChunks(parts: string[]): string {
  return parts.join("")
}

/**
 * Convert a Blob (in the offscreen / browser context) to a base64 string
 * without using FileReader's data URL prefix. Operates in fixed-size slices
 * to avoid stack-overflow on large recordings.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  const SLICE = 0x8000 // 32 KB → safe for String.fromCharCode.apply
  let binary = ""
  for (let i = 0; i < buf.length; i += SLICE) {
    const slice = buf.subarray(i, Math.min(i + SLICE, buf.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[])
  }
  // btoa is available in offscreen (DOM) and in happy-dom test env.
  return btoa(binary)
}
