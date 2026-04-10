/**
 * Offscreen document — runs MediaRecorder to capture a tab stream.
 *
 * Flow:
 *   background → { type: 'OFFSCREEN_START', streamId, uploadUrl, serviceToken }
 *   background → { type: 'OFFSCREEN_STOP' }
 *   offscreen → { type: 'OFFSCREEN_UPLOADED', key, url }  (or _ERROR)
 *
 * This file runs as a Plasmo tab page but is loaded via chrome.offscreen —
 * no UI is visible to the user.
 */
import { useEffect } from "react"

type StartMsg = {
  type: "OFFSCREEN_START"
  streamId: string
  uploadUrl: string
  serviceToken?: string
}

type StopMsg = { type: "OFFSCREEN_STOP" }

type IncomingMsg = StartMsg | StopMsg

let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let activeStream: MediaStream | null = null
let uploadConfig: { uploadUrl: string; serviceToken?: string } | null = null

async function startRecording(msg: StartMsg) {
  if (recorder) return // already recording

  try {
    // Acquire the tab's media stream using the streamId minted by background.
    // Chrome requires the deprecated constraints shape for tab capture.
    const stream = (await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error non-standard tab capture constraints
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId
        }
      },
      video: {
        // @ts-expect-error non-standard tab capture constraints
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId
        }
      }
    })) as MediaStream

    activeStream = stream
    uploadConfig = { uploadUrl: msg.uploadUrl, serviceToken: msg.serviceToken }
    chunks = []

    // Keep audio playing through the user's speakers while we capture it
    // (tab capture otherwise mutes the tab). Create an AudioContext sink.
    try {
      const ac = new AudioContext()
      const src = ac.createMediaStreamSource(stream)
      src.connect(ac.destination)
    } catch {
      // non-fatal
    }

    const preferredMimes = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ]
    const mimeType = preferredMimes.find((m) => MediaRecorder.isTypeSupported(m))
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }

    recorder.onstop = async () => {
      try {
        const blob = new Blob(chunks, { type: recorder?.mimeType ?? "video/webm" })
        const result = await uploadRecording(blob)
        chrome.runtime.sendMessage({ type: "OFFSCREEN_UPLOADED", ...result })
      } catch (err) {
        chrome.runtime.sendMessage({
          type: "OFFSCREEN_ERROR",
          error: (err as Error).message
        })
      } finally {
        chunks = []
        recorder = null
        if (activeStream) {
          for (const t of activeStream.getTracks()) t.stop()
          activeStream = null
        }
        uploadConfig = null
      }
    }

    // Keep the tab stream alive even if the source tab is closed by listening
    // for track end and triggering a stop so we still upload what we have.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recorder && recorder.state !== "inactive") recorder.stop()
    })

    recorder.start(1000) // flush chunks every second
    chrome.runtime.sendMessage({ type: "OFFSCREEN_STARTED" })
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_ERROR",
      error: (err as Error).message
    })
  }
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") {
    recorder.stop()
  }
}

async function uploadRecording(
  blob: Blob
): Promise<{ key?: string; url?: string; size: number }> {
  if (!uploadConfig) throw new Error("Upload config missing")
  const form = new FormData()
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  form.append("file", blob, `tab-recording-${ts}.webm`)
  form.append("prefix", "recordings")

  const headers: Record<string, string> = {}
  if (uploadConfig.serviceToken) {
    headers["X-CloudOS-Service-Token"] = uploadConfig.serviceToken
  }

  const resp = await fetch(uploadConfig.uploadUrl, {
    method: "POST",
    headers,
    body: form
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText)
    throw new Error(`Upload failed: ${resp.status} ${text}`)
  }
  const data = (await resp.json()) as { key?: string; url?: string }
  return { key: data.key, url: data.url, size: blob.size }
}

export default function Offscreen() {
  useEffect(() => {
    const handler = (msg: IncomingMsg) => {
      if (msg.type === "OFFSCREEN_START") startRecording(msg)
      if (msg.type === "OFFSCREEN_STOP") stopRecording()
    }
    chrome.runtime.onMessage.addListener(handler)
    // Announce readiness so background can flush any queued start msg
    chrome.runtime.sendMessage({ type: "OFFSCREEN_READY" })
    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [])

  // Intentionally no visible UI; offscreen documents are hidden.
  return null
}
