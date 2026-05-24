import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("recorder section UI", () => {
  it("starts active-tab recording from the single start button", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/recorder/RecorderSection.tsx"),
      "utf8",
    );

    expect(source).toMatch(
      /chrome\.windows\.getLastFocused\(\{\s*windowTypes: \["normal"\],\s*\}\)/,
    );
    expect(source).toContain(
      "chrome.tabs.query({ active: true, windowId: win.id })",
    );
    expect(source).toContain('source: "tab"');
    expect(source).toContain("tabId: tab.id");
    expect(source).toContain('lastError: "No active tab"');
    expect(source).not.toContain("currentWindow: true");
    expect(source).not.toContain('source: "screen"');
    expect(source).not.toContain("RECORDER_START_OPTIONS");
    expect(source).not.toContain("What do you want to record?");
  });

  it("starts toolbar popup recording from the Brave desktop picker", () => {
    const source = readFileSync(join(process.cwd(), "src/popup.tsx"), "utf8");

    expect(source).toContain("chooseDesktopMediaStream");
    expect(source).toContain("streamId: selected.streamId");
    expect(source).toContain("desktopAudio: selected.desktopAudio");
    expect(source).toContain("chrome.runtime.lastError?.message");
    expect(source).toContain("!response?.ok");
    expect(source).toMatch(/>\s*Record\s*<\/button>/);
    expect(source).not.toContain(">Record Tab<");
  });

  it("declares desktop capture for the Brave picker", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.permissions).toContain("desktopCapture");
  });
});
