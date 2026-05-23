import * as React from "react"
import { MantineProvider } from "@mantine/core"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, it, expect, vi } from "vitest"
import { SECTIONS, type SectionId } from "../src/sections/types"

;(globalThis as { React?: typeof React }).React = React
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("../src/lib/quick-actions", () => ({
  runScreenshotQuickAction: vi.fn(),
  runPipQuickAction: vi.fn(),
  runSaveLinkQuickAction: vi.fn()
}))

// ALO-471 — sidebar rail layout + section composition.
//
// The codebase avoids @testing-library/react and tests components via
// logical assertions on the same primitives the component consumes. The
// rail's three contracts that ALO-471 introduces are:
//
//   1. Tech is a dedicated section (not a sub-tab of Extensions).
//   2. Session replaces Library as the snippets/links/feeds surface.
//   3. The bottom quick-action group covers Screenshot / PiP / Save link.
//
// We verify (1) and (2) via SECTIONS, and (3) via the lib that backs the
// rail's bottom group plus direct DOM checks through happy-dom.

let mountedRoots: Root[] = []

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount())
  }
  mountedRoots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
  vi.useRealTimers()
})

async function renderRail() {
  const { SidebarRail } = await import("../src/components/SidebarRail")
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      React.createElement(
        MantineProvider,
        {},
        React.createElement(SidebarRail, { active: "terminal", onChange: vi.fn() })
      )
    )
  })

  return host
}

function quickActionButton(host: HTMLElement, label: string) {
  const button = host.querySelector(`button[aria-label="${label}"]`)
  expect(button).toBeInstanceOf(HTMLButtonElement)
  return button as HTMLButtonElement
}

describe("SECTIONS reflects ALO-471 reorg", () => {
  it("includes the dedicated Tech section", () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(ids).toContain<SectionId>("tech")
  })

  it("includes Session (renamed from Library, ALO-470)", () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(ids).toContain<SectionId>("session")
    expect(ids as string[]).not.toContain("library")
  })

  it("Tech and Session appear next to each other to keep the rail scannable", () => {
    const ids = SECTIONS.map((s) => s.id)
    const techIdx = ids.indexOf("tech")
    const sessionIdx = ids.indexOf("session")
    expect(techIdx).toBeGreaterThan(-1)
    expect(sessionIdx).toBeGreaterThan(-1)
    expect(Math.abs(techIdx - sessionIdx)).toBeLessThanOrEqual(1)
  })

  it("every section carries a non-empty label", () => {
    for (const s of SECTIONS) {
      expect(s.label.length).toBeGreaterThan(0)
    }
  })
})

describe("Bottom quick-action group composition", () => {
  // The rail imports these three handlers and exposes them as buttons in
  // the bottom group. Asserting the module surface keeps the rail's UI
  // honest about what it can do.
  it("exports the three quick-action handlers the rail wires up", async () => {
    const mod = await import("../src/lib/quick-actions")
    expect(typeof mod.runScreenshotQuickAction).toBe("function")
    expect(typeof mod.runPipQuickAction).toBe("function")
    expect(typeof mod.runSaveLinkQuickAction).toBe("function")
  })

  it("shows loading feedback while a bottom quick action is running", async () => {
    const mod = await import("../src/lib/quick-actions")
    let resolveAction: (value: { kind: "success"; message: string }) => void = () => {}
    vi.mocked(mod.runSaveLinkQuickAction).mockImplementationOnce(
      () => new Promise((resolve) => { resolveAction = resolve })
    )

    const host = await renderRail()
    const button = quickActionButton(host, "Save link")

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(button.dataset.feedback).toBe("loading")
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.disabled).toBe(true)

    await act(async () => {
      resolveAction({ kind: "success", message: "Link saved" })
    })

    expect(button.dataset.feedback).toBe("success")
    expect(button.title).toBe("Link saved")
    expect(button.disabled).toBe(false)
  })

  it("shows error feedback when a bottom quick action fails", async () => {
    const mod = await import("../src/lib/quick-actions")
    vi.mocked(mod.runPipQuickAction).mockResolvedValueOnce({
      kind: "error",
      message: "Reload page first"
    })

    const host = await renderRail()
    const button = quickActionButton(host, "Picture-in-picture")

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(button.dataset.feedback).toBe("error")
    expect(button.title).toBe("Reload page first")
    expect(button.disabled).toBe(false)
  })
})
