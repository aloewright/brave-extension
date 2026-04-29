/**
 * Recorder mirror RPC (M6, ALO-248).
 *
 * Writes recordings to ~/.config/ai-dev-sidebar/recordings/{id}.mp4 in
 * chunks because Chrome native messaging caps each frame at ~1 MB.
 *
 * Protocol:
 *   recorder.mirror.start  { id }
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

export function mirrorStart(id) {
  if (!id || typeof id !== "string") throw new Error("recorder.mirror.start: id required")
  if (sessions.has(id)) {
    // Stale session — clean up and re-open.
    try {
      sessions.get(id).stream.destroy()
    } catch {}
    sessions.delete(id)
  }
  ensureMirrorDir()
  const path = join(MIRROR_DIR, `${sanitizeId(id)}.mp4`)
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {}
  }
  const stream = createWriteStream(path)
  sessions.set(id, { stream, path, bytes: 0 })
  return { ok: true, path }
}

export function mirrorChunk(id, base64) {
  const sess = sessions.get(id)
  if (!sess) throw new Error(`recorder.mirror.chunk: no session for ${id}`)
  if (typeof base64 !== "string") throw new Error("recorder.mirror.chunk: base64 required")
  const buf = Buffer.from(base64, "base64")
  sess.stream.write(buf)
  sess.bytes += buf.length
  return { ok: true, bytes: sess.bytes }
}

export function mirrorFinish(id) {
  const sess = sessions.get(id)
  if (!sess) throw new Error(`recorder.mirror.finish: no session for ${id}`)
  return new Promise((resolve, reject) => {
    sess.stream.end((err) => {
      sessions.delete(id)
      if (err) reject(err)
      else resolve({ ok: true, path: sess.path, bytes: sess.bytes })
    })
  })
}

function sanitizeId(id) {
  // Defense-in-depth: keep only ULID-safe chars; reject path separators.
  return String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64)
}

export const __test = { sanitizeId, MIRROR_DIR }
