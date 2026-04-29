/**
 * Recorder orchestration (M6, ALO-248). SW-side glue: offscreen lifecycle,
 * tabCapture stream id minting, blob → chrome.downloads + native mirror,
 * metadata in chrome.storage.local.
 */
import {
  RECORDER_STORAGE_KEY,
  type RecorderSource,
  type RecordingMetadata
} from "../types"
import { ulid } from "../lib/ulid"
import { chunkBase64, DEFAULT_CHUNK_BYTES } from "../lib/recorder-chunks"

const OFFSCREEN_URL = "tabs/offscreen.html"

export interface RecorderState {
  active: boolean
  source: RecorderSource | null
  startedAt: number | null
  tabId: number | null
  originUrl: string | null
  lastSaved: { id: string; filename: string; sizeBytes: number; at: number } | null
  lastError: string | null
}

export const recorderState: RecorderState = {
  active: false,
  source: null,
  startedAt: null,
  tabId: null,
  originUrl: null,
  lastSaved: null,
  lastError: null
}

let pendingStart:
  | { source: RecorderSource; streamId?: string; id: string }
  | null = null

async function hasOffscreen(): Promise<boolean> {
  // @ts-ignore — chrome.runtime.getContexts is MV3 only and may be missing
  // from older @types/chrome
  const existing = await (chrome.runtime as any).getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  })
  return Array.isArray(existing) && existing.length > 0
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return
  // @ts-ignore — older @types/chrome may not include DISPLAY_MEDIA reason
  await (chrome.offscreen as any).createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA", "DISPLAY_MEDIA"],
    justification: "Record tab/screen/camera as mp4 video"
  })
}

async function closeOffscreen() {
  if (!(await hasOffscreen())) return
  try {
    // @ts-ignore
    await chrome.offscreen.closeDocument()
  } catch {
    // ignore
  }
}

function setBadge(on: boolean) {
  if (on) {
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" })
    chrome.action.setTitle({ title: "Recording — click to stop" })
  } else {
    chrome.action.setBadgeText({ text: "" })
    chrome.action.setTitle({ title: "AI Dev Sidebar" })
  }
}

export async function startRecording(opts: {
  source: RecorderSource
  tabId?: number
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (recorderState.active) return { ok: false, error: "Already recording" }
  const id = ulid()
  try {
    let streamId: string | undefined
    let originUrl: string | null = null
    let tabId: number | null = null

    if (opts.source === "tab") {
      let tid = opts.tabId
      if (!tid) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) return { ok: false, error: "No active tab" }
        tid = tab.id
        originUrl = tab.url || null
      } else {
        try {
          const tab = await chrome.tabs.get(tid)
          originUrl = tab.url || null
        } catch {
          /* ignore */
        }
      }
      tabId = tid
      streamId = await new Promise<string>((resolve, reject) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tid! }, (sid) => {
          if (chrome.runtime.lastError || !sid) {
            reject(new Error(chrome.runtime.lastError?.message || "No stream id"))
          } else {
            resolve(sid)
          }
        })
      })
    }

    pendingStart = { source: opts.source, streamId, id }
    await ensureOffscreen()
    chrome.runtime
      .sendMessage({
        type: "RECORDER_START",
        id,
        source: opts.source,
        streamId
      })
      .catch(() => {
        // Offscreen not yet listening; RECORDER_READY handler will retry.
      })

    recorderState.active = true
    recorderState.source = opts.source
    recorderState.startedAt = Date.now()
    recorderState.tabId = tabId
    recorderState.originUrl = originUrl
    recorderState.lastError = null
    setBadge(true)
    return { ok: true, id }
  } catch (err) {
    recorderState.lastError = (err as Error).message
    recorderState.active = false
    setBadge(false)
    return { ok: false, error: recorderState.lastError }
  }
}

export async function stopRecording(): Promise<{ ok: boolean }> {
  if (!recorderState.active) return { ok: false }
  chrome.runtime.sendMessage({ type: "RECORDER_STOP" }).catch(() => {})
  return { ok: true }
}

function isoForFilename(d = new Date()): string {
  return d.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z")
}

async function persistMetadata(meta: RecordingMetadata) {
  const got = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
  const list = (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? []
  list.unshift(meta)
  await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: list.slice(0, 200) })
}

async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download(
        { url, filename, saveAs: false },
        (downloadId) => {
          const lastErr = chrome.runtime.lastError
          if (lastErr || downloadId === undefined) {
            reject(new Error(lastErr?.message || "download failed"))
          } else {
            resolve()
          }
        }
      )
    })
  } finally {
    // Revoke after a short delay so chrome can fetch the blob URL.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

/** Mirror to ~/.config/ai-dev-sidebar/recordings/{id}.mp4 via native host. */
async function mirrorToNative(
  sendNative: (msg: unknown) => void,
  id: string,
  base64: string
) {
  sendNative({ type: "recorder.mirror.start", id })
  for (const part of chunkBase64(base64, DEFAULT_CHUNK_BYTES)) {
    sendNative({ type: "recorder.mirror.chunk", id, base64: part })
  }
  sendNative({ type: "recorder.mirror.finish", id })
}

/** Offscreen emitted RECORDER_STOPPED — blob arrives as base64 in `msg.base64`. */
export async function handleRecorderStopped(
  msg: { id: string; source: RecorderSource; durationMs: number; base64: string },
  ctx: { sendNative: (msg: unknown) => void }
): Promise<RecordingMetadata | null> {
  try {
    // Decode just to compute byte size; we keep the base64 for native mirror
    // and reconstruct a Blob for the browser-side download.
    const binary = atob(msg.base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: "video/mp4" })

    const createdAt = new Date()
    const filename = `recording-${isoForFilename(createdAt)}.mp4`

    await downloadBlob(blob, filename)

    try {
      await mirrorToNative(ctx.sendNative, msg.id, msg.base64)
    } catch (err) {
      console.warn("recorder: native mirror failed", err)
    }

    const meta: RecordingMetadata = {
      id: msg.id,
      source: msg.source,
      durationMs: msg.durationMs,
      sizeBytes: blob.size,
      mimeType: "video/mp4",
      filename,
      createdAt: createdAt.toISOString(),
      originUrl: recorderState.originUrl ?? undefined
    }
    await persistMetadata(meta)

    resetState()
    recorderState.lastSaved = {
      id: meta.id,
      filename: meta.filename,
      sizeBytes: meta.sizeBytes,
      at: Date.now()
    }
    return meta
  } catch (err) {
    resetState()
    recorderState.lastError = (err as Error).message
    return null
  }
}

function resetState() {
  recorderState.active = false
  recorderState.source = null
  recorderState.startedAt = null
  recorderState.tabId = null
  recorderState.originUrl = null
  recorderState.lastError = null
  setBadge(false)
  closeOffscreen()
}

export function handleRecorderError(error: string) {
  resetState()
  recorderState.lastError = error || "Recording failed"
}

export function handleRecorderReady(sendStart: (msg: unknown) => void) {
  if (!pendingStart) return
  sendStart({
    type: "RECORDER_START",
    id: pendingStart.id,
    source: pendingStart.source,
    streamId: pendingStart.streamId
  })
  pendingStart = null
}

