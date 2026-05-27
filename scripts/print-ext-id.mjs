// One-shot: launches Playwright the same way the e2e fixture does and prints
// the extension ID derived from the unpacked build's absolute path. Used to
// authorize the dev build for native-messaging in the local Chromium manifest.

import { chromium } from "@playwright/test"
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"

const EXT_DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "build", "chrome-mv3-prod")
if (!fs.existsSync(EXT_DIST)) {
  console.error(`Build not found at ${EXT_DIST} — run \`pnpm build\` first.`)
  process.exit(2)
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-dev-sidebar-extid-"))
const ctx = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${EXT_DIST}`,
    `--load-extension=${EXT_DIST}`,
    "--no-sandbox",
  ],
})

let sw = ctx.serviceWorkers()[0]
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 10_000 })
const m = sw.url().match(/^chrome-extension:\/\/([a-p]+)\//)
if (!m) {
  console.error(`Could not parse extension id from ${sw.url()}`)
  await ctx.close()
  process.exit(3)
}
console.log(m[1])
await ctx.close()
fs.rmSync(userDataDir, { recursive: true, force: true })
