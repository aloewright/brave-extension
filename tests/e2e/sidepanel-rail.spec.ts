import { test, expect } from "./_fixtures";
import type { SectionId } from "../../src/sections/types";

/**
 * Rail navigation smoke test (M1, ALO-253; updated for ALO-471).
 *
 * Asserts the rail renders every section icon, each icon switches to its
 * section, and the last-active section is restored after a reload via
 * `chrome.storage.local["ui.activeSection"]`.
 */

const SECTION_IDS: SectionId[] = [
  "terminal",
  "inspector",
  "pageStudio",
  "extensions",
  "session",
  "email",
  "quickInfo",
  "tasks",
  "bookmarks",
  "captures",
  "cookies",
  "agentChat",
  "github",
  "lexicon",
  "settings",
];

const SECTION_LABELS: Record<SectionId, string> = {
  terminal: "Terminal",
  inspector: "Inspector",
  pageStudio: "Page Studio",
  extensions: "Extensions",
  session: "Session",
  email: "Email",
  quickInfo: "Contact Enrichment",
  perplexity: "Perplexity",
  tasks: "Tasks",
  bookmarks: "Bookmarks",
  captures: "Page Captures",
  cookies: "Cookies",
  recorder: "Recorder",
  eyedropper: "Eyedropper",
  joplin: "Joplin",
  agentChat: "Agent",
  github: "GitHub",
  lexicon: "Lexicon",
  settings: "Settings",
};

test("rail renders every section icon", async ({ openSidepanel }) => {
  const page = await openSidepanel();
  for (const id of SECTION_IDS) {
    const btn = page.locator(`nav button[aria-label='${SECTION_LABELS[id]}']`);
    await expect(btn).toHaveCount(1);
  }
});

test("clicking each rail icon activates the section", async ({
  openSidepanel,
}) => {
  const page = await openSidepanel();
  for (const id of SECTION_IDS) {
    const btn = page.locator(`nav button[aria-label='${SECTION_LABELS[id]}']`);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    // Other rail icons should not be pressed.
    for (const other of SECTION_IDS) {
      if (other === id) continue;
      const o = page.locator(
        `nav button[aria-label='${SECTION_LABELS[other]}']`,
      );
      await expect(o).toHaveAttribute("aria-pressed", "false");
    }
  }
});

test("last-active section persists across reload", async ({
  openSidepanel,
}) => {
  const page = await openSidepanel();
  await page.locator("nav button[aria-label='Lexicon']").click();
  await expect(
    page.locator("nav button[aria-label='Lexicon']"),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.waitForSelector("nav button[aria-label='Lexicon']");
  await expect(
    page.locator("nav button[aria-label='Lexicon']"),
  ).toHaveAttribute("aria-pressed", "true");
});

test("settings sections render as expandable accordions", async ({
  openSidepanel,
}) => {
  const page = await openSidepanel();
  await page.locator("nav button[aria-label='Settings']").click();

  const summaries = page.locator("main summary");
  await expect(summaries).toContainText([
    "Appearance",
    "Paths",
    "MCP Servers",
    "Sidebar UX",
    "Connection Status",
  ]);

  const appearance = page
    .locator("main details")
    .filter({ hasText: "Appearance" });
  await expect(appearance).toHaveAttribute("open", "");

  const paths = page.locator("main details").filter({ hasText: "Paths" });
  await expect(paths).toHaveCount(1);
  await expect(paths).not.toHaveAttribute("open", "");
  await paths.locator("summary").click();
  await expect(paths).toHaveAttribute("open", "");
  await expect(page.getByPlaceholder("~/Projects/my-app")).toBeVisible();
});
