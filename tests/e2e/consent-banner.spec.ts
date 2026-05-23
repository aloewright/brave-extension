import { test, expect } from "./_fixtures"

/**
 * Consent banner UI test (M7, ALO-253).
 *
 * The real consent FSM lives in the background service worker. This test
 * exercises the sidepanel-side React component (`ConsentBanner` +
 * `useConsentRequests`) by dispatching synthetic `consent:request`
 * messages from the extension service worker, matching the production
 * background-to-sidepanel path.
 *
 * Allow / Deny click handlers call `chrome.runtime.sendMessage` — that
 * call is best-effort and silently swallowed when the background hasn't
 * registered a matching handler, so the banner UI behaviour is what we
 * actually validate here.
 */

async function dispatchConsentRequest(page: import("@playwright/test").Page, req: object) {
  const worker =
    page.context().serviceWorkers()[0] ??
    await page.context().waitForEvent("serviceworker", { timeout: 10_000 })
  await worker.evaluate((r) => {
    // The real consent request is broadcast by the background service worker;
    // dispatch from that context so the sidepanel listener receives it.
    chrome.runtime.sendMessage(r)
  }, req)
}

test("banner appears for a write-class consent request and disappears on Allow", async ({
  openSidepanel
}) => {
  const page = await openSidepanel()
  await dispatchConsentRequest(page, {
    type: "consent:request",
    requestId: "req-allow-1",
    toolName: "bookmarks_create",
    args: { title: "Hello", url: "https://example.com" },
    toolClass: "write"
  })

  const banner = page.locator("text=bookmarks_create").first()
  await expect(banner).toBeVisible({ timeout: 5_000 })
  await expect(page.getByRole("button", { name: "Allow" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Deny" })).toBeVisible()
  await expect(page.getByText("Remember for this session")).toBeVisible()

  await page.getByRole("button", { name: "Allow" }).click()
  await expect(banner).toBeHidden({ timeout: 3_000 })
})

test("always-prompt request hides remember-checkbox and shows sensitive label", async ({
  openSidepanel
}) => {
  const page = await openSidepanel()
  await dispatchConsentRequest(page, {
    type: "consent:request",
    requestId: "req-sensitive-1",
    toolName: "cookies_get",
    args: { url: "https://example.com" },
    toolClass: "always-prompt"
  })

  await expect(page.locator("text=cookies_get").first()).toBeVisible()
  await expect(page.getByText("sensitive")).toBeVisible()
  await expect(page.getByText("Remember for this session")).toHaveCount(0)
  await expect(page.getByText(/Always prompts/)).toBeVisible()
})

test("a second request reappears after the first is resolved", async ({ openSidepanel }) => {
  const page = await openSidepanel()
  await dispatchConsentRequest(page, {
    type: "consent:request",
    requestId: "req-seq-1",
    toolName: "links_add",
    args: { title: "A", url: "https://a.example" },
    toolClass: "write"
  })
  await expect(page.locator("text=links_add").first()).toBeVisible()
  await page.getByRole("button", { name: "Deny" }).click()
  await expect(page.locator("text=links_add").first()).toBeHidden()

  await dispatchConsentRequest(page, {
    type: "consent:request",
    requestId: "req-seq-2",
    toolName: "extensions_uninstall",
    args: { id: "abcd" },
    toolClass: "write"
  })
  await expect(page.locator("text=extensions_uninstall").first()).toBeVisible()
})
