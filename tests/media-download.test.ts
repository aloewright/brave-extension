import { describe, expect, it } from 'vitest';
import { shouldShowMediaDownloadButton } from '../src/lib/media-download-controls';
import { mediaDownloadUrl } from '../src/lib/media-download';
import { DEFAULT_SETTINGS } from '../src/types';
import { downloadArguments } from '../native-host/media-download.mjs';

describe('one-click media downloads', () => {
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

  it('can hide only the video button through Settings', () => {
    expect(DEFAULT_SETTINGS.hideVideoDownloadButton).toBe(false);
    expect(shouldShowMediaDownloadButton('video', DEFAULT_SETTINGS)).toBe(true);

    const settings = { hideVideoDownloadButton: true };
    expect(shouldShowMediaDownloadButton('video', settings)).toBe(false);
    expect(shouldShowMediaDownloadButton('audio', settings)).toBe(true);
  });

  it('shows the audio button by default, including for existing settings', () => {
    expect(DEFAULT_SETTINGS.hideAudioDownloadButton).toBe(false);
    for (const settings of [DEFAULT_SETTINGS, {}, undefined, null]) {
      expect(shouldShowMediaDownloadButton('audio', settings)).toBe(true);
    }
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
