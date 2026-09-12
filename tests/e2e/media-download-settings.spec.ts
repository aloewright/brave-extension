import { expect, chromium, test, type BrowserContext } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('audio and video download visibility updates independently and persists across reloads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'media-download-settings-test-'));
  const profile = join(root, 'profile');
  const build = realpathSync(resolve(process.env.MEDIA_TEST_BUILD_PATH || 'build'));
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<html><body><video controls width="640"></video></body></html>');
  });
  await new Promise<void>((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
  const address = server.address() as { port: number };
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      timeout: 30_000,
      ...(process.env.MEDIA_TEST_BROWSER_EXECUTABLE
        ? { executablePath: process.env.MEDIA_TEST_BROWSER_EXECUTABLE }
        : { channel: 'chromium' }),
      args: [`--disable-extensions-except=${build}`, `--load-extension=${build}`],
    });
    const worker = context.serviceWorkers()[0]
      || await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.locator('video').hover();

    const videoButton = page.getByRole('button', { name: 'Download video', exact: true });
    const audioButton = page.getByRole('button', { name: 'Download audio', exact: true });
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeVisible();

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ 'ai-dev-settings': { hideAudioDownloadButton: true } });
    });
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeHidden();

    await page.reload();
    await page.locator('video').hover();
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeHidden();

    await worker.evaluate(async () => {
      await chrome.storage.local.set({ 'ai-dev-settings': { hideVideoDownloadButton: true } });
    });
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeVisible();

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        'ai-dev-settings': { hideVideoDownloadButton: true, hideAudioDownloadButton: true },
      });
    });
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeHidden();
    await expect(page.locator('.bar')).toBeHidden();

    await worker.evaluate(async () => {
      await chrome.storage.local.remove('ai-dev-settings');
    });
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeVisible();
  } finally {
    await context?.close();
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    rmSync(root, { recursive: true, force: true });
  }
});
