import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const backgroundSource = () =>
  readFileSync(join(process.cwd(), "src/background.ts"), "utf8");

describe("sidepanel toolbar toggle", () => {
  it("toggles from the pinned extension action instead of only opening", () => {
    const source = backgroundSource();

    expect(source).toContain("function toggleSidePanel");
    expect(source).toContain("chrome.sidePanel?.close");
    expect(source).toContain("chrome.action?.onClicked?.addListener((tab) => {");
    expect(source).toContain("toggleSidePanel(tab.windowId)");
  });

  it("keeps sidepanel open and close state in sync with browser events", () => {
    const source = backgroundSource();

    expect(source).toContain("const openSidePanelWindows = new Set<number>()");
    expect(source).toContain("chrome.sidePanel?.onOpened?.addListener");
    expect(source).toContain("chrome.sidePanel?.onClosed?.addListener");
    expect(source).toContain("if (sidebarPorts.size === 0) openSidePanelWindows.clear()");
  });
});
