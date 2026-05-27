import { test, expect } from "./_fixtures"

// Headless diagnostic for the AI chat flow. Loads the extension, dispatches
// `ai-chat/send` from a sidepanel page, and collects the broadcast turn-update
// / turn-done events plus any SW console output. The goal is to verify the
// dispatcher path lights up after the foundationModels.chat patch — not to
// require a real Foundation Models response (Playwright's Chromium has no
// signed entry in the native-messaging allowed_origins list, so the call may
// fail at the OS hand-off; the failure mode itself is the signal we want).

test("ai-chat send: orchestrator runs and broadcasts a turn", async ({
  context,
  extensionId,
}) => {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  const swLogs: Array<{ type: string; text: string }> = []
  sw.on("console", (msg) => {
    swLogs.push({ type: msg.type(), text: msg.text() })
  })

  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`)
  await page.waitForLoadState("domcontentloaded")
  const pageLogs: Array<{ type: string; text: string }> = []
  page.on("console", (msg) => pageLogs.push({ type: msg.type(), text: msg.text() }))

  const result = await page.evaluate(async () => {
    const events: Array<Record<string, unknown>> = []
    const listener = (m: unknown) => {
      if (m && typeof m === "object") {
        const msg = m as { type?: string }
        if (msg.type === "ai-chat/turn-update" || msg.type === "ai-chat/turn-done") {
          events.push(msg as Record<string, unknown>)
        }
      }
    }
    chrome.runtime.onMessage.addListener(listener)

    // Direct probe: status, then a one-shot chat — bypasses the orchestrator
    // so we can see the raw native-host response on the wire.
    const HOST = "com.aidev.sidebar"
    const sendNM = (p: object) =>
      new Promise<unknown>((resolve) => {
        chrome.runtime.sendNativeMessage(HOST, p, (r) => {
          resolve({ response: r, lastError: chrome.runtime.lastError?.message ?? null })
        })
      })

    const statusRaw = await sendNM({ type: "foundationModels.status", operation: "status" })
    const chatRaw = await sendNM({
      type: "foundationModels.chat",
      operation: "chat",
      systemPrompt: "You are helpful.",
      toolsJson: "[]",
      history: [{ role: "user", content: "Say hello in five words." }],
    })

    const userMessageId = `test-${Date.now()}`
    chrome.runtime.sendMessage({
      type: "ai-chat/send",
      userMessageId,
      text: "Say hello in five words.",
      ambient: { activeTab: null, mostRecentClip: null },
    })

    // Wait up to 30s for a turn-done event.
    const start = Date.now()
    while (Date.now() - start < 30_000) {
      if (events.some((e) => e.type === "ai-chat/turn-done")) break
      await new Promise((r) => setTimeout(r, 250))
    }
    chrome.runtime.onMessage.removeListener(listener)
    return { events, waitedMs: Date.now() - start, statusRaw, chatRaw }
  })

  console.log("=== Native host status (direct) ===")
  console.log(JSON.stringify(result.statusRaw, null, 2))
  console.log("=== Native host chat (direct) ===")
  console.log(JSON.stringify(result.chatRaw, null, 2))

  console.log("=== Broadcast events ===")
  console.log(JSON.stringify(result.events, null, 2))
  console.log(`=== Waited ${result.waitedMs}ms ===`)
  console.log("=== SW console logs ===")
  for (const { type, text } of swLogs) console.log(`[sw:${type}] ${text}`)
  console.log("=== Sidepanel page logs ===")
  for (const { type, text } of pageLogs) console.log(`[page:${type}] ${text}`)

  // Minimum signal: the orchestrator at least broadcast the user message back.
  expect(result.events.length).toBeGreaterThan(0)
})
