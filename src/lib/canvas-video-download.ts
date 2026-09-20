import { resolveCanvasFileURL, type CanvasPageVideo } from "./canvas-page-capture";
import { startMediaDownload } from "./media-download";

export type CanvasVideoDownloadResult = {
  ok: true;
  state: "started" | "complete";
  downloadId?: number;
  filename?: string;
};

function webURL(value: string, pageURL: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("This video has no downloadable web address."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || /[\x00-\x20\x7f]/.test(value) || value.length > 16_384
    || (new URL(pageURL).protocol === 'https:' && url.protocol !== 'https:')) {
    throw new Error("This video uses an unsupported download address.");
  }
  return url;
}

/** Serialized into the signed-in tab for same-origin direct media. Only a
 * bounded header/signature probe is read, never the whole lecture video. */
export async function probeCanvasVideo(url: string, pageURL: string, inPage = false): Promise<{ mimeType: string }> {
  const source = new URL(pageURL);
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password
    || (source.protocol === 'https:' && target.protocol !== 'https:')
    || (inPage && (location.origin !== source.origin || target.origin !== source.origin))) {
    throw new Error("The Canvas tab changed. Reopen the import panel and try again.");
  }
  let response: Response;
  try {
    response = await fetch(target.href, {
      method: 'GET', headers: { Range: 'bytes=0-511' },
      credentials: inPage ? 'include' : 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error("Could not reach this video. Check your Canvas session and retry.");
  }
  try {
    const finalURL = new URL(response.url || target.href);
    if (source.protocol === 'https:' && finalURL.protocol !== 'https:') throw new Error("The video redirected to an insecure address.");
    if (!response.ok) throw new Error(`Video download unavailable (HTTP ${response.status}). Check access in Canvas and retry.`);
    const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/ogg', 'application/octet-stream'].includes(mimeType)) {
      throw new Error(mimeType === 'text/html'
        ? 'Canvas returned a sign-in or preview page, not a video. Open the video in Canvas and try again.'
        : 'This is a streaming playlist or unsupported video format, not a downloadable video file.');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('The video response was empty.');
    let prefix = new Uint8Array();
    try {
      while (prefix.length < 64) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const next = new Uint8Array(Math.min(512, prefix.length + chunk.value.length));
        next.set(prefix); next.set(chunk.value.subarray(0, next.length - prefix.length), prefix.length);
        prefix = next;
      }
    } finally { await reader.cancel().catch(() => {}); }
    const ascii = (from: number, count: number) => String.fromCharCode(...prefix.slice(from, from + count));
    const brands = ascii(8, 56);
    const mp4 = ascii(4, 4) === 'ftyp' && /isom|iso[2-9]|mp4[12]|avc1|M4V |qt  |dash/.test(brands);
    const webm = prefix[0] === 0x1a && prefix[1] === 0x45 && prefix[2] === 0xdf && prefix[3] === 0xa3;
    const ogg = ascii(0, 4) === 'OggS';
    if (!mp4 && !webm && !ogg) throw new Error('The server did not return a recognizable video file. Nothing was downloaded.');
    return { mimeType: mp4 ? 'video/mp4' : webm ? 'video/webm' : 'video/ogg' };
  } finally {
    if (!response.body?.locked) await response.body?.cancel().catch(() => {});
  }
}

export function canvasVideoFilename(title: string, mimeType: string): string {
  const extension = mimeType === 'video/webm' ? 'webm' : mimeType === 'video/ogg' ? 'ogv' : 'mp4';
  const name = title.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_')
    .replace(/^\.+/, '').replace(/[ .]+$/, '').replace(/\.(mp4|webm|mov|m4v|ogv)$/i, '').trim().slice(0, 120);
  return `Canvas/${name || 'Canvas video'}.${extension}`;
}

/** The caller selects this descriptor from the service-worker's staged draft;
 * a message from the page can never supply or substitute a download URL. */
export async function downloadCanvasVideo(tabId: number, pageURL: string, video: CanvasPageVideo): Promise<CanvasVideoDownloadResult> {
  const tab = await chrome.tabs.get(tabId);
  const current = webURL(tab.url || '', pageURL);
  const source = webURL(pageURL, pageURL);
  if (current.origin !== source.origin || current.pathname !== source.pathname) {
    throw new Error('The Canvas tab changed. Reopen the import panel and try again.');
  }
  let target = webURL(video.url, pageURL);
  if (video.kind === 'vimeo') {
    if (target.hostname !== 'player.vimeo.com' || !/^\/video\/\d+\/?$/.test(target.pathname)) {
      throw new Error('This embedded player is not supported for download.');
    }
    const result = await startMediaDownload('video', target.href, undefined, source.origin + '/');
    if (!result.ok) throw new Error(result.error || 'The video provider did not allow this download.');
    return { ok: true, state: 'complete', filename: result.filename };
  }
  if (video.kind === 'canvas-file') {
    const match = target.origin === source.origin
      ? target.pathname.match(/^\/(?:(?:courses|groups|users)\/\d+\/)?files\/([1-9]\d{0,29})(?:\/(?:preview|download))?\/?$/) : null;
    if (!match || match[1] !== video.canvasFileId) throw new Error('The video no longer matches its Canvas file.');
    const [result] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', func: resolveCanvasFileURL, args: [match[1], pageURL],
    });
    if (!result?.result?.ok) throw new Error('Canvas did not provide a download for this video. Check your access and retry.');
    target = webURL(result.result.url, pageURL);
  }
  const probe = video.kind === 'direct' && target.origin === source.origin
    ? (await chrome.scripting.executeScript({
      target: { tabId }, world: 'ISOLATED', func: probeCanvasVideo, args: [target.href, pageURL, true],
    }))[0]?.result
    : await probeCanvasVideo(target.href, pageURL);
  if (!probe?.mimeType) throw new Error('Could not verify this video. Nothing was downloaded.');
  let downloadId: number;
  try {
    downloadId = await chrome.downloads.download({
      url: target.href, filename: canvasVideoFilename(video.title, probe.mimeType),
      conflictAction: 'uniquify', saveAs: false,
    });
  } catch { throw new Error('The browser could not start the video download. Please retry.'); }
  return { ok: true, state: 'started', downloadId };
}

export async function canvasVideoDownloadStatus(downloadId: number): Promise<CanvasVideoDownloadResult> {
  const [download] = await chrome.downloads.search({ id: downloadId });
  if (!download) throw new Error('The download is no longer available. Retry to download it again.');
  if (download.state === 'interrupted') throw new Error('The video download was interrupted. Check browser Downloads, then retry.');
  if (download.state !== 'complete') return { ok: true, state: 'started', downloadId };
  if (download.mime?.startsWith('text/') || download.mime === 'application/json') {
    throw new Error('The server returned a page instead of a video. Check browser Downloads and sign in to Canvas again.');
  }
  return { ok: true, state: 'complete', downloadId, filename: download.filename.split(/[\\/]/).pop() };
}
