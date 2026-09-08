export type MediaDownloadMode = 'video' | 'audio';
const activeDownloads = new Map<string, Promise<{ ok: boolean; filename?: string; error?: string }>>();

export function mediaDownloadUrl(pageUrl: string, sourceUrl?: string): string {
  const page = new URL(pageUrl);
  if (!['https:', 'http:'].includes(page.protocol)) throw new Error('Open a video web page first.');
  // Streaming players use blob URLs; extract those from their hosting page.
  const source = sourceUrl ? new URL(sourceUrl, page) : page;
  const url = ['https:', 'http:'].includes(source.protocol) ? source : page;
  if (url.username || url.password) throw new Error('URLs containing credentials are not supported.');
  return url.href;
}

export function startMediaDownload(mode: MediaDownloadMode, pageUrl: string, sourceUrl?: string) {
  if (mode !== 'video' && mode !== 'audio') throw new Error('Choose video or audio.');
  const url = mediaDownloadUrl(pageUrl, sourceUrl);
  const key = `${mode}:${url}`;
  const existing = activeDownloads.get(key);
  if (existing) return existing;
  if (activeDownloads.size >= 3) throw new Error('Three downloads are running. Wait for one to finish.');
  const job = new Promise<{ ok: boolean; filename?: string; error?: string }>((resolve) => {
    const port = chrome.runtime.connectNative('com.aidev.media_download');
    port.onMessage.addListener(message => { resolve(message); port.disconnect(); });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      resolve({ ok: false, error: error?.message ? `Download helper: ${error.message}` : 'The download helper disconnected.' });
    });
    port.postMessage({ mode, url });
  }).finally(() => { activeDownloads.delete(key); });
  activeDownloads.set(key, job);
  return job;
}
