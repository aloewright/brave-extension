import { test, expect, chromium } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

test('one click saves a video and extracts MP3 through the native helper', async () => {
  test.setTimeout(90000);
  const root = mkdtempSync(join(tmpdir(), 'media-download-test-'));
  const profile = join(root, 'profile');
  const build = realpathSync(resolve(process.env.MEDIA_TEST_BUILD_PATH || 'build'));
  const id = createHash('sha256').update(build).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + parseInt(digit, 16)));
  const stem = `media-test-${randomUUID()}`;
  const savedFiles: string[] = [];
  const video = join(root, `${stem}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
  const nm = join(profile, 'NativeMessagingHosts');
  mkdirSync(nm, { recursive: true });
  const wrapper = join(root, 'host.sh');
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  writeFileSync(wrapper, `#!/bin/sh\nexport PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'\nexec ${quote(process.execPath)} ${quote(resolve('native-host/media-download-host.mjs'))}\n`, { mode: 0o700 });
  writeFileSync(join(nm, 'com.aidev.media_download.json'), JSON.stringify({ name: 'com.aidev.media_download', description: 'Test helper', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] }));
  const server = createServer((req, res) => {
    if (req.url?.endsWith('.mp4')) { res.setHeader('Content-Type', 'video/mp4'); res.end(readFileSync(video)); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(`<html><title>Media download test</title><body><video controls width="640" src="/${stem}.mp4"></video></body></html>`); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    timeout: 15000,
    ...(process.env.MEDIA_TEST_BROWSER_EXECUTABLE
      ? { executablePath: process.env.MEDIA_TEST_BROWSER_EXECUTABLE }
      : { channel: 'chromium' }),
    args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
  });
  try {
    const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    expect(sw.url()).toContain(id);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.locator('video').hover();

    for (const mode of ['video', 'audio']) {
      await page.getByRole('button', { name: `Download ${mode}`, exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Saved to Downloads:', { timeout: 30000 });
      const filename = (await page.getByRole('status').innerText()).replace('Saved to Downloads: ', '');
      savedFiles.push(join(homedir(), 'Downloads', filename));
      const streams = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', join(homedir(), 'Downloads', filename)], { encoding: 'utf8' })).streams;
      expect(streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
      expect(streams.some((s: { codec_type: string }) => s.codec_type === 'video')).toBe(mode === 'video');
      if (mode === 'audio') expect(filename).toMatch(/\.mp3$/);
    }
  } finally {
    await context.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const filename of savedFiles) rmSync(filename, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
