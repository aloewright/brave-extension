/**
 * Offscreen document — runs MediaRecorder for tab/screen/camera.
 * (M6, ALO-248)
 *
 * Protocol:
 *   bg → { type: "RECORDER_START", id, source, streamId? }
 *   bg → { type: "RECORDER_STOP" }
 *   bg → { type: "RECORDER_PAUSE" | "RECORDER_RESUME" }
 *   off → { type: "RECORDER_READY" }
 *   off → { type: "RECORDER_STARTED", id }
 *   off → { type: "RECORDER_TICK", id, durationMs }
 *   off → { type: "RECORDER_STOPPED", id, source, durationMs, sizeBytes, mimeType, blobUrl }
 *   off → { type: "RECORDER_MIRROR_START",  id, mimeType }
 *   off → { type: "RECORDER_MIRROR_CHUNK",  id, base64 }      // many of these
 *   off → { type: "RECORDER_MIRROR_FINISH", id }
 *   off → { type: "RECORDER_ERROR", error }
 *
 * Memory note: instead of sending a giant base64 string back to the SW, we
 * create a Blob URL here (background just downloads it) and stream the
 * native-mirror payload to the background in 768KB slices, peak memory
 * ~768KB rather than the full recording.
 */
import { useEffect } from "react";
import {
  RECORDER_MIME_CANDIDATES,
  normalizeRecordingMimeType,
  type RecorderSource,
  type RecordingMimeType,
} from "../types";
import { DEFAULT_CHUNK_BYTES } from "../lib/recorder-chunks";

type StartMsg = {
  type: "RECORDER_START"
  id: string
  source: RecorderSource
  streamId?: string
  desktopAudio?: boolean
}

type StopMsg = { type: "RECORDER_STOP" };
type PauseMsg = { type: "RECORDER_PAUSE" };
type ResumeMsg = { type: "RECORDER_RESUME" };
type ControlMsg = StopMsg | PauseMsg | ResumeMsg;

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let activeStream: MediaStream | null = null;
let activeId: string | null = null;
let activeSource: RecorderSource | null = null;
let activeMimeType: RecordingMimeType = "video/mp4";
let startedAt = 0;
let elapsedBeforePauseMs = 0;
let lastResumeAt = 0;
let tickTimer: ReturnType<typeof setInterval> | null = null;

export function chooseRecorderMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | undefined {
  return RECORDER_MIME_CANDIDATES.find((mimeType) => {
    try {
      return isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });
}

function shouldRetryWithoutAudio(err: unknown): boolean {
  const name = (err as DOMException | Error | undefined)?.name;
  return (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError"
  );
}

async function withOptionalAudio(
  withAudio: () => Promise<MediaStream>,
  withoutAudio: () => Promise<MediaStream>,
): Promise<MediaStream> {
  try {
    return await withAudio();
  } catch (err) {
    if (!shouldRetryWithoutAudio(err)) throw err;
    return await withoutAudio();
  }
}

async function acquireStream(msg: StartMsg): Promise<MediaStream> {
  if (msg.source === "tab") {
    if (!msg.streamId) throw new Error("tab capture: missing streamId");
    return (await navigator.mediaDevices.getUserMedia({
      audio: {
        // @ts-expect-error non-standard tab capture constraints
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId,
        },
      },
      video: {
        // @ts-expect-error non-standard tab capture constraints
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: msg.streamId,
        },
      },
    })) as MediaStream;
  }
  if (msg.source === "screen") {
    if (msg.streamId) {
      const video = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: msg.streamId
        }
      } as unknown as MediaTrackConstraints
      const audio = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: msg.streamId
        }
      } as unknown as MediaTrackConstraints
      if (!msg.desktopAudio) {
        return (await navigator.mediaDevices.getUserMedia({
          audio: false,
          video
        })) as MediaStream
      }
      return await withOptionalAudio(
        () =>
          navigator.mediaDevices.getUserMedia({
            audio,
            video
          }) as Promise<MediaStream>,
        () =>
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video
          }) as Promise<MediaStream>
      )
    }
    return await withOptionalAudio(
      () =>
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }),
      () =>
        navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }),
    );
  }
  // camera
  return await withOptionalAudio(
    () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    () => navigator.mediaDevices.getUserMedia({ video: true, audio: false }),
  );
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
  sliceBytes = DEFAULT_CHUNK_BYTES,
  mimeType = normalizeRecordingMimeType(blob.type),
): Promise<void> {
  send({ type: "RECORDER_MIRROR_START", id, mimeType });
  // sliceBytes is the *binary* slice size; base64 expansion (~4/3) keeps each
  // emitted message comfortably under the native messaging 1 MB cap.
  for (let start = 0; start < blob.size; start += sliceBytes) {
    const end = Math.min(start + sliceBytes, blob.size);
    const slice = blob.slice(start, end);
    const buf = new Uint8Array(await slice.arrayBuffer());
    let binary = "";
    const STR_SLICE = 0x8000; // 32 KB → safe for String.fromCharCode.apply
    for (let i = 0; i < buf.length; i += STR_SLICE) {
      const piece = buf.subarray(i, Math.min(i + STR_SLICE, buf.length));
      binary += String.fromCharCode.apply(null, Array.from(piece) as number[]);
    }
    const base64 = btoa(binary);
    send({ type: "RECORDER_MIRROR_CHUNK", id, base64 });
  }
  send({ type: "RECORDER_MIRROR_FINISH", id });
}

