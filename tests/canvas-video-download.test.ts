import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasVideoDownloadStatus, canvasVideoFilename, downloadCanvasVideo, probeCanvasVideo } from '../src/lib/canvas-video-download';
import { startMediaDownload } from '../src/lib/media-download';
import type { CanvasPageVideo } from '../src/lib/canvas-page-capture';

vi.mock('../src/lib/media-download', () => ({ startMediaDownload: vi.fn() }));
const pageURL = 'https://school.instructure.com/courses/42/pages/lesson';
const video: CanvasPageVideo = { id: 'video-id', title: 'Neurons', kind: 'direct', url: 'https://cdn.example.com/lecture.mp4' };
const mp4 = () => {
  const bytes = new Uint8Array(128);
  bytes.set([0, 0, 0, 24]);
  bytes.set(new TextEncoder().encode('ftypisom'), 4);
  return bytes;
};

describe('Canvas video download', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      tabs: { get: vi.fn().mockResolvedValue({ url: pageURL }) },
      scripting: { executeScript: vi.fn() },
      downloads: { download: vi.fn().mockResolvedValue(17), search: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(mp4(), { headers: { 'content-type': 'video/mp4' } })));
    vi.mocked(startMediaDownload).mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('probes direct bytes without cookies and starts a browser download, not a completed claim', async () => {
    await expect(downloadCanvasVideo(9, pageURL, video)).resolves.toEqual({ ok: true, state: 'started', downloadId: 17 });
    expect(fetch).toHaveBeenCalledWith(video.url, expect.objectContaining({
      credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Range: 'bytes=0-511' },
    }));
    expect(chrome.downloads.download).toHaveBeenCalledWith({
      url: video.url, filename: 'Canvas/Neurons.mp4', conflictAction: 'uniquify', saveAs: false,
    });
  });

  it('resolves Canvas files in the source tab, not through a cookie-export or native session', async () => {
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([{ result: { ok: true, url: 'https://cdn.example.com/download?signature=private' } }] as never);
    await downloadCanvasVideo(9, pageURL, { ...video, kind: 'canvas-file', url: 'https://school.instructure.com/courses/42/files/123/preview', canvasFileId: '123' });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({
      target: { tabId: 9 }, world: 'ISOLATED', args: ['123', pageURL],
    }));
    expect(fetch).toHaveBeenCalledWith('https://cdn.example.com/download?signature=private', expect.objectContaining({ credentials: 'omit' }));
    expect(startMediaDownload).not.toHaveBeenCalled();
  });

  it('rejects a substituted Canvas file ID without making a network call', async () => {
    await expect(downloadCanvasVideo(9, pageURL, { ...video, kind: 'canvas-file', url: 'https://school.instructure.com/files/123/download', canvasFileId: '456' })).rejects.toThrow('no longer matches');
    expect(fetch).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('requires the original Canvas page to still be open', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({ url: 'https://other.example.com/courses/42/pages/lesson' } as never);
    await expect(downloadCanvasVideo(9, pageURL, video)).rejects.toThrow('tab changed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the existing local helper for Vimeo with origin-only referral', async () => {
    vi.mocked(startMediaDownload).mockResolvedValue({ ok: true, filename: 'lecture.mp4' });
    await expect(downloadCanvasVideo(9, pageURL, { ...video, kind: 'vimeo', url: 'https://player.vimeo.com/video/123?h=access' }))
      .resolves.toEqual({ ok: true, state: 'complete', filename: 'lecture.mp4' });
    expect(startMediaDownload).toHaveBeenCalledWith('video', 'https://player.vimeo.com/video/123?h=access', undefined, 'https://school.instructure.com/');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['http://cdn.example.com/movie.mp4', 'file:///movie.mp4', 'https://user:pass@cdn.example.com/movie.mp4'])('rejects unsafe addresses: %s', async (url) => {
    await expect(downloadCanvasVideo(9, pageURL, { ...video, url })).rejects.toThrow();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it.each(['text/html', 'application/json', 'application/vnd.apple.mpegurl'])('refuses non-video MIME %s before creating a download', async (mime) => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'content-type': mime } }));
    await expect(downloadCanvasVideo(9, pageURL, video)).rejects.toThrow();
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('refuses HTML disguised with a video MIME', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'content-type': 'video/mp4' } }));
    await expect(probeCanvasVideo(video.url, pageURL)).rejects.toThrow('recognizable video');
  });

  it('does not buffer the full video when the server ignores Range', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(mp4()); }, cancel });
    vi.mocked(fetch).mockResolvedValue(new Response(stream, { headers: { 'content-type': 'video/mp4' } }));
    await expect(probeCanvasVideo(video.url, pageURL)).resolves.toEqual({ mimeType: 'video/mp4' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('sanitizes output names without allowing path traversal', () => {
    expect(canvasVideoFilename('../lesson/one.mp4', 'video/mp4')).toBe('Canvas/_lesson_one.mp4');
    expect(canvasVideoFilename('', 'video/webm')).toBe('Canvas/Canvas video.webm');
  });

  it('reports actual download completion and interruption', async () => {
    vi.mocked(chrome.downloads.search).mockResolvedValue([{ state: 'complete', filename: '/Users/example/Downloads/Canvas/Neurons.mp4', mime: 'video/mp4' }] as never);
    await expect(canvasVideoDownloadStatus(17)).resolves.toEqual({ ok: true, state: 'complete', downloadId: 17, filename: 'Neurons.mp4' });
    vi.mocked(chrome.downloads.search).mockResolvedValue([{ state: 'interrupted' }] as never);
    await expect(canvasVideoDownloadStatus(17)).rejects.toThrow('interrupted');
  });
});
