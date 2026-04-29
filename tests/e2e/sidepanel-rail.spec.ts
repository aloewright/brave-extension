import { test, expect } from "./_fixtures"
import type { SectionId } from "../../src/sections/types"

/**
 * Rail navigation smoke test (M1, ALO-253).
 *
 * Asserts the 7-icon rail renders, each icon switches to its section,
 * and the last-active section is restored after a reload via
 * `chrome.storage.local["ui.activeSection"]`.
 */

const SECTION_IDS: SectionId[] = [
  "terminal",
  "inspector",
  "extensions",
  "library",
  "cookies",
  "recorder",
  "settings"
]

const SECTION_LABELS: Record<SectionId, string> = {
  terminal: "Terminal",
  inspector: "Inspector",
  extensions: "Extensions",
  library: "Library",
  cookies: "Cookies",
  recorder: "Recorder",
  settings: "Settings"
}

test("rail renders all 7 section icons", async ({ openSidepanel }) => {
  const page = await openSidepanel()
  for (const id of SECTION_IDS) {
    const btn = page.locator(`nav button[aria-label='${SECTION_LABELS[id]}']`)
    await expect(btn).toHaveCount(1)
  }
})

test("clicking each rail icon activates the section", async ({ openSidepanel }) => {
  const page = await openSidepanel()
  for (const id of SECTION_IDS) {
    const btn = page.locator(`nav button[aria-label='${SECTION_LABELS[id]}']`)
    await btn.click()
    await expect(btn).toHaveAttribute("aria-pressed", "true")
    // Other rail icons should not be pressed.
    for (const other of SECTION_IDS) {
      if (other === id) continue
      const o = page.locator(`nav button[aria-label='${SECTION_LABELS[other]}']`)
      await expect(o).toHaveAttribute("aria-pressed", "false")
    }
  }
})

test("last-active section persists across reload", async ({ openSidepanel }) => {
  const page = await openSidepanel()
  await page.locator("nav button[aria-label='Recorder']").click()
  await expect(page.locator("nav button[aria-label='Recorder']")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await page.reload()
  await page.waitForSelector("nav button[aria-label='Recorder']")
  await expect(page.locator("nav button[aria-label='Recorder']")).toHaveAttribute(
    "aria-pressed",
    "true"
  )
})
