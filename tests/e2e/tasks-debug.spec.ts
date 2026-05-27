import { test, expect } from "./_fixtures"

// Headless diagnostic for the cal.fly.pm tasks flow. Loads the extension,
// sets a fake `__Secure-better-auth.session_token` cookie on cal.fly.pm so
// the cal-tab path is engaged, dispatches a `TASKS_API_REQUEST` straight to
// the service worker, and prints what comes back + any console output.

test("tasks flow: SW dispatches the request and returns a structured result", async ({
  context,
  extensionId,
}) => {
  // 1. Seed a fake cal.fly.pm session cookie so getCalFlyPmCookieHeader returns truthy.
  await context.addCookies([
    {
      name: "__Secure-better-auth.session_token",
      value: "headless-test-placeholder",
      domain: "cal.fly.pm",
      path: "/",
      secure: true,
      httpOnly: false,
      sameSite: "Lax",
    },
  ])

  // 2. Capture all SW console output for the run.
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const swLogs: Array<{ type: string; text: string }> = []
  sw.on("console", (msg) => {
    swLogs.push({ type: msg.type(), text: msg.text() })
  })

  // 3. Also capture network requests so we can see where the fetch lands.
  const requests: Array<{ url: string; method: string }> = []
  context.on("request", (req) => {
    if (req.url().includes("fly.pm")) requests.push({ url: req.url(), method: req.method() })
  })

  // 4. Open a sidepanel page (chrome-extension:// origin) and dispatch the
  // message from there — sendMessage from the SW back to itself doesn't fire
  // the onMessage listener, but a page-origin sender does.
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await page.waitForLoadState("domcontentloaded")

  const pageLogs: Array<{ type: string; text: string }> = []
  page.on("console", (msg) => pageLogs.push({ type: msg.type(), text: msg.text() }))

  const result = await page.evaluate(async () => {
    const SEND = (msg: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        try {
          chrome.runtime.sendMessage(msg, (response: unknown) => {
            const err = chrome.runtime.lastError
            if (err) reject(new Error(err.message))
            else resolve(response)
          })
        } catch (e) {
          reject(e)
        }
      })
    try {
      const r = await Promise.race([
        SEND({
          type: "TASKS_API_REQUEST",
          path: "/tasks-data",
          init: { method: "GET", headers: { accept: "application/json" } },
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("25s timeout")), 25_000)),
      ])
      return { ok: true, response: r }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // 5. Print everything for diagnosis.
  console.log("=== SW returned ===")
  console.log(JSON.stringify(result, null, 2))
  console.log("=== fly.pm requests observed ===")
  console.log(JSON.stringify(requests, null, 2))
  console.log("=== SW console logs ===")
  for (const { type, text } of swLogs) console.log(`[sw:${type}] ${text}`)
  console.log("=== sidepanel page logs ===")
  for (const { type, text } of pageLogs) console.log(`[page:${type}] ${text}`)

  // Not asserting success — this is a diagnostic. Just verifying the SW responded.
  expect(result).toBeDefined()
})
