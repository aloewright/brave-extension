import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"

/**
 * Shared Playwright fixture that launches Chromium with the unpacked
 * extension loaded from `build/chrome-mv3-prod`, discovers the extension
 * id from the service-worker URL, and exposes a helper for opening the
 * sidepanel HTML directly.
 *
 * Side-panel UIs in MV3 are not addressable as pop-out windows from
 * automation, but they ARE just plain HTML pages on the
 * `chrome-extension://<id>/` origin and can be opened in a regular tab
 * for testing. Storage and runtime APIs work the same.
 */

export const EXT_DIST = path.resolve(__dirname, "../../build/chrome-mv3-prod")

interface Fixtures {
  context: BrowserContext
  extensionId: string
  openSidepanel: () => Promise<import("@playwright/test").Page>
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(EXT_DIST)) {
      throw new Error(
        `Extension build not found at ${EXT_DIST}. Run \`pnpm build\` first.`
      )
    }
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-dev-sidebar-e2e-"))

    // Native-messaging manifests are looked up per-profile by Chrome for
    // Testing — system-wide installs under Chromium/Chrome don't apply to
    // Playwright's bundled browser. Mirror the user-installed manifest into
    // this profile so chrome.runtime.sendNativeMessage / connectNative can
    // reach the local host during e2e runs.
    const srcManifest = path.join(
      os.homedir(),
      "Library/Application Support/Chromium/NativeMessagingHosts/com.aidev.sidebar.json"
    )
    if (fs.existsSync(srcManifest)) {
      const dstDir = path.join(userDataDir, "NativeMessagingHosts")
      fs.mkdirSync(dstDir, { recursive: true })
      fs.copyFileSync(srcManifest, path.join(dstDir, "com.aidev.sidebar.json"))
    }

    const ctx = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXT_DIST}`,
        `--load-extension=${EXT_DIST}`,
        "--no-sandbox"
      ]
    })
    await use(ctx)
    await ctx.close()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      /* best-effort cleanup */
    }
  },

  extensionId: async ({ context }, use) => {
    let sw: Worker | undefined = context.serviceWorkers()[0]
    if (!sw) {
      sw = await context.waitForEvent("serviceworker", { timeout: 10_000 })
    }
    const url = sw.url() // chrome-extension://<id>/...
    const m = url.match(/^chrome-extension:\/\/([a-p]+)\//)
    if (!m) throw new Error(`Could not parse extension id from ${url}`)
    await use(m[1])
  },

  openSidepanel: async ({ context, extensionId }, use) => {
    const open = async () => {
      const page = await context.newPage()
      await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
      // Sidepanel renders client-side via React; wait for the rail nav.
      await page.waitForSelector("nav button[aria-label='Terminal']", { timeout: 10_000 })
      return page
    }
    await use(open)
  }
})

export { expect } from "@playwright/test"
