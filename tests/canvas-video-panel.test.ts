import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/capture.ts", "utf8");

describe("Canvas video download panel", () => {
  it("keeps video URLs out of the panel contract and sends only the selected IDs", () => {
    expect(source).toContain('videos?: Array<{ id: string; title: string; kind: "direct" | "canvas-file" | "vimeo" }>');
    expect(source).not.toMatch(/video\.(?:url|sourceUrl|canvasFileId)/);
    expect(source).toContain('type: "keepout/video-download"');
    expect(source).toContain("captureID,");
    expect(source).toContain("videoID: video.id,");
  });

  it("renders untrusted titles as text and retains independent download state", () => {
    expect(source).toContain("videoTitle.textContent = video.title;");
    expect(source).toContain("videoList.replaceChildren();");
    expect(source).toContain('type: "keepout/video-status"');
    expect(source).toContain("}, 1_500);");
    expect(source).toContain("clearVideoDownloadTimers();");
    expect(source).toContain("Downloads remain unencrypted");
    expect(source).toContain("Save in Keepout encrypts and embeds the video in this note");
  });

  it("saves each selected video through the encrypted import protocol and polls its state", () => {
    expect(source).toContain('type: "keepout/video-import"');
    expect(source).toContain('type: "keepout/video-import-status"');
    expect(source).toContain("captureId: captureID,");
    expect(source).toContain("videoId: video.id,");
    expect(source).toContain("title: title.value.trim(),");
    expect(source).toContain("marginNote: margin.value,");
    expect(source).toContain("Saving page and encrypted video…");
    expect(source).toContain("Saved in Keepout");
    expect(source).toContain("}, 1_500);");
    expect(source).toContain("clearVideoImportTimers();");
  });
});
