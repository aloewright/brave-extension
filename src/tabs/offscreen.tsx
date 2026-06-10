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
 *   bg  → { type: "TERMINAL_KEEPALIVE_START" | "TERMINAL_KEEPALIVE_STOP" }
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
  type: "RECORDER_START";
  id: string;
  source: RecorderSource;
  streamId?: string;
  desktopAudio?: boolean;
};

type StopMsg = { type: "RECORDER_STOP" };
type PauseMsg = { type: "RECORDER_PAUSE" };
type ResumeMsg = { type: "RECORDER_RESUME" };
type ControlMsg = StopMsg | PauseMsg | ResumeMsg;
type TerminalKeepAliveMsg =
  | { type: "TERMINAL_KEEPALIVE_START" }
  | { type: "TERMINAL_KEEPALIVE_STOP" };
type TtsPlayMsg = {
  type: "TTS_PLAY_STREAM";
  id?: string;
  text: string;
  ttsModel?: string;
  speaker?: string;
  playbackRate?: number;
  apiUrl: string;
  apiToken: string;
};
type TtsControlMsg = { type: "TTS_CONTROL"; action: string; value?: number };

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
let terminalKeepAliveEnabled = false;
let terminalKeepAlivePort: chrome.runtime.Port | null = null;
let terminalKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
let ttsAudio: HTMLAudioElement | null = null;
let ttsObjectUrl: string | null = null;
let ttsTickTimer: ReturnType<typeof setInterval> | null = null;
let ttsActiveId: string | undefined;
let finishCurrentTtsChunk: (() => void) | null = null;

const TERMINAL_KEEPALIVE_INTERVAL_MS = 15_000;
const TERMINAL_KEEPALIVE_PORT_NAME = "terminal-keepalive";
const TTS_CHUNK_MAX_CHARS = 3_800;

function connectTerminalKeepAlivePort() {
  if (!terminalKeepAliveEnabled || terminalKeepAlivePort) return;
  try {
    const port = chrome.runtime.connect({ name: TERMINAL_KEEPALIVE_PORT_NAME });
    terminalKeepAlivePort = port;
    port.onDisconnect.addListener(() => {
      if (terminalKeepAlivePort === port) terminalKeepAlivePort = null;
      if (terminalKeepAliveEnabled) {
        setTimeout(sendTerminalKeepAlivePing, 250);
      }
    });
  } catch {
    terminalKeepAlivePort = null;
  }
}

function sendTerminalKeepAlivePing() {
  if (!terminalKeepAliveEnabled) return;
  connectTerminalKeepAlivePort();
  try {
    terminalKeepAlivePort?.postMessage({
      type: "terminal-keepalive-ping",
      at: Date.now(),
    });
  } catch {
    terminalKeepAlivePort = null;
  }
}

function startTerminalKeepAlive() {
  terminalKeepAliveEnabled = true;
  sendTerminalKeepAlivePing();
  if (!terminalKeepAliveTimer) {
    terminalKeepAliveTimer = setInterval(
      sendTerminalKeepAlivePing,
      TERMINAL_KEEPALIVE_INTERVAL_MS,
    );
  }
}

function stopTerminalKeepAlive() {
  terminalKeepAliveEnabled = false;
  if (terminalKeepAliveTimer) {
    clearInterval(terminalKeepAliveTimer);
    terminalKeepAliveTimer = null;
  }
  try {
    terminalKeepAlivePort?.disconnect();
  } catch {
    // ignore
  }
  terminalKeepAlivePort = null;
}

function clampTtsPlaybackRate(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(5, Math.max(0.1, parsed));
}

function broadcastTtsState(extra: Record<string, unknown> = {}) {
  const state = {
    status: ttsAudio ? (ttsAudio.paused ? "paused" : "playing") : "idle",
    currentTime: ttsAudio?.currentTime ?? 0,
    duration: Number.isFinite(ttsAudio?.duration || NaN) ? ttsAudio?.duration : null,
    playbackRate: ttsAudio?.playbackRate ?? 1,
    ...extra,
  };
  chrome.runtime.sendMessage({ type: "TTS_STATE", state }).catch(() => {});
}

