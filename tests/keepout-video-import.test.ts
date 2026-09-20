import { describe, expect, it } from 'vitest';
import { validateKeepoutVideoRequest, videoTypeFromPrefix } from '../native-host/keepout-video-import.mjs';

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
});
