import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("recorder section UI", () => {
  it("starts active-tab recording from the single start button", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/recorder/RecorderSection.tsx"),
      "utf8",
    );

    expect(source).toContain('chrome.windows.getLastFocused({ windowTypes: ["normal"] })');
    expect(source).toContain("chrome.tabs.query({ active: true, windowId: win.id })");
    expect(source).toContain('source: "tab"');
    expect(source).toContain("tabId: tab.id");
    expect(source).toContain('lastError: "No active tab"');
    expect(source).not.toContain("currentWindow: true");
    expect(source).not.toContain('source: "screen"');
    expect(source).not.toContain("RECORDER_START_OPTIONS");
    expect(source).not.toContain("What do you want to record?");
  });

  it("declares desktop capture for the Brave picker", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.permissions).toContain("desktopCapture");
  });
});
