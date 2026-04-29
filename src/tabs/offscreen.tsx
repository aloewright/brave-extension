/**
 * Offscreen document — runs MediaRecorder with mp4/h264 for tab/screen/camera.
 * (M6, ALO-248)
 *
 * Protocol:
 *   bg → { type: "RECORDER_START", id, source, streamId? }
 *   bg → { type: "RECORDER_STOP" }
 *   off → { type: "RECORDER_READY" }
 *   off → { type: "RECORDER_STARTED", id }
 *   off → { type: "RECORDER_STOPPED", id, source, durationMs, sizeBytes, blobUrl }
 *   off → { type: "RECORDER_MIRROR_START",  id }
 *   off → { type: "RECORDER_MIRROR_CHUNK",  id, base64 }      // many of these
 *   off → { type: "RECORDER_MIRROR_FINISH", id }
 *   off → { type: "RECORDER_ERROR", error }
 *
 * Memory note: instead of sending a giant base64 string back to the SW, we
 * create a Blob URL here (background just downloads it) and stream the
 * native-mirror payload to the background in 768KB slices, peak memory
 * ~768KB rather than the full recording.
 */
import { useEffect } from "react"
import { RECORDER_MIME, type RecorderSource } from "../types"
import { DEFAULT_CHUNK_BYTES } from "../lib/recorder-chunks"

type StartMsg = {
  type: "RECORDER_START"
  id: string
  source: RecorderSource
  streamId?: string
}

type StopMsg = { type: "RECORDER_STOP" }

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let activeStream: MediaStream | null = null
let activeId: string | null = null
let activeSource: RecorderSource | null = null
let startedAt = 0

async function acquireStream(msg: StartMsg): Promise<MediaStream> {
  if (msg.source === "tab") {
    if (!msg.streamId) throw new Error("tab capture: missing streamId")
    return (await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error non-standard tab capture constraints
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId }
      },
      video: {
        // @ts-expect-error non-standard tab capture constraints
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId }
      }
    })) as MediaStream
  }
  if (msg.source === "screen") {
    return await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  }
  // camera
  return await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
}

/**
 * Stream a Blob to the background as `RECORDER_MIRROR_*` messages, slicing
 * the blob into ~768KB pieces and base64-encoding each slice individually
 * so peak memory stays ~768KB instead of the entire recording.
 */
export async function streamBlobToMirror(
  blob: Blob,
  id: string,
  send: (m: unknown) => void,
  sliceBytes = DEFAULT_CHUNK_BYTES
): Promise<void> {
  send({ type: "RECORDER_MIRROR_START", id })
  // sliceBytes is the *binary* slice size; base64 expansion (~4/3) keeps each
  // emitted message comfortably under the native messaging 1 MB cap.
  for (let start = 0; start < blob.size; start += sliceBytes) {
    const end = Math.min(start + sliceBytes, blob.size)
    const slice = blob.slice(start, end)
    const buf = new Uint8Array(await slice.arrayBuffer())
    let binary = ""
    const STR_SLICE = 0x8000 // 32 KB → safe for String.fromCharCode.apply
    for (let i = 0; i < buf.length; i += STR_SLICE) {
      const piece = buf.subarray(i, Math.min(i + STR_SLICE, buf.length))
      binary += String.fromCharCode.apply(null, Array.from(piece) as number[])
    }
    const base64 = btoa(binary)
    send({ type: "RECORDER_MIRROR_CHUNK", id, base64 })
  }
  send({ type: "RECORDER_MIRROR_FINISH", id })
}

async function startRecording(msg: StartMsg) {
  if (recorder) return
  // Fail fast if mp4/h264 not supported.
  if (!MediaRecorder.isTypeSupported(RECORDER_MIME)) {
    chrome.runtime.sendMessage({
      type: "RECORDER_ERROR",
      error: "mp4 codec (h264) not supported by this browser"
    })
    return
  }

  try {
    const stream = await acquireStream(msg)
    activeStream = stream
    activeId = msg.id
    activeSource = msg.source
    chunks = []

    // For tab capture, keep audio audible to the user — tab capture
    // otherwise mutes the source tab.
    if (msg.source === "tab") {
      try {
        const ac = new AudioContext()
        const src = ac.createMediaStreamSource(stream)
        src.connect(ac.destination)
      } catch {
        // non-fatal
      }
    }

    recorder = new MediaRecorder(stream, { mimeType: RECORDER_MIME })

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }

    recorder.onstop = async () => {
      const id = activeId!
      const source = activeSource!
      const durationMs = Date.now() - startedAt
      try {
        const blob = new Blob(chunks, { type: "video/mp4" })
        const blobUrl = URL.createObjectURL(blob)
        chrome.runtime.sendMessage({
          type: "RECORDER_STOPPED",
          id,
          source,
          durationMs,
          sizeBytes: blob.size,
          blobUrl
        })
        // Stream the mirror payload chunk-by-chunk to the SW (which forwards
        // to native). Peak memory ~768KB regardless of recording length.
        try {
          await streamBlobToMirror(blob, id, (m) =>
            chrome.runtime.sendMessage(m).catch(() => {})
          )
        } catch (err) {
          // Mirror is best-effort; the download path already succeeded above.
          console.warn("[recorder] mirror streaming failed", err)
        }
      } catch (err) {
        chrome.runtime.sendMessage({
          type: "RECORDER_ERROR",
          error: (err as Error).message
        })
      } finally {
        chunks = []
        recorder = null
        if (activeStream) {
          for (const t of activeStream.getTracks()) t.stop()
          activeStream = null
        }
        activeId = null
        activeSource = null
      }
    }

    // If the user revokes the screen share / closes the tab, stop gracefully.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recorder && recorder.state !== "inactive") recorder.stop()
    })

    startedAt = Date.now()
    recorder.start(1000)
    chrome.runtime.sendMessage({ type: "RECORDER_STARTED", id: msg.id })
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "RECORDER_ERROR",
      error: (err as Error).message
    })
  }
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop()
}

export default function Offscreen() {
  useEffect(() => {
    const handler = (msg: StartMsg | StopMsg) => {
      if (msg.type === "RECORDER_START") void startRecording(msg)
      if (msg.type === "RECORDER_STOP") stopRecording()
    }
    chrome.runtime.onMessage.addListener(handler)
    chrome.runtime.sendMessage({ type: "RECORDER_READY" })
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])
  return null
}