async function startRecording(msg: StartMsg) {
  if (recorder) return;
  if (typeof MediaRecorder === "undefined") {
    chrome.runtime.sendMessage({
      type: "RECORDER_ERROR",
      error: "MediaRecorder is not available in this browser context",
    });
    return;
  }

  try {
    const selectedMime = chooseRecorderMimeType((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    );
    if (!selectedMime) {
      chrome.runtime.sendMessage({
        type: "RECORDER_ERROR",
        error: "MP4/MOV recording is not supported by this browser",
      });
      return;
    }
    const stream = await acquireStream(msg);
    activeStream = stream;
    activeId = msg.id;
    activeSource = msg.source;
    chunks = [];

    // For tab capture, keep audio audible to the user — tab capture
    // otherwise mutes the source tab.
    if (msg.source === "tab") {
      try {
        const ac = new AudioContext();
        const src = ac.createMediaStreamSource(stream);
        src.connect(ac.destination);
      } catch {
        // non-fatal
      }
    }

    recorder = new MediaRecorder(stream, { mimeType: selectedMime });
    activeMimeType = normalizeRecordingMimeType(
      recorder.mimeType || selectedMime,
    );

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      const id = activeId!;
      const source = activeSource!;
      const mimeType = activeMimeType;
      const durationMs = currentDurationMs();
      try {
        const blob = new Blob(chunks, { type: mimeType });
        const blobUrl = URL.createObjectURL(blob);
        chrome.runtime.sendMessage({
          type: "RECORDER_STOPPED",
          id,
          source,
          durationMs,
          sizeBytes: blob.size,
          mimeType,
          blobUrl,
        });
        // Stream the mirror payload chunk-by-chunk to the SW (which forwards
        // to native). Peak memory ~768KB regardless of recording length.
        try {
          await streamBlobToMirror(
            blob,
            id,
            (m) => chrome.runtime.sendMessage(m).catch(() => {}),
            DEFAULT_CHUNK_BYTES,
            mimeType,
          );
        } catch (err) {
          // Mirror is best-effort; the download path already succeeded above.
          console.warn("[recorder] mirror streaming failed", err);
        }
      } catch (err) {
        chrome.runtime.sendMessage({
          type: "RECORDER_ERROR",
          error: (err as Error).message,
        });
      } finally {
        chunks = [];
        recorder = null;
        if (activeStream) {
          for (const t of activeStream.getTracks()) t.stop();
          activeStream = null;
        }
        activeId = null;
        activeSource = null;
        activeMimeType = "video/mp4";
        startedAt = 0;
        elapsedBeforePauseMs = 0;
        lastResumeAt = 0;
        stopDurationTicks();
      }
    };

    // If the user revokes the screen share / closes the tab, stop gracefully.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    });

    startedAt = Date.now();
    elapsedBeforePauseMs = 0;
    lastResumeAt = startedAt;
    recorder.start(1000);
    startDurationTicks();
    chrome.runtime.sendMessage({ type: "RECORDER_STARTED", id: msg.id });
  } catch (err) {
    chrome.runtime.sendMessage({
      type: "RECORDER_ERROR",
      error: (err as Error).message,
    });
  }
}

function currentDurationMs(now = Date.now()): number {
  if (!lastResumeAt) return elapsedBeforePauseMs;
  return elapsedBeforePauseMs + Math.max(0, now - lastResumeAt);
}

function startDurationTicks() {
  stopDurationTicks();
  tickTimer = setInterval(() => {
    if (!activeId) return;
    chrome.runtime
      .sendMessage({
        type: "RECORDER_TICK",
        id: activeId,
        durationMs: currentDurationMs(),
      })
      .catch(() => {});
  }, 1000);
}

function stopDurationTicks() {
  if (!tickTimer) return;
  clearInterval(tickTimer);
  tickTimer = null;
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

function pauseRecording() {
  if (!recorder || recorder.state !== "recording") return;
  recorder.pause();
  elapsedBeforePauseMs = currentDurationMs();
  lastResumeAt = 0;
  chrome.runtime
    .sendMessage({ type: "RECORDER_PAUSED", id: activeId })
    .catch(() => {});
}

function resumeRecording() {
  if (!recorder || recorder.state !== "paused") return;
  recorder.resume();
  lastResumeAt = Date.now();
  chrome.runtime
    .sendMessage({ type: "RECORDER_RESUMED", id: activeId })
    .catch(() => {});
}

export default function Offscreen() {
  useEffect(() => {
    const handler = (msg: StartMsg | ControlMsg) => {
      if (msg.type === "RECORDER_START") void startRecording(msg);
      if (msg.type === "RECORDER_STOP") stopRecording();
      if (msg.type === "RECORDER_PAUSE") pauseRecording();
      if (msg.type === "RECORDER_RESUME") resumeRecording();
    };
    chrome.runtime.onMessage.addListener(handler);
    chrome.runtime.sendMessage({ type: "RECORDER_READY" });
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);
  return null;
}
