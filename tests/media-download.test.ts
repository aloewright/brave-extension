import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldShowMediaDownloadButton } from '../src/lib/media-download-controls';
import { MEDIA_DOWNLOAD_HOST, mediaDownloadUrl, sendMediaHostMessage } from '../src/lib/media-download';
import { DEFAULT_SETTINGS } from '../src/types';
import { downloadArguments } from '../native-host/media-download.mjs';

describe('one-click media downloads', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a Vimeo import on the dedicated native Port until the helper replies', async () => {
    let onMessage: ((message: { ok: boolean; complete?: boolean; id?: string }) => void) | undefined;
    const disconnect = vi.fn();
    const postMessage = vi.fn(() => onMessage?.({ ok: true, complete: true, id: 'video-id' }));
    vi.stubGlobal('chrome', { runtime: {
      connectNative: vi.fn(() => ({
        onMessage: { addListener: (listener: typeof onMessage) => { onMessage = listener; } },
        onDisconnect: { addListener: vi.fn() }, postMessage, disconnect,
      })),
    } });

    await expect(sendMediaHostMessage({ mode: 'keepout-video' })).resolves.toMatchObject({ ok: true, complete: true });
    expect(chrome.runtime.connectNative).toHaveBeenCalledWith(MEDIA_DOWNLOAD_HOST);
    expect(postMessage).toHaveBeenCalledWith({ mode: 'keepout-video' });
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('uses the direct file when a player has one', () => {
    expect(mediaDownloadUrl('https://example.com/watch', '/movie.mp4')).toBe('https://example.com/movie.mp4');
  });
  it('extracts blob-backed streams from the hosting page', () => {
    expect(mediaDownloadUrl('https://www.youtube.com/watch?v=abc', 'blob:https://www.youtube.com/id')).toBe('https://www.youtube.com/watch?v=abc');
  });
  it('rejects privileged pages and credential-bearing URLs', () => {
    expect(() => mediaDownloadUrl('chrome://settings')).toThrow();
    expect(() => mediaDownloadUrl('https://example.com', 'https://user:pass@example.com/video')).toThrow();
    expect(() => downloadArguments({ mode: 'video', url: 'file:///etc/passwd' }, '/tmp')).toThrow();
  });
  it('extracts MP3 audio and merges video without a shell or playlists', () => {
    const request = { mode: 'audio', url: 'https://example.com/video?a=$(touch%20bad)' };
    const audio = downloadArguments(request, '/tmp/Download folder');
    expect(audio).toContain('--extract-audio');
    expect(audio).toContain('mp3');
    expect(audio).toContain('--ignore-config');
    expect(audio).toContain('--no-playlist');
    expect(audio.at(-2)).toBe('--');
    expect(audio.at(-1)).toBe(new URL(request.url).href);
    const video = downloadArguments({ ...request, mode: 'video' }, '/tmp');
    expect(video).toContain('--merge-output-format');
    expect(video).not.toContain('--extract-audio');
    expect(() => downloadArguments({ ...request, mode: 'exec' }, '/tmp')).toThrow();
  });

  it('sends only the Canvas origin as an optional Vimeo referer, never course or query details', () => {
    const args = downloadArguments({ mode: 'video', url: 'https://player.vimeo.com/video/123', referer: 'https://school.example.com/courses/private?token=secret' }, '/tmp');
    expect(args[args.indexOf('--referer') + 1]).toBe('https://school.example.com/');
    expect(args.join(' ')).not.toContain('secret');
    expect(args.join(' ')).not.toContain('--cookies');
    expect(() => downloadArguments({ mode: 'video', url: 'https://player.vimeo.com/video/123', referer: 'file:///tmp' }, '/tmp')).toThrow();
  });

  it.each(['video', 'audio'] as const)('hides the %s button by default, including for missing or reset settings', (mode) => {
    expect(DEFAULT_SETTINGS.hideVideoDownloadButton).toBe(true);
    expect(DEFAULT_SETTINGS.hideAudioDownloadButton).toBe(true);
    for (const settings of [DEFAULT_SETTINGS, {}, undefined, null]) {
      expect(shouldShowMediaDownloadButton(mode, settings)).toBe(false);
    }
  });

  it('keeps an unset button hidden when the other button is explicitly shown', () => {
    expect(shouldShowMediaDownloadButton('audio', { hideVideoDownloadButton: false })).toBe(false);
    expect(shouldShowMediaDownloadButton('video', { hideAudioDownloadButton: false })).toBe(false);
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('controls audio and video independently (hide video: %s, hide audio: %s)', (hideVideoDownloadButton, hideAudioDownloadButton) => {
    const settings = { hideVideoDownloadButton, hideAudioDownloadButton };
    expect(shouldShowMediaDownloadButton('video', settings)).toBe(!hideVideoDownloadButton);
    expect(shouldShowMediaDownloadButton('audio', settings)).toBe(!hideAudioDownloadButton);
  });
});
