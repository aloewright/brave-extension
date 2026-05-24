import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("terminal native-host keepalive", () => {
  it("retains the offscreen document while PTY sessions are active", () => {
    const background = source("src/background.ts");

    expect(background).toContain("retainOffscreenDocument");
    expect(background).toContain("releaseOffscreenDocument");
    expect(background).toContain('retainOffscreenDocument("terminal-keepalive")');
    expect(background).toContain('releaseOffscreenDocument("terminal-keepalive")');
    expect(background).toContain('port.name === "terminal-keepalive"');
    expect(background).toContain("activePtySessions.size > 0");
    expect(background).toContain("startTerminalKeepAlive");
    expect(background).toContain("stopTerminalKeepAlive");
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
    expect(manager).toContain('"USER_MEDIA", "DISPLAY_MEDIA", "BLOBS", "WORKERS"');
  });
});
