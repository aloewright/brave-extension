import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MEDIA_DOWNLOAD_HOST } from "../src/lib/media-download";

describe("encrypted video native-host routing", () => {
  it("uses the dedicated media host for Vimeo Keepout imports", () => {
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8");
    expect(MEDIA_DOWNLOAD_HOST).toBe("com.aidev.media_download");
    expect(background).toContain('chrome.runtime.sendNativeMessage(MEDIA_DOWNLOAD_HOST, {');
  });
});
