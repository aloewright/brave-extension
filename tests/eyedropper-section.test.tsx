/**
 * Tests for the EyedropperSection with saved-colors feature.
 *
 * The component imports chrome.storage, getSavedColors, savePickedColor,
 * and renders SavedColorCard. Tests verify pick/copy/display and saved-colors behaviour.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ---------------------------------------------------------------------------
// Helper: render EyedropperSection into a fresh DOM node
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Reset globals before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks()
  delete (window as typeof window & { EyeDropper?: unknown }).EyeDropper
  delete (navigator as Navigator & { clipboard?: unknown }).clipboard
})

// ---------------------------------------------------------------------------
// Structural / source-level checks
// ---------------------------------------------------------------------------

describe("EyedropperSection source: saved-colors feature present", () => {
  it("imports chrome.storage and saved-color helpers", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const source = readFileSync(
      join(process.cwd(), "src/sections/eyedropper/EyedropperSection.tsx"),
      "utf8"
    )
    expect(source).toContain("getSavedColors")
    expect(source).toContain("savePickedColor")
    expect(source).toContain("SavedColorCard")
    expect(source).toContain("savedColors")
  })

  it("imports from ../../lib/eyedropper", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const source = readFileSync(
      join(process.cwd(), "src/sections/eyedropper/EyedropperSection.tsx"),
      "utf8"
    )
    expect(source).toContain("lib/eyedropper")
  })

  it("uses useEffect for loading saved colors", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const source = readFileSync(
      join(process.cwd(), "src/sections/eyedropper/EyedropperSection.tsx"),
      "utf8"
    )
    expect(source).toContain("useEffect")
  })

  it("exports EyedropperSection", async () => {
    const mod = await import("../src/sections/eyedropper/EyedropperSection")
    expect(typeof mod.EyedropperSection).toBe("function")
  })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("EyedropperSection rendering", () => {
  it("renders the Pick Color button", async () => {
    const { host, cleanup } = await renderEyedropperSection()
    try {
      const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
      const pickBtn = buttons.find((b) => b.textContent?.includes("Pick Color"))
      expect(pickBtn).toBeTruthy()
    } finally {
      cleanup()
    }
  })

  it("renders the initial color preview hex value", async () => {
    const { host, cleanup } = await renderEyedropperSection()
    try {
      // Initial color is #61d394; the color preview area should show its HEX.
      expect(host.textContent).toContain("#61d394")
    } finally {
      cleanup()
    }
  })

  it("renders HEX, RGB, HSL, and OKLCH format buttons for the initial color", async () => {
    const { host, cleanup } = await renderEyedropperSection()
    try {
      const labels = Array.from(host.querySelectorAll("span"))
        .map((s) => s.textContent?.trim())
        .filter(Boolean)
      expect(labels).toContain("HEX")
      expect(labels).toContain("RGB")
      expect(labels).toContain("HSL")
      expect(labels).toContain("OKLCH")
    } finally {
      cleanup()
    }
  })

  it("renders a saved-colors section with placeholder text", async () => {
    const { host, cleanup } = await renderEyedropperSection()
    try {
      expect(host.textContent?.toLowerCase()).toContain("saved color")
      expect(host.textContent).toContain("Pick a color to keep it here.")
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Pick Color — EyeDropper unavailable
// ---------------------------------------------------------------------------

describe("EyedropperSection: EyeDropper unavailable", () => {
  it("shows 'Unavailable' status when window.EyeDropper is not defined", async () => {
    // Ensure EyeDropper is absent
    delete (window as typeof window & { EyeDropper?: unknown }).EyeDropper

    const clipboard = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard }
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Pick Color")
      )!
      await act(async () => {
        pickBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(host.textContent).toContain("Unavailable")
      expect(clipboard).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Pick Color — happy path
// ---------------------------------------------------------------------------

describe("EyedropperSection: successful pick", () => {
  it("updates the color display, copies to clipboard, and shows 'Copied' status", async () => {
    const clipboard = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard }
    })

    class MockEyeDropper {
      open = vi.fn(async () => ({ sRGBHex: "#ff0000" }))
    }
    Object.defineProperty(window, "EyeDropper", {
      configurable: true,
      value: MockEyeDropper
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Pick Color")
      )!
      await act(async () => {
        pickBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })

      // Color display updated
      expect(host.textContent).toContain("#ff0000")
      // Clipboard called with the picked hex
      expect(clipboard).toHaveBeenCalledWith("#ff0000")
      // Copied status shown
      expect(host.textContent).toContain("Copied")
    } finally {
      cleanup()
    }
  })

  it("persists color to chrome.storage after pick", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) }
    })
    class MockEyeDropper {
      open = vi.fn(async () => ({ sRGBHex: "#aabbcc" }))
    }
    Object.defineProperty(window, "EyeDropper", {
      configurable: true,
      value: MockEyeDropper
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Pick Color")
      )!
      await act(async () => {
        pickBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })

      // chrome.storage.local should have saved colors persisted.
      const dump = (await chrome.storage.local.get(null)) as Record<string, unknown>
      expect(Object.keys(dump).length).toBeGreaterThan(0)
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Pick Color — AbortError (user cancels)
// ---------------------------------------------------------------------------

describe("EyedropperSection: pick cancelled", () => {
  it("silently ignores DOMException AbortError", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) }
    })

    class MockEyeDropper {
      open = vi.fn(async () => {
        const err = new DOMException("User aborted", "AbortError")
        throw err
      })
    }
    Object.defineProperty(window, "EyeDropper", {
      configurable: true,
      value: MockEyeDropper
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Pick Color")
      )!
      await act(async () => {
        pickBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })
      // No error status set — AbortError is silently swallowed.
      expect(host.textContent).not.toContain("Unavailable")
      expect(host.textContent).not.toContain("failed")
      // Color stays at the initial value (#61d394).
      expect(host.textContent).toContain("#61d394")
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Pick Color — non-abort error
// ---------------------------------------------------------------------------

describe("EyedropperSection: pick error", () => {
  it("shows the error message in status for non-AbortError failures", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) }
    })

    class MockEyeDropper {
      open = vi.fn(async () => {
        throw new Error("permission denied")
      })
    }
    Object.defineProperty(window, "EyeDropper", {
      configurable: true,
      value: MockEyeDropper
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Pick Color")
      )!
      await act(async () => {
        pickBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(host.textContent).toContain("permission denied")
    } finally {
      cleanup()
    }
  })

  it("shows 'Pick failed' for non-Error thrown values", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) }
    })

    class MockEyeDropper {
      open = vi.fn(async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw "unexpected string error"
      })
    }
    Object.defineProperty(window, "EyeDropper", {
      configurable: true,
      value: MockEyeDropper
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      const pickBtn = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
        (b) => b.textContent?.includes("Pick Color")
      )!
      await act(async () => {
        pickBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })
      expect(host.textContent).toContain("Pick failed")
    } finally {
      cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// Copy format button
// ---------------------------------------------------------------------------

describe("EyedropperSection: copy format buttons", () => {
  it("clicking a format button copies the value and shows 'Copied'", async () => {
    const clipboard = vi.fn(async () => {})
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboard }
    })

    const { host, cleanup } = await renderEyedropperSection()
    try {
      // Find a button that has the "HEX" label sibling (these are the format buttons)
      const formatButtons = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(
        (b) => b.textContent?.includes("HEX") || b.textContent?.includes("RGB")
      )
      expect(formatButtons.length).toBeGreaterThan(0)

      const firstBtn = formatButtons[0]!
      await act(async () => {
        firstBtn.click()
        await new Promise((r) => setTimeout(r, 0))
      })

      expect(clipboard).toHaveBeenCalled()
      expect(host.textContent).toContain("Copied")
    } finally {
      cleanup()
    }
  })
})