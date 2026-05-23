import { describe, expect, it, vi } from "vitest"
import {
  captureErrorMessage,
  captureVisibleOrPromptedScreenshot,
  isActiveTabCaptureError
} from "../src/lib/screenshot-capture"

describe("screenshot capture fallback", () => {
  it("uses captureVisibleTab when the active tab grant is available", async () => {
    const captureVisibleTab = vi.fn(async () => "data:image/png;base64,visible")
    const captureDesktopFrame = vi.fn(async () => "data:image/png;base64,picker")

    const result = await captureVisibleOrPromptedScreenshot(7, {
      captureVisibleTab,
      captureDesktopFrame
    })

    expect(result).toEqual({
      dataUrl: "data:image/png;base64,visible",
      source: "visible-tab"
    })
    expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: "png" })
    expect(captureDesktopFrame).not.toHaveBeenCalled()
  })

  it("falls back to display picker capture when activeTab is not in effect", async () => {
    const captureVisibleTab = vi.fn(async () => {
      throw new Error(
        "The 'activeTab' permission is not in effect because this extension has not been in invoked."
      )
    })
    const captureDesktopFrame = vi.fn(async () => "data:image/png;base64,picker")
    const onFallback = vi.fn()

    const result = await captureVisibleOrPromptedScreenshot(7, {
      captureVisibleTab,
      captureDesktopFrame,
      onFallback
    })

    expect(result).toEqual({
      dataUrl: "data:image/png;base64,picker",
      source: "display-picker"
    })
    expect(onFallback).toHaveBeenCalledOnce()
    expect(captureDesktopFrame).toHaveBeenCalledOnce()
  })

  it("does not hide non-permission capture failures", async () => {
    const captureVisibleTab = vi.fn(async () => {
      throw new Error("tab has no window")
    })
    const captureDesktopFrame = vi.fn(async () => "data:image/png;base64,picker")

    await expect(
      captureVisibleOrPromptedScreenshot(7, {
        captureVisibleTab,
        captureDesktopFrame
      })
    ).rejects.toThrow("tab has no window")
    expect(captureDesktopFrame).not.toHaveBeenCalled()
  })

  it("normalizes activeTab and picker cancellation messages", () => {
    expect(
      isActiveTabCaptureError(
        new Error("Extension has not been invoked for the current page")
      )
    ).toBe(true)
    expect(captureErrorMessage(new Error("activeTab is not in effect"))).toBe(
      "Choose a tab or window to capture"
    )
    expect(captureErrorMessage(new DOMException("cancelled", "AbortError"))).toBe(
      "Screenshot cancelled"
    )
  })
})
