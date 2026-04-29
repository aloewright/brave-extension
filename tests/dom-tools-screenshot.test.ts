import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// MCP image content blocks expect raw base64 in `data` (no `data:` prefix).
// These tests pin the screenshot tools to that contract — regressing back
// to data URLs would silently break image rendering on the MCP client side.

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEX///+nxBvIAAAACklEQVQI12NgAAAAAgABc3UBGAAAAABJRU5ErkJggg=="
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`

beforeEach(() => {
  ;(globalThis as any).chrome = {
    ...(globalThis as any).chrome,
    tabs: {
      query: vi.fn(async () => [{ id: 42, url: "https://example.com", windowId: 7 }]),
      get: vi.fn(async (_id: number) => ({ id: 42, windowId: 7, url: "https://example.com" })),
      captureVisibleTab: vi.fn(async () => PNG_DATA_URL)
    },
    scripting: {
      executeScript: vi.fn(async ({ func, args }: any) => {
        // Simulate the injected function running. screenshot_element's
        // injected fn must be SYNCHRONOUS — if it's async, executeScript
        // would resolve to undefined in the real runtime. Detect that here.
        const value = (func as any).apply(null, args || [])
        if (value && typeof (value as any).then === "function") {
          throw new Error("injected func returned a Promise — chrome.scripting won't await it")
        }
        return [{ result: value }]
      })
    }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("dom-tools screenshot returns raw base64", () => {
  it("screenshot strips the data: prefix", async () => {
    const { DOM_TOOL_HANDLERS } = await import("../src/background/dom-tools")
    const result = await DOM_TOOL_HANDLERS.screenshot({ tabId: 42, format: "png" })
    expect(result.isError).toBeFalsy()
    const block = result.content[0]
    expect(block.type).toBe("image")
    expect(block.data).toBe(PNG_B64)
    expect(block.data?.startsWith("data:")).toBe(false)
    expect(block.mimeType).toBe("image/png")
  })

  it("screenshot_element injected func is synchronous (no Promise leak)", async () => {
    const { DOM_TOOL_HANDLERS } = await import("../src/background/dom-tools")
    // Stub the DOM querying executeScript call by intercepting before
    // cropScreenshot runs (cropScreenshot needs OffscreenCanvas which
    // happy-dom doesn't fully implement). We replace executeScript so the
    // first call returns rect info synchronously and we throw if async.
    const exec = (globalThis as any).chrome.scripting.executeScript as ReturnType<typeof vi.fn>
    exec.mockImplementationOnce(async ({ func, args }: any) => {
      const value = (func as any).apply(null, args || [])
      if (value && typeof (value as any).then === "function") {
        throw new Error("injected func returned a Promise")
      }
      // Return a fake non-null rect so the handler proceeds.
      return [{ result: { x: 0, y: 0, w: 1, h: 1, dpr: 1 } }]
    })
    // Once we get past the injected-func check, cropScreenshot will be
    // called and may fail in happy-dom — that's fine; the test's purpose is
    // to assert the injected function is sync. Surface the error if it
    // wasn't a Promise-leak.
    const result = await DOM_TOOL_HANDLERS.screenshot_element({ tabId: 42, selector: "div" })
    if (result.isError) {
      // Crop failures are OK; only Promise-leak failures are not.
      expect(result.content[0].text).not.toMatch(/Promise/)
    } else {
      expect(result.content[0].data?.startsWith("data:")).toBe(false)
    }
  })
})

describe("stripDataUrl helper", () => {
  it("splits a base64 data URL into mime + payload", async () => {
    const { stripDataUrl } = await import("../src/lib/screenshot")
    expect(stripDataUrl(PNG_DATA_URL)).toEqual({ base64: PNG_B64, mimeType: "image/png" })
  })

  it("handles a jpeg data URL", async () => {
    const { stripDataUrl } = await import("../src/lib/screenshot")
    expect(stripDataUrl("data:image/jpeg;base64,abc")).toEqual({
      base64: "abc",
      mimeType: "image/jpeg"
    })
  })
})