function stopTtsAudio(status: "idle" | "ended" | "error" = "idle") {
  if (ttsTickTimer) {
    clearInterval(ttsTickTimer);
    ttsTickTimer = null;
  }
  clearCurrentTtsAudio();
  broadcastTtsState({ status });
}

function clearCurrentTtsAudio() {
  if (ttsAudio) {
    ttsAudio.pause();
    ttsAudio.removeAttribute("src");
    ttsAudio.load();
    ttsAudio = null;
  }
  if (ttsObjectUrl) {
    URL.revokeObjectURL(ttsObjectUrl);
    ttsObjectUrl = null;
  }
  const finish = finishCurrentTtsChunk;
  finishCurrentTtsChunk = null;
  finish?.();
}

function splitTtsText(text: string, maxChars = TTS_CHUNK_MAX_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let current = "";
  const parts = normalized.match(/[^.!?;:]+[.!?;:]?\s*|\S+/g) || [normalized];
  const pushCurrent = () => {
    const next = current.trim();
    if (next) chunks.push(next);
    current = "";
  };
  for (const part of parts) {
    const sentence = part.trim();
    if (!sentence) continue;
    if (sentence.length > maxChars) {
      pushCurrent();
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    const next = current ? current + " " + sentence : sentence;
    if (next.length > maxChars) {
      pushCurrent();
      current = sentence;
    } else {
      current = next;
    }
  }
  pushCurrent();
  return chunks;
}

async function fetchTtsAudioChunk(msg: TtsPlayMsg, text: string): Promise<Blob> {
  const base = msg.apiUrl.replace(/\/+$/, "");
  const res = await fetch(base + "/api/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sidebar-token": msg.apiToken,
    },
    body: JSON.stringify({ text, speaker: msg.speaker, ttsModel: msg.ttsModel }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message || "TTS request failed: " + res.status);
  }
  return await res.blob();
}

function queueTtsAudioChunk(msg: TtsPlayMsg, text: string): Promise<Blob> {
  const request = fetchTtsAudioChunk(msg, text);
  request.catch(() => undefined);
  return request;
}

function playTtsBlob(input: {
  blob: Blob;
  id?: string;
  title: string;
  playbackRate: number;
  chunkIndex: number;
  totalChunks: number;
  onStarted: () => void;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (input.id && ttsActiveId !== input.id) {
      resolve();
      return;
    }

    clearCurrentTtsAudio();
    ttsObjectUrl = URL.createObjectURL(input.blob);
    ttsAudio = new Audio(ttsObjectUrl);
    ttsAudio.playbackRate = input.playbackRate;
    finishCurrentTtsChunk = resolve;

    const chunkMessage =
      input.totalChunks > 1
        ? `Playing speech ${input.chunkIndex + 1}/${input.totalChunks}...`
        : undefined;

    ttsAudio.onloadedmetadata = () => broadcastTtsState({ status: "playing", title: input.title, message: chunkMessage });
    ttsAudio.ontimeupdate = () => broadcastTtsState({ title: input.title, message: chunkMessage });
    ttsAudio.onpause = () => broadcastTtsState({ status: "paused", title: input.title, message: chunkMessage });
    ttsAudio.onplay = () => {
      input.onStarted();
      broadcastTtsState({ status: "playing", title: input.title, message: chunkMessage });
    };
    ttsAudio.onended = () => {
      clearCurrentTtsAudio();
    };
    ttsAudio.onerror = () => {
      finishCurrentTtsChunk = null;
      clearCurrentTtsAudio();
      reject(new Error("Audio element failed to load or play TTS data"));
    };

    void ttsAudio.play().catch((err) => {
      finishCurrentTtsChunk = null;
      clearCurrentTtsAudio();
      reject(err);
    });
  });
}

