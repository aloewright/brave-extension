import { describe, it, expect } from "vitest"
import { SECTIONS, type SectionId } from "../src/sections/types"

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
// rail's bottom group.

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
})
