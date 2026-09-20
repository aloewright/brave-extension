import { resolveCanvasFileURL, type CanvasPageVideo } from "./canvas-page-capture";
import { probeCanvasVideo } from "./canvas-video-download";

export const CANVAS_VIDEO_MAX_BYTES = 4 * 1024 * 1024 * 1024;

export type ResolvedCanvasVideoImport = {
  url: string;
  mimeType: string;
  sameOrigin: boolean;
};

/** Chrome extension messages use JSON serialization, not structured clone.
 * Decode only one validated wire chunk at a time in the service worker. */
export function decodeCanvasVideoChunk(base64: unknown, chunkBytes: number): Uint8Array {
  if (typeof base64 !== "string" || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1
    || base64.length < 4 || base64.length > Math.ceil(chunkBytes / 3) * 4 + 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Invalid video chunk.");
  }
  let binary: string;
  try { binary = atob(base64); } catch { throw new Error("Invalid video chunk."); }
  if (!binary.length || binary.length > chunkBytes) throw new Error("Invalid video chunk.");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safeWebURL(value: string, pageURL: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("This video has no importable web address."); }
  const source = new URL(pageURL);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || /[\x00-\x20\x7f]/.test(value) || value.length > 16_384
    || (source.protocol === 'https:' && url.protocol !== 'https:')) {
    throw new Error("This video uses an unsupported import address.");
  }
  return url;
}

export async function resolveCanvasVideoImport(tabId: number, pageURL: string, video: CanvasPageVideo): Promise<ResolvedCanvasVideoImport> {
  const tab = await chrome.tabs.get(tabId);
  const current = safeWebURL(tab.url || "", pageURL);
  const source = safeWebURL(pageURL, pageURL);
  if (current.origin !== source.origin || current.pathname !== source.pathname) {
    throw new Error("The Canvas tab changed. Reopen the import panel and try again.");
  }
  if (video.kind === "vimeo") throw new Error("Vimeo videos must be imported through the local video helper.");
  let target = safeWebURL(video.url, pageURL);
  if (video.kind === "canvas-file") {
    const match = target.origin === source.origin
      ? target.pathname.match(/^\/(?:(?:courses|groups|users)\/\d+\/)?files\/([1-9]\d{0,29})(?:\/(?:preview|download))?\/?$/)
      : null;
    if (!match || match[1] !== video.canvasFileId) throw new Error("The video no longer matches its Canvas file.");
    const [result] = await chrome.scripting.executeScript({
      target: { tabId }, world: "ISOLATED", func: resolveCanvasFileURL, args: [match[1], pageURL],
    });
    if (!result?.result?.ok) throw new Error("Canvas did not provide a download for this video. Check your access and retry.");
    target = safeWebURL(result.result.url, pageURL);
  }
  const sameOrigin = target.origin === source.origin;
  const probe = sameOrigin
    ? (await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: probeCanvasVideo, args: [target.href, pageURL, true] }))[0]?.result
    : await probeCanvasVideo(target.href, pageURL);
  if (!probe?.mimeType) throw new Error("Could not verify this video. Nothing was imported.");
  return { url: target.href, mimeType: probe.mimeType, sameOrigin };
}

/** Self-contained because executeScript serializes this function into the
 * signed-in Canvas tab's isolated world. The bearer remains in the worker:
 * this code receives only a one-upload nonce and sends bounded chunks back to
 * that worker. */
export async function streamCanvasVideoInIsolated(
  url: string,
  pageURL: string,
  transfer: { captureId: string; videoId: string; transferNonce: string; chunkBytes: number },
): Promise<{ bytes: number }> {
  const source = new URL(pageURL);
  const target = new URL(url);
  const current = new URL(location.href);
  if (current.origin !== source.origin || current.pathname !== source.pathname || target.origin !== source.origin) {
    throw new Error("The Canvas tab changed. Reopen the import panel and try again.");
  }
  const response = await fetch(target.href, {
    credentials: "include", cache: "no-store", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(30 * 60_000),
  });
  if (!response.ok || !response.body) throw new Error("Canvas could not provide this video. Check your access and retry.");
  const type = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (!/^video\//.test(type) && type !== "application/octet-stream") throw new Error("Canvas returned a page instead of a video.");
  const reader = response.body.getReader();
  let carry = new Uint8Array(transfer.chunkBytes);
  let filled = 0;
  let index = 0;
  let total = 0;
  try {
    const submit = async (data: Uint8Array) => {
      let binary = "";
      // Avoid applying a 1 MiB array to String.fromCharCode at once.
      for (let offset = 0; offset < data.byteLength; offset += 0x8000) {
        binary += String.fromCharCode(...data.subarray(offset, Math.min(offset + 0x8000, data.byteLength)));
      }
      const result = await chrome.runtime.sendMessage({
        type: "keepout/video-import-chunk", captureId: transfer.captureId, videoId: transfer.videoId,
        transferNonce: transfer.transferNonce, index: index++, bytesBase64: btoa(binary),
      });
      if (!result?.ok) throw new Error(result?.error || "Keepout could not save this video chunk.");
    };
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 4 * 1024 * 1024 * 1024) throw new Error("This video exceeds Keepout's 4 GiB limit.");
      let offset = 0;
      while (offset < next.value.byteLength) {
        const count = Math.min(transfer.chunkBytes - filled, next.value.byteLength - offset);
        carry.set(next.value.subarray(offset, offset + count), filled);
        offset += count;
        filled += count;
        if (filled === transfer.chunkBytes) {
          await submit(carry);
          carry = new Uint8Array(transfer.chunkBytes);
          filled = 0;
        }
      }
    }
    if (filled) await submit(carry.subarray(0, filled));
    return { bytes: total };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function safeCanvasVideoImportError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "The video could not be imported. Please retry.";
  return raw.replace(/https?:\/\/\S+/g, "[video address]").slice(0, 500);
}
