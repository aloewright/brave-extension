/**
 * Recorder mirror RPC (M6, ALO-248).
 *
 * Writes recordings to ~/.config/ai-dev-sidebar/recordings/{id}.{mp4,mov} in
 * chunks because Chrome native messaging caps each frame at ~1 MB.
 *
 * Protocol:
 *   recorder.mirror.start  { id, extension? }
 *   recorder.mirror.chunk  { id, base64 }      // many of these
 *   recorder.mirror.finish { id }
 */
import { homedir } from "os"
import { join } from "path"
import { mkdirSync, createWriteStream, existsSync, unlinkSync } from "fs"

const MIRROR_DIR = join(homedir(), ".config", "ai-dev-sidebar", "recordings")

const sessions = new Map() // id -> { stream, path, bytes }

export function ensureMirrorDir() {
  mkdirSync(MIRROR_DIR, { recursive: true })
}

export function mirrorStart(id, extension = "mp4") {
  if (!id || typeof id !== "string") throw new Error("recorder.mirror.start: id required")
  const safeId = sanitizeId(id)
  if (safeId !== id) {
    throw new Error(`recorder.mirror.start: invalid id "${id}"`)
  }
  if (sessions.has(safeId)) {
    // Stale session — clean up and re-open.
    try {
      sessions.get(safeId).stream.destroy()
    } catch {}
    sessions.delete(safeId)
  }
  ensureMirrorDir()
  const ext = normalizeExtension(extension)
  const path = join(MIRROR_DIR, `${safeId}.${ext}`)
  for (const staleExt of ["mp4", "mov"]) {
    const stalePath = join(MIRROR_DIR, `${safeId}.${staleExt}`)
    if (existsSync(stalePath)) {
      try {
        unlinkSync(stalePath)
      } catch {}
    }
  }
  const stream = createWriteStream(path)
  stream.on("error", (err) => {
    sessions.delete(safeId)
    // No way to surface from a fire-and-forget write — log to stderr.
    console.error(`[recorder-mirror] stream error for ${safeId}: ${err.message}`)
  })
  sessions.set(safeId, { stream, path, bytes: 0 })
  return { ok: true, path }
}

export function mirrorChunk(id, base64) {
  if (!id || typeof id !== "string") throw new Error("recorder.mirror.chunk: id required")
  const safeId = sanitizeId(id)
  if (safeId !== id) {
    throw new Error(`recorder.mirror.chunk: invalid id "${id}"`)
  }
  const sess = sessions.get(safeId)
  if (!sess) throw new Error(`recorder.mirror.chunk: no session for ${safeId}`)
  if (typeof base64 !== "string") throw new Error("recorder.mirror.chunk: base64 required")
  if (!sess.stream.writable) {
    console.error(`[recorder-mirror] dropping chunk for ${safeId}: stream not writable`)
    return { ok: false, bytes: sess.bytes, dropped: true }
  }
  const buf = Buffer.from(base64, "base64")
  sess.stream.write(buf)
  sess.bytes += buf.length
  return { ok: true, bytes: sess.bytes }
}

export function mirrorFinish(id) {
  if (!id || typeof id !== "string") throw new Error("recorder.mirror.finish: id required")
  const safeId = sanitizeId(id)
  if (safeId !== id) {
    throw new Error(`recorder.mirror.finish: invalid id "${id}"`)
  }
  const sess = sessions.get(safeId)
  if (!sess) throw new Error(`recorder.mirror.finish: no session for ${safeId}`)
  return new Promise((resolve, reject) => {
    sess.stream.end((err) => {
      sessions.delete(safeId)
      if (err) reject(err)
      else resolve({ ok: true, path: sess.path, bytes: sess.bytes })
    })
  })
}

function sanitizeId(id) {
  // Defense-in-depth: keep only ULID-safe chars; reject path separators.
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
}

function normalizeExtension(extension) {
  return extension === "mov" ? "mov" : "mp4"
}

export const __test = { sanitizeId, normalizeExtension, MIRROR_DIR }
