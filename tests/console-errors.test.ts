import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  formatConsoleArg,
  normalizeConsoleEntries,
  normalizeConsoleEntry,
  shouldCaptureConsoleEntry
} from "../src/lib/console-errors"

describe("console error filtering", () => {
  it("keeps page-error capture from monkey-patching console or reusing the stale entry URL", () => {
    const source = readFileSync("src/contents/page-errors.ts", "utf-8")
    const background = readFileSync("src/background.ts", "utf-8")

    expect(existsSync("src/contents/error-capture.ts")).toBe(false)
    expect(source).not.toContain("console.error =")
    expect(source).not.toContain("console.warn =")
    expect(source).toContain("unhandledrejection")
    expect(background).toContain("reloadTabsOnceForStaleErrorCapture")
    expect(background).toContain("maintenance.errorCaptureCleanup.v1")
    expect(background).toContain("chrome.tabs.reload")
  })

  it("drops generated Parcel bundle payloads from the page-error feed", () => {
    const message =
      'var e,n;"function"==typeof(e=globalThis.define)&&(n=e,e=null),' +
      'function(n,t,o,r,i){function f(e,t){f.isParcelRequire=!0}}' +
      '{"@parcel/transformer-js/src/esmodule-helpers.js":"cHUbl"}' +
      'chrome.runtime.sendMessage({type:"PAGE_ERRORS"})'

    expect(shouldCaptureConsoleEntry({ message, source: "https://example.com" })).toBe(false)
    expect(normalizeConsoleEntry({ level: "error", message, source: "https://example.com" })).toBeNull()
  })

  it("drops errors sourced from generated extension content-script bundles", () => {
    expect(
      shouldCaptureConsoleEntry({
        message: "Cannot find module 'x'",
        source: "chrome-extension://abc/error-capture.25b8aaa0.js"
      })
    ).toBe(false)

    expect(
      shouldCaptureConsoleEntry({
        message: "Cannot find module 'x'",
        source: "chrome-extension://abc/page-errors.c9828773.js"
      })
    ).toBe(false)
  })

  it("sanitizes stale generated bundle rows before returning cached inspector errors", () => {
    const generatedBundle =
      'var e,n;"function"==typeof(e=globalThis.define)&&(n=e,e=null),' +
      'function(n,t,o,r,i){function f(e,t){f.isParcelRequire=!0}}' +
      '{"@parcel/transformer-js/src/esmodule-helpers.js":"cHUbl"}' +
      'chrome.runtime.sendMessage({type:"PAGE_ERRORS"})'

    const entries = normalizeConsoleEntries([
      { level: "error", message: generatedBundle, source: "https://example.com" },
      { level: "warning", message: "A real page warning", source: "https://example.com/app.js" }
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0]?.message).toBe("A real page warning")
  })

  it("formats non-string console args without throwing", () => {
    expect(formatConsoleArg("plain")).toBe("plain")
    expect(formatConsoleArg({ ok: true })).toBe('{"ok":true}')

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(formatConsoleArg(circular)).toBe("[object Object]")
  })
})
