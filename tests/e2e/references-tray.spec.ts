import { test, expect } from "./_fixtures"

/**
 * References tray test (M4, ALO-253).
 *
 * Real picker flow requires a content-script-injected page picker, native
 * messaging for the screenshot crop, and an MCP resource publish round
 * trip — all of which sit outside the Playwright headless boundary.
 *
 * What we *can* validate cheaply: the tray correctly renders chips that
 * are present in `chrome.storage.local["terminal.references"]` at mount
 * time, and the count badge in the tray header reflects the seeded list.
 *
 * The picker → capture → outerHTML/screenshot path is covered by the
 * manual test plan (Section 5).
 */

const fakeRef = {
  id: "ref_01HZTEST00000000000001",
  tabId: 1,
  url: "https://example.com/",
  title: "Example",
  selector: "html > body > main",
  outerHTML: "<main>hello</main>",
  textContent: "hello",
  boundingBox: { x: 0, y: 0, w: 100, h: 100 },
  screenshot: "data:image/png;base64,",
  createdAt: Date.now()
}

test("seeded reference appears in tray after sidepanel mount", async ({
  context,
  extensionId,
  openSidepanel
}) => {
  // Use a service worker context to set chrome.storage.local before the
  // sidepanel opens. The hook only loads at mount time, so seeding has
  // to happen first.
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  await sw.evaluate(async (refs) => {
    await chrome.storage.local.set({ "terminal.references": refs })
  }, [fakeRef])

  const page = await openSidepanel()

  // Tray header shows the count.
  await expect(page.getByText(/References\s*\(1\)/)).toBeVisible({ timeout: 5_000 })

  // The chip itself is present (selector text or content visible).
  // ReferenceChip renders the title or selector. Match a substring that
  // is reasonably stable across the chip's render.
  const chipArea = page.locator("text=Example").first()
  await expect(chipArea).toBeVisible()

  // Confirm the unused `extensionId` value is consistent with the
  // extension under test (avoid unused-var lint).
  expect(extensionId).toMatch(/^[a-p]{32}$/)
})

test("empty references storage shows the empty hint", async ({ openSidepanel }) => {
  const page = await openSidepanel()
  await expect(page.getByText(/No references yet/)).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/References\s*\(0\)/)).toBeVisible()
})