async function playTtsAudio(msg: TtsPlayMsg) {
  ttsActiveId = msg.id;
  try {
    stopTtsAudio("idle");
    const title = msg.text.slice(0, 80);
    const playbackRate = clampTtsPlaybackRate(msg.playbackRate);
    const chunks = splitTtsText(msg.text);
    if (chunks.length === 0) throw new Error("No TTS text to speak");
    let playbackStarted = false;
    const notifyStarted = () => {
      if (playbackStarted) return;
      playbackStarted = true;
      chrome.runtime.sendMessage({ type: "TTS_PLAYBACK_STARTED", id: msg.id }).catch(() => {});
      if (!ttsTickTimer) ttsTickTimer = setInterval(() => broadcastTtsState({ title }), 500);
    };

    broadcastTtsState({ status: "loading", title, message: "Preparing audio...", playbackRate });
    chrome.runtime.sendMessage({ type: "TTS_PLAYBACK_ACCEPTED", id: msg.id }).catch(() => {});
    let nextBlob = queueTtsAudioChunk(msg, chunks[0]);
    for (let i = 0; i < chunks.length; i += 1) {
      if (msg.id && ttsActiveId !== msg.id) return;
      const message = chunks.length > 1 ? `Preparing audio ${i + 1}/${chunks.length}...` : "Preparing audio...";
      broadcastTtsState({ status: "loading", title, message, playbackRate });
      const blob = await nextBlob;
      if (i + 1 < chunks.length) {
        nextBlob = queueTtsAudioChunk(msg, chunks[i + 1]);
      }
      await playTtsBlob({
        blob,
        id: msg.id,
        title,
        playbackRate,
        chunkIndex: i,
        totalChunks: chunks.length,
        onStarted: notifyStarted,
      });
    }
    chrome.runtime.sendMessage({ type: "TTS_PLAYBACK_ENDED", id: msg.id }).catch(() => {});
    stopTtsAudio("ended");
  } catch (err) {
    chrome.runtime
      .sendMessage({
        type: "TTS_PLAYBACK_ERROR",
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      })
      .catch(() => {});
    stopTtsAudio("error");
  }
}

function controlTtsAudio(msg: TtsControlMsg) {
  if (msg.action === "stop") {
    const id = ttsActiveId;
    ttsActiveId = undefined;
    stopTtsAudio("idle");
    chrome.runtime.sendMessage({ type: "TTS_PLAYBACK_ENDED", id }).catch(() => {});
    return;
  }
  if (!ttsAudio) return;
  if (msg.action === "pause") void ttsAudio.pause();
  if (msg.action === "play") void ttsAudio.play().catch(() => {});
  if (msg.action === "seekBy") {
    ttsAudio.currentTime = Math.max(0, ttsAudio.currentTime + Number(msg.value || 0));
  }
  if (msg.action === "seekTo") {
    ttsAudio.currentTime = Math.max(0, Number(msg.value || 0));
  }
  broadcastTtsState();
}

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
          chromeMediaSourceId: msg.streamId,
        },
      } as unknown as MediaTrackConstraints;
      const audio = {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: msg.streamId,
        },
      } as unknown as MediaTrackConstraints;
      if (!msg.desktopAudio) {
        return (await navigator.mediaDevices.getUserMedia({
          audio: false,
          video,
        })) as MediaStream;
      }
      return await withOptionalAudio(
        () =>
          navigator.mediaDevices.getUserMedia({
            audio,
            video,
          }) as Promise<MediaStream>,
        () =>
          navigator.mediaDevices.getUserMedia({
            audio: false,
            video,
          }) as Promise<MediaStream>,
      );
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
    const handler = (msg: StartMsg | ControlMsg | TerminalKeepAliveMsg | TtsPlayMsg | TtsControlMsg) => {
      if (msg.type === "RECORDER_START") void startRecording(msg);
      if (msg.type === "RECORDER_STOP") stopRecording();
      if (msg.type === "RECORDER_PAUSE") pauseRecording();
      if (msg.type === "RECORDER_RESUME") resumeRecording();
      if (msg.type === "TERMINAL_KEEPALIVE_START") startTerminalKeepAlive();
      if (msg.type === "TERMINAL_KEEPALIVE_STOP") stopTerminalKeepAlive();
      if (msg.type === "TTS_PLAY_STREAM") void playTtsAudio(msg);
      if (msg.type === "TTS_CONTROL") controlTtsAudio(msg);
    };
    chrome.runtime.onMessage.addListener(handler);
    chrome.runtime.sendMessage({ type: "RECORDER_READY" });
    return () => {
      chrome.runtime.onMessage.removeListener(handler);
      stopTerminalKeepAlive();
    };
  }, []);
  return null;
}
