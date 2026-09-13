import { expect, chromium, test, type BrowserContext } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

test('download buttons are hidden by default and can be enabled independently from the top of Settings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'media-download-settings-test-'));
  const profile = join(root, 'profile');
  const build = realpathSync(resolve(process.env.MEDIA_TEST_BUILD_PATH || 'build'));
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<html><head><title>Media download settings test</title></head><body><video controls width="640"></video></body></html>');
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
    const pageErrors: string[] = [];
    const consoleMessages: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push(message.text());
      }
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await expect(page).toHaveTitle('Media download settings test');
    await page.locator('video').hover();

    const videoButton = page.getByRole('button', { name: 'Download video', exact: true, includeHidden: true });
    const audioButton = page.getByRole('button', { name: 'Download audio', exact: true, includeHidden: true });
    await expect(videoButton).toBeAttached();
    await expect(audioButton).toBeAttached();
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeHidden();
    await expect(page.locator('.bar')).toBeHidden();

    const settingsPage = await context.newPage();
    settingsPage.on('pageerror', (error) => pageErrors.push(error.message));
    settingsPage.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleMessages.push(message.text());
      }
    });
    const extensionId = new URL(worker.url()).host;
    await settingsPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(settingsPage).toHaveURL(`chrome-extension://${extensionId}/sidepanel.html`);
    await settingsPage.getByRole('button', { name: 'Settings', exact: true }).click();
    const topSection = settingsPage.locator('main details').first();
    await expect(topSection.locator('summary')).toContainText('Download buttons');
    await expect(topSection).toHaveAttribute('open', '');
    const hideVideo = topSection.getByRole('checkbox', { name: 'Hide Download video button', exact: true });
    const hideAudio = topSection.getByRole('checkbox', { name: 'Hide Download audio button', exact: true });
    await expect(hideVideo).toBeChecked();
    await expect(hideAudio).toBeChecked();
    await expect(settingsPage.locator('vite-error-overlay')).toHaveCount(0);

    for (const width of [1024, 420]) {
      await settingsPage.setViewportSize({ width, height: 800 });
      await expect(topSection).toBeInViewport();
      await expect(hideVideo.locator('..')).toBeInViewport();
      await expect(hideAudio.locator('..')).toBeInViewport();
      if (process.env.MEDIA_TEST_SCREENSHOT_DIR) {
        await settingsPage.screenshot({ path: join(process.env.MEDIA_TEST_SCREENSHOT_DIR, `download-settings-${width}.png`) });
      }
    }

    await hideVideo.locator('..').click();
    await expect(hideVideo).not.toBeChecked();
    await expect(hideAudio).toBeChecked();
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeHidden();

    await page.reload();
    await page.locator('video').hover();
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeHidden();

    await settingsPage.reload();
    await expect(hideVideo).not.toBeChecked();
    await expect(hideAudio).toBeChecked();
    await hideAudio.locator('..').click();
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeVisible();

    await hideVideo.locator('..').click();
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeVisible();

    await hideAudio.locator('..').click();
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeHidden();
    await expect(page.locator('.bar')).toBeHidden();

    // Legacy partial settings must not opt the missing button back in.
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ 'ai-dev-settings': { hideAudioDownloadButton: false } });
    });
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeVisible();

    await worker.evaluate(async () => {
      await chrome.storage.local.set({
        'ai-dev-settings': { hideVideoDownloadButton: false },
      });
    });
    await expect(videoButton).toBeVisible();
    await expect(audioButton).toBeHidden();

    await worker.evaluate(async () => {
      await chrome.storage.local.remove('ai-dev-settings');
    });
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeHidden();
    await expect(page.locator('.bar')).toBeHidden();
    await page.reload();
    await page.locator('video').hover();
    await expect(videoButton).toBeAttached();
    await expect(videoButton).toBeHidden();
    await expect(audioButton).toBeHidden();
    expect(pageErrors).toEqual([]);
    console.info('Media settings browser console:', [...new Set(consoleMessages)]);
  } finally {
    await context?.close();
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
    rmSync(root, { recursive: true, force: true });
  }
});
