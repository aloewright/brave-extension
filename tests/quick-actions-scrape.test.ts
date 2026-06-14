import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/lib/screenshot-capture", () => ({
  captureErrorMessage: (err: unknown) => err instanceof Error ? err.message : String(err),
  captureVisibleOrPromptedScreenshot: vi.fn()
}))
vi.mock("../src/lib/pip/coord", () => ({ triggerPipInTab: vi.fn() }))
vi.mock("../src/lib/pip/protocol", () => ({ PIP_NO_CONTENT_SCRIPT_REASON: "no-content-script" }))
vi.mock("../src/storage", () => ({ getSettings: vi.fn(async () => ({})) }))
vi.mock("../src/lib/capture-destination", () => ({
  describeCaptureDestination: () => "Saved to Downloads",
  resolveCaptureDestination: vi.fn()
}))
vi.mock("../src/lib/capture-upload", () => ({
  CaptureUploadError: class extends Error {
    status = 500
  },
  dataUrlToBlob: vi.fn(),
  uploadCapture: vi.fn()
}))
vi.mock("../src/lib/ai-rename", () => ({ suggestMediaFilename: vi.fn() }))
vi.mock("../src/lib/pdf-capture", () => ({
  base64ToBytes: vi.fn(),
  captureFullPagePdf: vi.fn()
}))

import { runScrapeCurrentPageQuickAction } from "../src/lib/quick-actions"

describe("runScrapeCurrentPageQuickAction", () => {
  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
      tabs: {
        query: vi.fn(async () => [{ id: 42, url: "https://example.com/post", title: "Example" }])
      },
      runtime: {
        lastError: undefined,
        sendMessage: vi.fn((message, callback) => {
          callback({
            url: "https://example.com/post",
            title: "Example",
            text: "one two three",
            html: "<main>one two three</main>",
            links: [],
            images: [],
            meta: {},
            timestamp: Date.now()
          })
        })
      }
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete (globalThis as { chrome?: unknown }).chrome
  })

  it("asks the background worker to scrape the active tab", async () => {
    const result = await runScrapeCurrentPageQuickAction()

    expect(result).toEqual({ kind: "success", message: "Scraped 3 words" })
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: "SCRAPE_TAB", tabId: 42 },
      expect.any(Function)
    )
  })

  it("does not try to scrape browser-internal pages", async () => {
    ;(globalThis as any).chrome.tabs.query = vi.fn(async () => [
      { id: 42, url: "chrome://extensions", title: "Extensions" }
    ])

    await expect(runScrapeCurrentPageQuickAction()).resolves.toEqual({
      kind: "error",
      message: "Cannot scrape browser-internal pages"
    })
    expect(globalThis.chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })
})
