import { readFileSync } from "node:fs"
import { join } from "node:path"
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
//   3. The bottom quick-action group covers Screenshot / PiP / Save link / Page agent.
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

  it("includes Contact Enrichment as a dedicated Quick Info surface", () => {
    const ids = SECTIONS.map((s) => s.id)
    expect(ids).toContain<SectionId>("quickInfo")
    expect(SECTIONS.find((s) => s.id === "quickInfo")?.label).toBe("Contact Enrichment")
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
    expect(typeof mod.runPageAgentQuickAction).toBe("function")
  })

  it("keeps the Page agent toggle at the bottom of the rail actions", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8"
    )
    expect(source).toContain('label: "Page agent"')
    expect(source).toContain('icon: "cloud"')
    expect(source.indexOf('label: "Save link"')).toBeLessThan(source.indexOf('label: "Page agent"'))
  })

  it("renders quick-action loading and result feedback instead of swallowing clicks", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8"
    )

    expect(source).toContain("setRunningAction(def.label)")
    expect(source).toContain("aria-busy={isRunning ? true : undefined}")
    expect(source).toContain("animate-spin")
    expect(source).toContain("setTimeout(() => setFeedback(null), 1400)")
    expect(source).toContain("feedback?.label === def.label")
    expect(source).toContain('data-feedback-kind={currentFeedback?.kind}')
    expect(source).toContain('size={currentFeedback ? 12 : 16}')
    expect(source).toContain('name={iconName}')
    expect(source).toContain("showFeedback(def.label, await def.run())")
    expect(source).not.toContain("quick actions intentionally do not render rail feedback")
  })

  it("keeps bottom rail hover feedback simple and layout-neutral", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8"
    )

    expect(source).toContain("transition-colors duration-150")
    expect(source).toContain("h-8 w-8")
    expect(source).toContain("overflow-hidden")
    expect(source).toContain("active:bg-[rgba(136,192,208,0.22)]")
    expect(source).toContain("disabled:cursor-wait")
    expect(source).not.toContain("left-full")
    expect(source).not.toContain("hover:-translate-y")
    expect(source).not.toContain("hover:scale")
    expect(source).not.toContain("active:scale")
    expect(source).not.toContain('data-testid="sidebar-rail-toast"')
  })

  it("exposes a resizable sidebar window action", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8"
    )

    expect(source).toContain("openResizableSidebarWindow")
    expect(source).toContain('label: "Open resizable sidebar window"')
    expect(source).toContain('icon: "file-export"')
  })
})
