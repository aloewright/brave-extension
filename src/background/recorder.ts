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
  if (recorderState.active || pendingStart) {
    return { ok: false, error: "Already recording" }
  }
  const id = ulid()
  // Claim the slot synchronously so concurrent callers can't race past
  // the guard above while we await tab/streamId/offscreen setup.
  recorderState.active = true
  pendingStart = { source: opts.source, id }
  try {
    let streamId: string | undefined
    let originUrl: string | null = null
    let tabId: number | null = null

    if (opts.source === "tab") {
      let tid = opts.tabId
      if (!tid) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          recorderState.active = false
          pendingStart = null
          return { ok: false, error: "No active tab" }
        }
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
    pendingStart = null
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

async function downloadBlobUrl(url: string, filename: string): Promise<void> {
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
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // revokeObjectURL is unavailable in some SW environments; harmless.
      }
    }, 60_000)
  }
}

/**
 * Route a mirror message from the offscreen document to the native host.
 * The offscreen now streams mirror chunks itself (peak ~768 KB instead of
 * the entire recording), so this is just a translator from the offscreen
 * `RECORDER_MIRROR_*` message names to the native `recorder.mirror.*`
 * protocol.
 */
export function handleMirrorMessage(
  msg: { type: string; id: string; base64?: string },
  ctx: { sendNative: (m: unknown) => void }
): boolean {
  if (msg.type === "RECORDER_MIRROR_START") {
    ctx.sendNative({ type: "recorder.mirror.start", id: msg.id })
    return true
  }
  if (msg.type === "RECORDER_MIRROR_CHUNK") {
    ctx.sendNative({
      type: "recorder.mirror.chunk",
      id: msg.id,
      base64: msg.base64
    })
    return true
  }
  if (msg.type === "RECORDER_MIRROR_FINISH") {
    ctx.sendNative({ type: "recorder.mirror.finish", id: msg.id })
    return true
  }
  return false
}

/**
 * Offscreen emitted RECORDER_STOPPED — the blob lives in the offscreen
 * document; we receive a blob URL and just hand it to chrome.downloads.
 * No base64 decode, no Uint8Array, no Blob reconstruction in the SW.
 */
export async function handleRecorderStopped(
  msg: {
    id: string
    source: RecorderSource
    durationMs: number
    sizeBytes: number
    blobUrl: string
  },
  _ctx: { sendNative: (msg: unknown) => void }
): Promise<RecordingMetadata | null> {
  try {
    const createdAt = new Date()
    const filename = `recording-${isoForFilename(createdAt)}.mp4`

    await downloadBlobUrl(msg.blobUrl, filename)

    const meta: RecordingMetadata = {
      id: msg.id,
      source: msg.source,
      durationMs: msg.durationMs,
      sizeBytes: msg.sizeBytes,
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

