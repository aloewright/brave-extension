import { expect, test } from "./_fixtures"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { join } from "node:path"

const TOKEN = "e2e-keepout-session-token"
const SELECTED_TEXT = "A selected passage saved only to Keepout."

type CaptureRequest = {
  authorization?: string
  body: unknown
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

async function startKeepoutServer(options: { lockFirstCapture?: boolean } = {}) {
  const captures: CaptureRequest[] = []
  let statusRequests = 0
  let firstCapture = true
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/article") {
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(`<!doctype html><title>Keepout capture sample</title><main><p id="selected">${SELECTED_TEXT}</p></main>`)
      return
    }
    if (url.pathname === "/v1/captures/status" && request.method === "GET") {
      statusRequests += 1
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end()
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ version: 1, available: true }))
      return
    }
    if (url.pathname === "/v1/captures" && request.method === "POST") {
      const body = await readJson(request)
      captures.push({ authorization: request.headers.authorization, body })
      if (options.lockFirstCapture && firstCapture) {
        firstCapture = false
        response.writeHead(423, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "Keepout is locked" }))
        return
      }
      response.writeHead(201, { "content-type": "application/json" })
      response.end(JSON.stringify({
        id: (body as { id?: string }).id,
        createdAt: "2026-09-19T00:00:00.000Z",
      }))
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Keepout test server did not bind a TCP port")
  return {
    port: address.port,
    captures,
    get statusRequests() {
      return statusRequests
    },
    close: () => new Promise<void>((resolve) => {
      // Chromium can retain the local HTTP connection after the response;
      // close it before awaiting server shutdown so teardown cannot consume
      // the test's full timeout.
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

async function configureKeepout(
  page: import("@playwright/test").Page,
  port: number,
) {
  await page.getByRole("button", { name: "Settings", exact: true }).click()
  const keepout = page.locator("details").filter({ hasText: "Keepout" })
  await expect(keepout).toBeVisible()
  if (!(await keepout.getAttribute("open"))) {
    if (!(await keepout.evaluate((element) => (element as HTMLDetailsElement).open))) await keepout.locator("summary").click()
  }
  await keepout.getByLabel("Keepout local API port").fill(String(port))
  await keepout.getByPlaceholder("Keepout API token").fill(TOKEN)
  await keepout.getByRole("button", { name: "Save Keepout connection", exact: true }).click()
  await expect(keepout.getByText(/saved for this browser session/i)).toBeVisible()
  await keepout.getByRole("button", { name: "Test connection", exact: true }).click()
  await expect(keepout.getByText(/local API reachable/i)).toBeVisible()
}

async function openCapturePanel(
  settingsPage: import("@playwright/test").Page,
  articlePage: import("@playwright/test").Page,
) {
  const selected = await articlePage.locator("#selected").evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return selection?.toString()
  })
  if (selected !== SELECTED_TEXT) throw new Error("Could not select the Keepout sample text")
  const articleUrl = articlePage.url()
  const tabId = await settingsPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((candidate) => candidate.url === url)
    if (typeof tab?.id !== "number") throw new Error("Could not find the sample page tab")
    return tab.id
  }, articleUrl)
  // The sender must be an extension page: sending this from the web page would
  // test a privilege boundary bypass rather than the production UI path.
  await settingsPage.evaluate((selectedTabId) => new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "keepout/open", tabId: selectedTabId }, () => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolve()
    })
  }), tabId)
  const root = articlePage.locator("#keepout-capture-root")
  const dialog = root.getByRole("dialog", { name: "Save to Keepout" })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("blockquote")).toHaveText(SELECTED_TEXT)
  return dialog
}

test("Keepout settings stay session-local and save the rendered selected-text capture", async ({
  context,
  extensionId,
  openSidepanel,
}) => {
  const keepout = await startKeepoutServer()
  try {
    const settingsPage = await openSidepanel()
    await configureKeepout(settingsPage, keepout.port)
    expect(keepout.statusRequests).toBeGreaterThanOrEqual(1)

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker")
    const storage = await worker.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      session: await chrome.storage.session.get(null),
      sync: await chrome.storage.sync.get(null),
    }))
    expect(storage.local["keepout.connection.port"]).toBe(keepout.port)
    expect(storage.session["keepout.connection.token"]).toBe(TOKEN)
    expect(JSON.stringify(storage.local)).not.toContain(TOKEN)
    expect(JSON.stringify(storage.sync)).not.toContain(TOKEN)

    const articlePage = await context.newPage()
    await articlePage.goto(`http://127.0.0.1:${keepout.port}/article`)
    const dialog = await openCapturePanel(settingsPage, articlePage)
    await dialog.getByLabel("Note title").fill("A durable title")
    await dialog.getByLabel("Margin note").fill("A private marginal observation")

    if (process.env.KEEPOUT_E2E_SCREENSHOT_DIR) {
      await articlePage.screenshot({
        path: join(process.env.KEEPOUT_E2E_SCREENSHOT_DIR, "keepout-capture-dialog.png"),
      })
    }
    await dialog.getByRole("button", { name: "Save to Keepout", exact: true }).click()
    await expect.poll(() => keepout.captures).toHaveLength(1)

    const submitted = keepout.captures[0]
    expect(submitted.authorization).toBe(`Bearer ${TOKEN}`)
    expect(submitted.body).toMatchObject({
      version: 1,
      title: "A durable title",
      sourceUrl: `http://127.0.0.1:${keepout.port}/article`,
      selection: SELECTED_TEXT,
      marginNote: "A private marginal observation",
    })
    expect((submitted.body as { id?: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    await expect(dialog.getByRole("status")).toHaveText(/Saved to Keepout/i)
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible()
    expect(extensionId).toMatch(/^[a-p]{32}$/)
  } finally {
    await keepout.close()
  }
})

test("a locked Keepout leaves the panel inputs intact and retries the same capture id", async ({
  context,
  openSidepanel,
}) => {
  const keepout = await startKeepoutServer({ lockFirstCapture: true })
  try {
    const settingsPage = await openSidepanel()
    await configureKeepout(settingsPage, keepout.port)
    const articlePage = await context.newPage()
    await articlePage.goto(`http://127.0.0.1:${keepout.port}/article`)
    const dialog = await openCapturePanel(settingsPage, articlePage)
    await dialog.getByLabel("Note title").fill("Retry without losing context")
    await dialog.getByLabel("Margin note").fill("Keep this note after an unlock")
    const save = dialog.getByRole("button", { name: "Save to Keepout", exact: true })

    await save.click()
    await expect.poll(() => keepout.captures).toHaveLength(1)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("status")).toHaveText(/unlock Keepout and retry/i)
    await expect(dialog.getByLabel("Note title")).toHaveValue("Retry without losing context")
    await expect(dialog.getByLabel("Margin note")).toHaveValue("Keep this note after an unlock")

    // The lock response keeps this frozen draft in the panel: the user either
    // retries the identical request after unlocking Keepout, or closes it and
    // starts a new clip. Retrying must not mint a second capture identifier.
    await dialog.getByRole("button", { name: "Retry save", exact: true }).click()
    await expect.poll(() => keepout.captures).toHaveLength(2)
    const first = keepout.captures[0].body as { id?: string }
    const retried = keepout.captures[1].body as { id?: string }
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect(retried.id).toBe(first.id)
    await expect(dialog.getByRole("status")).toHaveText(/Saved to Keepout/i)
  } finally {
    await keepout.close()
  }
})
