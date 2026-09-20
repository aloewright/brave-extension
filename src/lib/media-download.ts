export type MediaDownloadMode = 'video' | 'audio';
/** Dedicated native host for media files; it deliberately does not share the
 * general sidebar host's broader terminal/MCP surface. */
export const MEDIA_DOWNLOAD_HOST = 'com.aidev.media_download';
const activeDownloads = new Map<string, Promise<{ ok: boolean; filename?: string; error?: string }>>();
type MediaHostResponse = { ok: boolean; filename?: string; error?: string; id?: string; complete?: boolean };

/** A native Port keeps the MV3 worker alive for the bounded Vimeo transfer.
 * `sendNativeMessage` is unsuitable here because one-off messages have a
 * shorter service-worker lifetime than an instructor video can require. */
export function sendMediaHostMessage(message: unknown, timeoutMs = 31 * 60_000): Promise<MediaHostResponse> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connectNative(MEDIA_DOWNLOAD_HOST);
    let settled = false;
    const finish = (response: MediaHostResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch { /* already disconnected */ }
      resolve(response);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'The video import timed out. Retry the video.' }), timeoutMs);
    port.onMessage.addListener((message: MediaHostResponse) => finish(message));
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      finish({ ok: false, error: error?.message ? `Video helper disconnected: ${error.message}` : 'The video helper disconnected.' });
    });
    try { port.postMessage(message); }
    catch { finish({ ok: false, error: 'The video helper could not start.' }); }
  });
}

export function mediaDownloadUrl(pageUrl: string, sourceUrl?: string): string {
  const page = new URL(pageUrl);
  if (!['https:', 'http:'].includes(page.protocol)) throw new Error('Open a video web page first.');
  // Streaming players use blob URLs; extract those from their hosting page.
  const source = sourceUrl ? new URL(sourceUrl, page) : page;
  const url = ['https:', 'http:'].includes(source.protocol) ? source : page;
  if (url.username || url.password) throw new Error('URLs containing credentials are not supported.');
  return url.href;
}

export function startMediaDownload(mode: MediaDownloadMode, pageUrl: string, sourceUrl?: string, referer?: string) {
  if (mode !== 'video' && mode !== 'audio') throw new Error('Choose video or audio.');
  const url = mediaDownloadUrl(pageUrl, sourceUrl);
  const key = `${mode}:${url}:${referer || ''}`;
  const existing = activeDownloads.get(key);
  if (existing) return existing;
  if (activeDownloads.size >= 3) throw new Error('Three downloads are running. Wait for one to finish.');
  const job = sendMediaHostMessage({ mode, url, ...(referer ? { referer } : {}) })
    .finally(() => { activeDownloads.delete(key); });
  activeDownloads.set(key, job);
  return job;
}
