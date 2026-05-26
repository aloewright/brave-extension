import { beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react-dom/test-utils"
import {
  EYEDROPPER_SAVED_COLORS_KEY,
  EYEDROPPER_SAVED_COLORS_LIMIT,
  getSavedColors,
  savePickedColor
} from "../src/lib/eyedropper"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderEyedropperSection() {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const { EyedropperSection } = await import("../src/sections/eyedropper/EyedropperSection")
  const host = document.createElement("div")
  document.body.append(host)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(host)
    root.render(<EyedropperSection />)
  })
  return {
    host,
    cleanup: () => {
      act(() => root?.unmount())
      host.remove()
    }
  }
}

beforeEach(async () => {
  await chrome.storage.local.clear()
  vi.restoreAllMocks()
  delete (window as typeof window & { EyeDropper?: unknown }).EyeDropper
  delete (navigator as Navigator & { clipboard?: unknown }).clipboard
})

describe("eyedropper saved colors", () => {
  it("stores picked colors newest-first without duplicating the same hex", async () => {
    await savePickedColor("#336699")
    await savePickedColor("rgb(51, 102, 153)")
    await savePickedColor("#ff0000")

    const saved = await getSavedColors()
    expect(saved).toHaveLength(2)
    expect(saved[0]?.hex).toBe("#ff0000")
    expect(saved[1]?.hex).toBe("#336699")

    const dump = await chrome.storage.local.get(EYEDROPPER_SAVED_COLORS_KEY)
    expect((dump[EYEDROPPER_SAVED_COLORS_KEY] as unknown[]).length).toBe(2)
  })

  it("caps the saved color history", async () => {
    for (let i = 0; i < EYEDROPPER_SAVED_COLORS_LIMIT + 4; i += 1) {
      await savePickedColor(`#${(i + 10).toString(16).padStart(6, "0")}`)
    }

    expect(await getSavedColors()).toHaveLength(EYEDROPPER_SAVED_COLORS_LIMIT)
  })
})

describe("EyedropperSection", () => {
  it("saves a picked color into a compact card with values and copy action", async () => {
    const clipboard = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard }
    })

    class MockEyeDropper {
      open = vi.fn(async () => ({ sRGBHex: "#336699" }))
    }

    Object.defineProperty(window, "EyeDropper", {
      configurable: true,
      value: MockEyeDropper
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickButton = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.includes("Pick Color")
      )
      expect(pickButton).toBeTruthy()

      await act(async () => {
        pickButton?.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      const cards = host.querySelectorAll('[data-testid="saved-color-card"]')
      expect(cards).toHaveLength(1)

      const card = cards[0] as HTMLElement
      expect(card.textContent).toContain("#336699")
      expect(card.textContent).toContain("rgb(51, 102, 153)")
      expect(card.textContent).toContain("hsl(")
      expect(card.textContent).toContain("oklch(")

      const copyButton = Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "Copy"
      )
      expect(copyButton).toBeTruthy()

      await act(async () => {
        copyButton?.click()
        await Promise.resolve()
      })

      expect(clipboard).toHaveBeenCalledWith("#336699")
      expect(await getSavedColors()).toHaveLength(1)
    } finally {
      cleanup()
    }
  })
})
