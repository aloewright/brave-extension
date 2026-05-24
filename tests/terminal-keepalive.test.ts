import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("terminal native-host keepalive", () => {
  it("retains the offscreen document for normal browser window lifetime", () => {
    const background = source("src/background.ts");

    expect(background).toContain("retainOffscreenDocument");
    expect(background).toContain("releaseOffscreenDocument");
    expect(background).toContain('retainOffscreenDocument("terminal-keepalive")');
    expect(background).toContain('releaseOffscreenDocument("terminal-keepalive")');
    expect(background).toContain('port.name === "terminal-keepalive"');
    expect(background).toContain("normalBrowserWindowIds");
    expect(background).toContain('chrome.windows?.onCreated?.addListener');
    expect(background).toContain('chrome.windows?.onRemoved?.addListener');
    expect(background).toContain('windowTypes: ["normal"]');
    expect(background).toContain("startTerminalKeepAlive");
    expect(background).toContain("stopTerminalKeepAlive");
  });

  it("does not gate offscreen pings on a mounted sidebar or active PTY count", () => {
    const background = source("src/background.ts");

    expect(background).toContain("shouldKeepNativeHostAlive");
    expect(background).toContain("pingNativeHost");
    expect(background).not.toContain("if (activePtySessions.size === 0) return;");
    expect(background).not.toContain("if (sidebarPorts.size === 0) return;");
  });

  it("keeps a runtime port from the offscreen document to the service worker", () => {
    const offscreen = source("src/tabs/offscreen.tsx");

    expect(offscreen).toContain('TERMINAL_KEEPALIVE_START');
    expect(offscreen).toContain('TERMINAL_KEEPALIVE_STOP');
    expect(offscreen).toContain('TERMINAL_KEEPALIVE_PORT_NAME = "terminal-keepalive"');
    expect(offscreen).toContain("chrome.runtime.connect");
    expect(offscreen).toContain("terminal-keepalive-ping");
    expect(offscreen).toContain("TERMINAL_KEEPALIVE_INTERVAL_MS = 15_000");
  });

  it("shares offscreen lifecycle with recorder instead of force-closing it", () => {
    const recorder = source("src/background/recorder.ts");
    const manager = source("src/background/offscreen.ts");

    expect(recorder).toContain('retainOffscreenDocument("recorder")');
    expect(recorder).toContain('releaseOffscreenDocument("recorder")');
    expect(recorder).not.toContain("chrome.offscreen.closeDocument()");
    expect(manager).toContain("activeUses.size > 0");
    expect(manager).toContain("activeUses.delete(use)");
    expect(manager).toContain('"USER_MEDIA", "DISPLAY_MEDIA", "BLOBS", "WORKERS"');
  });

  it("rolls back failed offscreen retain calls before later release checks", async () => {
    vi.resetModules();
    const chromeMock = (globalThis as any).chrome;
    const originalRuntime = chromeMock.runtime;
    const originalOffscreen = chromeMock.offscreen;
    const closeDocument = vi.fn(async () => undefined);

    chromeMock.runtime = {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ documentUrl: "tabs/offscreen.html" }]),
    };
    chromeMock.offscreen = {
      createDocument: vi
        .fn()
        .mockRejectedValueOnce(new Error("startup race"))
        .mockResolvedValueOnce(undefined),
      closeDocument,
    };

    try {
      const {
        retainOffscreenDocument,
        releaseOffscreenDocument,
      } = await import("../src/background/offscreen");

      await expect(
        retainOffscreenDocument("terminal-keepalive"),
      ).rejects.toThrow("startup race");
      await retainOffscreenDocument("recorder");
      await releaseOffscreenDocument("recorder");

      expect(closeDocument).toHaveBeenCalledTimes(1);
    } finally {
      chromeMock.runtime = originalRuntime;
      chromeMock.offscreen = originalOffscreen;
    }
  });
});
