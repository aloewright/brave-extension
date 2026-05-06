import { defineConfig } from "@playwright/test"

/**
 * Playwright config for the AI Dev Sidebar Brave/Chromium extension.
 *
 * The extension is loaded as an unpacked build from `build/chrome-mv3-prod`.
 * Tests must:
 *  1. Run `pnpm build` first (or rely on CI to do so).
 *  2. Have Chromium installed via `pnpm exec playwright install chromium`.
 *
 * The native host (PTY, MCP server) is out of scope here — Playwright only
 * exercises UI flows that work with `chrome.*` mocked or absent. Anything
 * that needs the host is documented in the manual test plan at
 * `docs/superpowers/specs/2026-04-28-test-plan.md`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // persistent context per test
  workers: 1,
  reporter: [["list"]],
  use: {
    actionTimeout: 5_000,
    trace: "retain-on-failure"
  }
})
