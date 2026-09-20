import type { KeepoutConnection } from "./keepout-client";

export const KEEPOUT_VIDEO_CHUNK_BYTES = 1_048_576;
export const KEEPOUT_VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;

export type KeepoutVideoUpload = { id: string; chunkBytes: number; uploadNonce?: string; nextIndex: number; complete: boolean };

function requireUUID(value: unknown, message: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error(message);
  return value;
}

function endpoint(connection: KeepoutConnection, path: string): string {
  if (!Number.isInteger(connection.port) || connection.port < 1024 || connection.port > 65535 || !connection.token || /[\x00-\x20\x7f]/.test(connection.token)) {
    throw new Error("Connect Keepout in the extension's Settings first.");
  }
  return `http://127.0.0.1:${connection.port}${path}`;
}

async function json(connection: KeepoutConnection, path: string, method: "POST" | "DELETE", body?: unknown, uploadNonce?: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(endpoint(connection, path), {
      method,
      headers: { Authorization: `Bearer ${connection.token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(uploadNonce ? { "X-Keepout-Upload": uploadNonce } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
    });
  } catch { throw new Error("Cannot reach Keepout. Open and unlock it, then retry."); }
  if (!response.ok) throw new Error(response.status === 423 ? "Unlock Keepout and retry." : "Keepout could not import this video.");
  const value = await response.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Keepout returned an invalid video-upload response.");
  return value as Record<string, unknown>;
}

export async function beginKeepoutVideoUpload(connection: KeepoutConnection, input: { id: string; captureID: string; title: string; contentType: string }): Promise<KeepoutVideoUpload> {
  requireUUID(input.id, "Invalid video identifier.");
  requireUUID(input.captureID, "Invalid Canvas capture identifier.");
  if (!input.title.trim() || input.title.length > 500 || !/^video\/(?:mp4|webm|quicktime|x-m4v|ogg)$/i.test(input.contentType)) throw new Error("This video type cannot be imported.");
  const result = await json(connection, "/v1/page-videos", "POST", input);
  const id = requireUUID(result.id, "Keepout returned an invalid video identifier.");
  if (id.toLowerCase() !== input.id.toLowerCase() || result.chunkBytes !== KEEPOUT_VIDEO_CHUNK_BYTES) throw new Error("Keepout returned an incompatible video-upload session.");
  if (typeof result.complete !== "boolean") throw new Error("Keepout returned an invalid video-upload state.");
  const complete = result.complete;
  const uploadNonce = result.uploadNonce;
  const nextIndex = complete ? 0 : result.index;
  if (!complete && (typeof uploadNonce !== "string" || !/^[0-9a-f-]{36}$/i.test(uploadNonce))) throw new Error("Keepout did not return a video-upload nonce.");
  if (typeof nextIndex !== "number" || !Number.isSafeInteger(nextIndex) || nextIndex < 0) {
    throw new Error("Keepout returned an invalid video-upload position.");
  }
  return { id, chunkBytes: KEEPOUT_VIDEO_CHUNK_BYTES, nextIndex, complete, ...(typeof uploadNonce === "string" ? { uploadNonce } : {}) };
}

/** A stream retry starts from byte zero. Do not overwrite an earlier partial
 * session whose strict chunk index would otherwise reject that replay. */
export async function beginFreshKeepoutVideoUpload(connection: KeepoutConnection, input: { id: string; captureID: string; title: string; contentType: string }): Promise<KeepoutVideoUpload> {
  let upload = await beginKeepoutVideoUpload(connection, input);
  if (upload.complete || upload.nextIndex === 0) return upload;
  await cancelKeepoutVideoUpload(connection, upload);
  upload = await beginKeepoutVideoUpload(connection, input);
  if (!upload.complete && upload.nextIndex !== 0) throw new Error("Keepout could not reset the interrupted video upload. Retry the video.");
  return upload;
}

export async function sendKeepoutVideoChunk(connection: KeepoutConnection, upload: KeepoutVideoUpload, index: number, bytes: Uint8Array): Promise<void> {
  if (!Number.isSafeInteger(index) || index < 0 || !bytes.byteLength || bytes.byteLength > upload.chunkBytes) throw new Error("Invalid video chunk.");
  let response: Response;
  try {
    response = await fetch(endpoint(connection, `/v1/page-videos/${upload.id}/chunks?index=${index}`), {
      method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/octet-stream", ...(upload.uploadNonce ? { "X-Keepout-Upload": upload.uploadNonce } : {}) },
      body: bytes, credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(45_000),
    });
  } catch { throw new Error("Keepout lost the video upload. Retry the video."); }
  if (!response.ok) throw new Error(response.status === 409 ? "Keepout rejected this video upload." : "Keepout could not save this video chunk.");
}

export async function completeKeepoutVideoUpload(connection: KeepoutConnection, upload: KeepoutVideoUpload): Promise<void> {
  if (!upload.uploadNonce) throw new Error("Keepout did not return a video-upload nonce.");
  await json(connection, `/v1/page-videos/${upload.id}/complete`, "POST", {}, upload.uploadNonce);
}

export async function cancelKeepoutVideoUpload(connection: KeepoutConnection, upload: KeepoutVideoUpload): Promise<void> {
  const id = requireUUID(upload.id, "Invalid video identifier.");
  if (!upload.uploadNonce) return;
  await json(connection, `/v1/page-videos/${id}`, "DELETE", undefined, upload.uploadNonce);
}

export async function uploadKeepoutVideoStream(connection: KeepoutConnection, upload: KeepoutVideoUpload, stream: ReadableStream<Uint8Array>, onProgress?: (sent: number) => void): Promise<void> {
  if (upload.complete) return;
  const reader = stream.getReader();
  let pending = new Uint8Array(upload.chunkBytes); let filled = 0; let index = upload.nextIndex; let sent = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (sent + filled + next.value.byteLength > KEEPOUT_VIDEO_MAX_BYTES) throw new Error("This video exceeds Keepout's 4 GiB limit.");
      let offset = 0;
      while (offset < next.value.byteLength) {
        const count = Math.min(upload.chunkBytes - filled, next.value.byteLength - offset);
        pending.set(next.value.subarray(offset, offset + count), filled);
        filled += count; offset += count;
        if (filled === upload.chunkBytes) {
          await sendKeepoutVideoChunk(connection, upload, index++, pending);
          sent += filled; onProgress?.(sent); pending = new Uint8Array(upload.chunkBytes); filled = 0;
        }
      }
    }
    if (filled) { await sendKeepoutVideoChunk(connection, upload, index, pending.subarray(0, filled)); sent += filled; onProgress?.(sent); }
    await completeKeepoutVideoUpload(connection, upload);
  } finally { reader.releaseLock(); }
}
