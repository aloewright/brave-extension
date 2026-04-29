/**
 * Offscreen document — runs MediaRecorder with mp4/h264 for tab/screen/camera.
 * (M6, ALO-248)
 *
 * Protocol:
 *   bg → { type: "RECORDER_START", id, source, streamId? }
 *   bg → { type: "RECORDER_STOP" }
 *   off → { type: "RECORDER_READY" }
 *   off → { type: "RECORDER_STARTED", id }
 *   off → { type: "RECORDER_STOPPED", id, source, durationMs, base64 }
 *   off → { type: "RECORDER_ERROR", error }
 */
import { useEffect } from "react"
import { RECORDER_MIME, type RecorderSource } from "../types"
import { blobToBase64 } from "../lib/recorder-chunks"

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
        const base64 = await blobToBase64(blob)
        chrome.runtime.sendMessage({
          type: "RECORDER_STOPPED",
          id,
          source,
          durationMs,
          base64
        })
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
