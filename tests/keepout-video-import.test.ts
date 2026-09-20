import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupStaleKeepoutVideoDirectories, validateKeepoutVideoRequest, verifiedDownloadedFile, videoTypeFromPrefix } from '../native-host/keepout-video-import.mjs';

const request = {
  mode: 'keepout-video', url: 'https://player.vimeo.com/video/42?h=capability', referer: 'https://canvas.example.edu/courses/1/pages/2',
  id: '00000000-0000-4000-8000-000000000001', captureID: '00000000-0000-4000-8000-000000000002', videoTitle: 'Lecture', connection: { port: 8721, token: 'session-token' },
};

describe('native Keepout video import', () => {
  it('accepts only a bounded web video and loopback-session shape', () => {
    expect(validateKeepoutVideoRequest(request)).toMatchObject({ id: request.id, captureID: request.captureID, title: 'Lecture' });
  });
  it.each([
    { ...request, url: 'file:///private/video.mp4' },
    { ...request, url: 'https://user:secret@video.example/x.mp4' },
    { ...request, referer: 'file:///tmp' },
    { ...request, url: 'http://video.example/lecture.mp4', referer: 'https://canvas.example.edu/course' },
    { ...request, id: 'not-a-uuid' },
    { ...request, connection: { port: 80, token: 'token' } },
    { ...request, connection: { port: 8721, token: 'has space' } },
  ])('rejects unsafe native input', (unsafe) => expect(() => validateKeepoutVideoRequest(unsafe)).toThrow());

  it('requires a 64-byte recognizable video signature before opening an encrypted upload', () => {
    const mp4 = new Uint8Array(64);
    mp4.set(new TextEncoder().encode('ftypisom'), 4);
    expect(videoTypeFromPrefix(mp4)).toBe('video/mp4');
    expect(() => videoTypeFromPrefix(new Uint8Array(63))).toThrow('incomplete');
    expect(() => videoTypeFromPrefix(new Uint8Array(64))).toThrow('recognizable');
  });

  it('accepts only a real regular file below the native temporary root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'keepout-video-test-'));
    const outside = await mkdtemp(join(tmpdir(), 'keepout-video-outside-'));
    try {
      const file = join(root, 'video.mp4');
      await writeFile(file, 'video');
      await expect(verifiedDownloadedFile(root, file)).resolves.toBe(file);
      const link = join(root, 'video-link.mp4');
      await symlink(join(outside, 'video.mp4'), link);
      await expect(verifiedDownloadedFile(root, link)).rejects.toThrow('safe file');
      await expect(verifiedDownloadedFile(root, join(root, '..', 'elsewhere.mp4'))).rejects.toThrow('safe file');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('cleans only stale, marker-owned plaintext roots and leaves a live import alone', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'keepout-video-cleanup-test-'));
    try {
      const stale = join(parent, 'keepout-video-stale');
      const active = join(parent, 'keepout-video-active');
      const legacy = join(parent, 'keepout-video-legacy');
      const malformed = join(parent, 'keepout-video-malformed');
      await mkdir(stale); await mkdir(active); await mkdir(legacy); await mkdir(malformed);
      const old = new Date(Date.now() - 36 * 60_000);
      await writeFile(join(stale, '.keepout-video-owner.json'), JSON.stringify({ pid: 2_147_483_647 }));
      await writeFile(join(active, '.keepout-video-owner.json'), JSON.stringify({ pid: process.pid }));
      await writeFile(join(malformed, '.keepout-video-owner.json'), '{not-json');
      await utimes(join(stale, '.keepout-video-owner.json'), old, old);
      await utimes(join(active, '.keepout-video-owner.json'), old, old);
      await utimes(join(malformed, '.keepout-video-owner.json'), old, old);
      await cleanupStaleKeepoutVideoDirectories({ directory: parent });
      await expect(access(stale)).rejects.toThrow();
      await expect(access(active)).resolves.toBeUndefined();
      await expect(access(legacy)).resolves.toBeUndefined();
      await expect(access(malformed)).resolves.toBeUndefined();
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
