import { expect, test } from "./_fixtures";
import * as os from "node:os";
import * as path from "node:path";

type PanelMessage = {
  type?: string;
  captureID?: string | null;
  videoID?: string;
  captureId?: string | null;
  videoId?: string;
  title?: string;
  marginNote?: string;
};

const captureID = "00000000-0000-4000-8000-000000000001";
const directVideoID = "00000000-0000-4000-8000-000000000002";
const failedVideoID = "00000000-0000-4000-8000-000000000003";

test("Canvas video panel keeps downloads outside Keepout and tracks each video independently", async ({
  context,
  extensionId,
}) => {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 740 });
  const errors: string[] = [];
  panel.on('pageerror', error => errors.push(error.message));
  await panel.addInitScript(({ captureID, directVideoID, failedVideoID }) => {
    const messages: PanelMessage[] = [];
    let directStatusChecks = 0;
    let encryptedStatusChecks = 0;
    Object.defineProperty(window, "__canvasVideoPanelMessages", { value: messages });
    Object.defineProperty(window, "__canvasVideoPanelXSS", { value: false, writable: true });
    (window as Window & typeof globalThis & { markCanvasVideoPanelXSS: () => void }).markCanvasVideoPanelXSS = () => {
      (window as Window & typeof globalThis & { __canvasVideoPanelXSS: boolean }).__canvasVideoPanelXSS = true;
    };
    chrome.runtime.sendMessage = async (message: PanelMessage) => {
      messages.push(structuredClone(message));
      if (message.type === "keepout/draft") {
        return {
          ok: true,
          capture: {
            version: 1,
            id: captureID,
            title: "Canvas lesson",
            sourceUrl: "https://canvas.example.edu/courses/42/pages/lesson",
            markdown: "# Canvas lesson",
            images: [],
            videos: [
              { id: directVideoID, title: "Lecture recording", kind: "direct" },
              {
                id: failedVideoID,
                title: '<img src=x onerror="markCanvasVideoPanelXSS()">Unsafe title',
                kind: "vimeo",
              },
            ],
          },
        };
      }
      if (message.type === "keepout/page-capture") return { ok: true };
      if (message.type === "keepout/video-import") {
        if (message.videoId === failedVideoID) return { ok: false, error: "Keepout could not save this video." };
        return { ok: true, state: "saving" };
      }
      if (message.type === "keepout/video-import-status") {
        encryptedStatusChecks += 1;
        return encryptedStatusChecks < 2
          ? { ok: true, state: "saving", bytes: 1_024 }
          : { ok: true, state: "complete", bytes: 2_048 };
      }
      if (message.type === "keepout/video-download") {
        if (message.videoID === failedVideoID) return { ok: false, error: "Canvas refused this video." };
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { ok: true, state: "started", downloadId: 17 };
      }
      if (message.type === "keepout/video-status") {
        directStatusChecks += 1;
        return directStatusChecks < 2
          ? { ok: true, state: "started", downloadId: 17 }
          : { ok: true, state: "complete", filename: "Lecture recording.mp4" };
      }
      return { ok: true };
    };
  }, { captureID, directVideoID, failedVideoID });

  await panel.goto(`chrome-extension://${extensionId}/capture.html?capture=${captureID}`);
  await expect(panel.getByRole("heading", { name: "Save Canvas page to Keepout" })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Videos" })).toBeVisible();
  await expect(panel.getByText("Save in Keepout encrypts and embeds the video in this note", { exact: false })).toBeVisible();
  await expect(panel.locator(".video-title").nth(0)).toHaveText("Lecture recording");
  await expect(panel.locator(".video-title").nth(1)).toHaveText('<img src=x onerror="markCanvasVideoPanelXSS()">Unsafe title');
  await expect(panel.locator(".video-title img")).toHaveCount(0);
  await expect.poll(() => panel.evaluate(() => (window as Window & typeof globalThis & { __canvasVideoPanelXSS: boolean }).__canvasVideoPanelXSS)).toBe(false);

  await panel.getByLabel("Note title").fill("Saved with encrypted lecture");
  await panel.getByLabel("Margin note").fill("Current margin note");
  await panel.locator(".videos li").nth(0).getByRole("button", { name: "Save in Keepout" }).click();
  await expect(panel.locator(".videos li").nth(0).locator("output").first()).toHaveText(/Saving encrypted video/i);
  await expect.poll(() => panel.evaluate(() => (window as Window & typeof globalThis & { __canvasVideoPanelMessages: PanelMessage[] }).__canvasVideoPanelMessages.filter((message) => message.type === "keepout/video-import"))).toEqual([
    {
      type: "keepout/video-import",
      captureId: captureID,
      videoId: directVideoID,
      title: "Saved with encrypted lecture",
      marginNote: "Current margin note",
    },
  ]);
  await expect(panel.locator(".videos li").nth(0).locator("output").first()).toHaveText(/Saved in Keepout.*2,048 bytes encrypted/i, { timeout: 6_000 });
  await expect(panel.locator(".videos li").nth(0).getByRole("button", { name: "Saved in Keepout" })).toBeDisabled();

  await panel.locator(".videos li").nth(0).getByRole("button", { name: "Download video" }).click();
  await expect(panel.locator(".videos li").nth(0).locator("output")).toHaveText("Starting download…");
  await expect(panel.locator(".videos li").nth(0).getByRole("button", { name: "Download started" })).toBeDisabled();
  await expect(panel.locator(".videos li").nth(0).locator("output")).toHaveText(/download started/i);
  await expect.poll(() => panel.evaluate(() => (window as Window & typeof globalThis & { __canvasVideoPanelMessages: PanelMessage[] }).__canvasVideoPanelMessages.filter((message) => message.type === "keepout/video-download"))).toEqual([
    { type: "keepout/video-download", captureID, videoID: directVideoID },
  ]);

  // Saving the note does not cancel, await, or otherwise alter an in-progress
  // browser download. The native handler owns that state after it starts.
  await panel.getByRole("button", { name: "Save to Keepout", exact: true }).click();
  await expect(panel.locator("form > output")).toHaveText(/Saved to Keepout · Canvas page/i);

  await expect(panel.locator(".videos li").nth(0).locator("output")).toHaveText(/Lecture recording\.mp4 downloaded\./i, { timeout: 6_000 });
  await expect(panel.locator(".videos li").nth(0).getByRole("button", { name: "Downloaded" })).toBeDisabled();

  await panel.locator(".videos li").nth(1).getByRole("button", { name: "Download video" }).click();
  await expect(panel.locator(".videos li").nth(1).locator("output")).toHaveText("Canvas refused this video.");
  await expect(panel.locator(".videos li").nth(1).getByRole("button", { name: "Retry download" })).toBeEnabled();
  await panel.locator(".videos li").nth(1).getByRole("button", { name: "Save in Keepout" }).click();
  await expect(panel.locator(".videos li").nth(1).locator("output").first()).toHaveText("Keepout could not save this video.");
  await expect(panel.locator(".videos li").nth(1).getByRole("button", { name: "Retry encrypted save" })).toBeEnabled();
  expect(errors).toEqual([]);

  await panel.screenshot({
    path: path.join(os.tmpdir(), "canvas-video-panel-e2e.png"),
    fullPage: true,
  });
});
