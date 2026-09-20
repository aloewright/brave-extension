import { expect, test } from "./_fixtures"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { join } from "node:path"

const TOKEN = "e2e-keepout-session-token"
const SELECTED_TEXT = "A selected passage saved only to Keepout."
const CANVAS_TEXT = "Canvas body text that must stay inside the extension confirmation frame."
const CANVAS_MARKDOWN_TEXT = CANVAS_TEXT
const CANVAS_NESTED_MARKDOWN_TEXT = "Before **bold *emphasis*** after."
const TWO_BY_TWO_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQIHWP4z8DwH4QZYAwjAwA2AgH/1fsA0QAAAABJRU5ErkJggg=="

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
  const pageCaptures: CaptureRequest[] = []
  let statusRequests = 0
  let firstCapture = true
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === "/article") {
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(`<!doctype html><title>Keepout capture sample</title><main><p id="selected">${SELECTED_TEXT}</p></main>`)
      return
    }
    if (url.pathname === "/courses/42/pages/lesson") {
      response.setHeader("set-cookie", "canvas_session=authenticated; Path=/; SameSite=Lax")
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(`<!doctype html><title>Canvas lesson</title><main id="wiki_page_show"><h1 class="page-title">Week one lesson</h1><div class="show-content user_content"><h2>Week one</h2><p>${CANVAS_TEXT}</p><p>Before<strong> bold <em>emphasis</em> </strong>after.</p><ul><li>First task</li><li>Second task</li></ul><img alt="Lesson diagram" src="/canvas-image"><footer role="contentinfo"><img class="footer-branding" alt="" src="/canvas-footer-brand"></footer></div></main>`)
      return
    }
    if (url.pathname === "/canvas-image") {
      if (!request.headers.cookie?.includes("canvas_session=authenticated")) {
        response.writeHead(403).end()
        return
      }
      response.setHeader("content-type", "image/png")
      response.end(Buffer.from(TWO_BY_TWO_PNG, "base64"))
      return
    }
    if (url.pathname === "/canvas-footer-brand") {
      response.setHeader("content-type", "image/png")
      response.end(Buffer.from(TWO_BY_TWO_PNG, "base64"))
      return
    }
    if (url.pathname === "/v1/captures/status" && request.method === "GET") {
      statusRequests += 1
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end()
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ version: 1, pageCaptureVersion: 1, available: true }))
      return
    }
    if (url.pathname === "/v1/page-captures" && request.method === "POST") {
      const body = await readJson(request)
      pageCaptures.push({ authorization: request.headers.authorization, body })
      response.writeHead(201, { "content-type": "application/json" })
      response.end(JSON.stringify({
        id: (body as { id?: string }).id,
        createdAt: "2026-09-19T00:00:00.000Z",
      }))
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
    pageCaptures,
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

/**
 * Canvas is deliberately served as localhost while its signed download URL is
 * 127.0.0.1.  They are distinct origins even though this fixture owns both,
 * which lets the browser enforce the redirect/CORS boundary we rely on in
 * production instead of faking it with disabled web security.
 */
async function startAuthenticatedCanvasServer(options: { denyPublicUrl?: boolean } = {}) {
  const previewRequests: Array<{ fileId: string; secFetchSite?: string; origin?: string }> = []
  const publicUrlRequests: Array<{ fileId: string; cookie?: string; secFetchSite?: string; origin?: string }> = []
  const signedRequests: string[] = []
  const signedToken = "signed-cdn-session-token"
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    const publicUrl = url.pathname.match(/^\/api\/v1\/files\/(\d+)\/public_url$/)
    const preview = url.pathname.match(/^\/(?:courses\/42|groups\/77)\/files\/(\d+)\/preview$/)
    const signed = url.pathname.match(/^\/signed-download\/(\d+)$/)
    if (url.pathname === "/courses/42/pages/lesson") {
      response.setHeader("set-cookie", "canvas_session=authenticated; Path=/; SameSite=Lax")
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(`<!doctype html><title>Canvas lesson</title><main id="wiki_page_show"><h1 class="page-title">Week one lesson</h1><div class="show-content user_content"><h2>Week one</h2><p>${CANVAS_TEXT}</p><img alt="Endpoint course" src="/courses/42/files/101/preview" data-api-endpoint="/api/v1/courses/42/files/101"><img alt="Preview course" src="/courses/42/files/102/preview"><img alt="Endpoint group" src="/groups/77/files/103/preview" data-api-endpoint="/api/v1/groups/77/files/103"><img alt="Preview group" src="/groups/77/files/104/preview"></div></main>`)
      return
    }
    if (preview) {
      previewRequests.push({ fileId: preview[1], secFetchSite: request.headers["sec-fetch-site"], origin: request.headers.origin })
      // A tab follows this to a different origin, so its fetch is CORS-blocked.
      // An extension fetch sees this HTML fallback, never image bytes.
      if (request.headers["sec-fetch-site"] === "same-origin") {
        response.writeHead(302, { location: `http://127.0.0.1:${address.port}/preview-login` }).end()
      } else {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<p>Canvas preview requires a signed URL</p>")
      }
      return
    }
    if (publicUrl) {
      publicUrlRequests.push({ fileId: publicUrl[1], cookie: request.headers.cookie, secFetchSite: request.headers["sec-fetch-site"], origin: request.headers.origin })
      // This is intentionally callable only by the authenticated Canvas tab,
      // not by an extension-origin request that happens to have host access.
      if (options.denyPublicUrl || !request.headers.cookie?.includes("canvas_session=authenticated")
        || request.headers["sec-fetch-site"] !== "same-origin" || request.headers.origin?.startsWith("chrome-extension:")) {
        response.writeHead(403).end()
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(`while(1);${JSON.stringify({ public_url: `http://127.0.0.1:${address.port}/signed-download/${publicUrl[1]}?session=${signedToken}` })}`)
      return
    }
    if (signed) {
      signedRequests.push(url.href)
      if (url.searchParams.get("session") !== signedToken || request.headers.cookie) {
        response.writeHead(403).end()
        return
      }
      response.writeHead(200, { "content-type": "image/png" })
      response.end(Buffer.from(TWO_BY_TWO_PNG, "base64"))
      return
    }
    if (url.pathname === "/preview-login") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<p>Canvas sign in</p>")
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const bound = server.address()
  if (!bound || typeof bound === "string") throw new Error("Canvas test server did not bind a TCP port")
  const address = { port: bound.port }
  return {
    port: address.port,
    previewRequests,
    publicUrlRequests,
    signedRequests,
    signedToken,
    close: () => new Promise<void>((resolve) => {
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
  const frame = articlePage.locator("#keepout-capture-root > iframe#keepout-capture-frame")
  await expect(frame).toHaveAttribute("src", /^chrome-extension:\/\//)
  // This executes in the hostile web-page origin. It can observe the opaque
  // iframe shell, but never the extension-origin form, selection, or draft.
  const hostilePageView = await articlePage.evaluate(() => {
    const captureFrame = document.querySelector<HTMLIFrameElement>(
      "#keepout-capture-root > iframe#keepout-capture-frame",
    )
    let bodyReadable = false
    let fieldsReadable = false
    try {
      bodyReadable = Boolean(captureFrame?.contentDocument?.body)
      fieldsReadable = Boolean(captureFrame?.contentDocument?.querySelector("input, textarea"))
    } catch {
      // Cross-origin frame reads may throw in some Chromium versions.
    }
    return {
      bodyReadable,
      fieldsReadable,
      hostText: document.querySelector("#keepout-capture-root")?.textContent ?? "",
    }
  })
  expect(hostilePageView.bodyReadable).toBe(false)
  expect(hostilePageView.fieldsReadable).toBe(false)
  expect(hostilePageView.hostText).not.toContain(SELECTED_TEXT)

  const dialog = articlePage
    .frameLocator("#keepout-capture-root > iframe#keepout-capture-frame")
    .getByRole("dialog", { name: "Save to Keepout" })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("blockquote")).toHaveText(SELECTED_TEXT)
  return dialog
}

async function openCanvasCapturePanel(
  settingsPage: import("@playwright/test").Page,
  canvasPage: import("@playwright/test").Page,
) {
  const tabId = await settingsPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((candidate) => candidate.url === url)
    if (typeof tab?.id !== "number") throw new Error("Could not find the Canvas page tab")
    return tab.id
  }, canvasPage.url())
  await settingsPage.evaluate((selectedTabId) => new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "keepout/open-canvas-page", tabId: selectedTabId }, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else {
        const reply = response as { ok?: boolean; error?: string } | undefined
        if (!reply?.ok) reject(new Error(reply?.error || "Canvas panel did not open"))
        else resolve()
      }
    })
  }), tabId)
  const frame = canvasPage.locator("#keepout-capture-root > iframe#keepout-capture-frame")
  await expect(frame).toHaveAttribute("src", /^chrome-extension:\/\//)
  const hostView = await canvasPage.evaluate(() => {
    let frameText = ""
    try {
      frameText = document.querySelector<HTMLIFrameElement>("#keepout-capture-frame")?.contentDocument?.body?.textContent ?? ""
    } catch {
      // Expected: hostile Canvas content cannot read the extension frame.
    }
    return { hostText: document.querySelector("#keepout-capture-root")?.textContent ?? "", frameText }
  })
  expect(hostView.hostText).not.toContain(CANVAS_TEXT)
  expect(hostView.frameText).toBe("")
  return canvasPage
    .frameLocator("#keepout-capture-root > iframe#keepout-capture-frame")
    .getByRole("dialog", { name: "Save to Keepout" })
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
    await articlePage.setViewportSize({ width: 1280, height: 720 })
    await articlePage.goto(`http://127.0.0.1:${keepout.port}/article`)
    await articlePage.evaluate(() => {
      const captured: string[] = []
      document.addEventListener("keydown", (event) => captured.push(event.key), true)
      ;(window as Window & { __keepoutHostKeys?: string[] }).__keepoutHostKeys = captured
    })
    const dialog = await openCapturePanel(settingsPage, articlePage)
    await dialog.getByLabel("Note title").fill("A durable title")
    await dialog.getByLabel("Margin note").pressSequentially("A private marginal observation")
    const hostKeys = await articlePage.evaluate(
      () => (window as Window & { __keepoutHostKeys?: string[] }).__keepoutHostKeys ?? [],
    )
    expect(hostKeys).toEqual([])

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

test("imports a rendered Canvas page and its authenticated raster image only after extension-origin confirmation", async ({
  context,
  openSidepanel,
}) => {
  const keepout = await startKeepoutServer()
  try {
    const settingsPage = await openSidepanel()
    await configureKeepout(settingsPage, keepout.port)
    const canvasPage = await context.newPage()
    await canvasPage.goto(`http://127.0.0.1:${keepout.port}/courses/42/pages/lesson`)
    const dialog = await openCanvasCapturePanel(settingsPage, canvasPage)

    await expect(dialog.getByRole("heading", { name: "Save Canvas page to Keepout" })).toBeVisible()
    await expect(dialog.locator("pre")).toContainText(CANVAS_MARKDOWN_TEXT)
    await expect(dialog.locator("pre")).toContainText(CANVAS_NESTED_MARKDOWN_TEXT)
    await expect(dialog.getByText("1 image will be imported with this page.")).toBeVisible()
    await dialog.getByLabel("Note title").fill("Canvas import title")
    await dialog.getByLabel("Margin note").fill("Review this lesson")
    await dialog.getByRole("button", { name: "Save to Keepout", exact: true }).click()

    await expect.poll(() => keepout.pageCaptures).toHaveLength(1)
    const submitted = keepout.pageCaptures[0]
    expect(submitted.authorization).toBe(`Bearer ${TOKEN}`)
    expect(submitted.body).toMatchObject({
      version: 1,
      title: "Canvas import title",
      sourceUrl: `http://127.0.0.1:${keepout.port}/courses/42/pages/lesson`,
      marginNote: "Review this lesson",
      markdown: expect.stringContaining(CANVAS_MARKDOWN_TEXT),
    })
    const body = submitted.body as { images?: Array<{ mimeType?: string; dataBase64?: string }>; markdown?: string }
    expect(body.markdown).toContain(CANVAS_NESTED_MARKDOWN_TEXT)
    expect(body.markdown).not.toContain("Canvas body text that must stay inside the extension confirmation frame\\.")
    expect(body.images).toHaveLength(1)
    expect(body.images?.[0]).toMatchObject({ mimeType: "image/png", dataBase64: TWO_BY_TWO_PNG })
    expect(body.markdown).toContain("keepout-capture-image://")
    await expect(dialog.getByRole("status")).toHaveText(/Saved to Keepout · Canvas page/i)
  } finally {
    await keepout.close()
  }
})

test("resolves authenticated Canvas file APIs to signed downloads without persisting credentials", async ({
  context,
  openSidepanel,
}) => {
  const keepout = await startKeepoutServer()
  const canvas = await startAuthenticatedCanvasServer()
  try {
    const settingsPage = await openSidepanel()
    await configureKeepout(settingsPage, keepout.port)
    const canvasPage = await context.newPage()
    await canvasPage.goto(`http://localhost:${canvas.port}/courses/42/pages/lesson`)
    await canvasPage.waitForLoadState("networkidle")
    // The browser may independently try to render the source preview URLs as
    // it parses the page. Those requests are intentionally hostile to a fetch
    // client, so only assert that the capture flow does not add any of its own.
    const previewsBeforeCapture = canvas.previewRequests.length
    const dialog = await openCanvasCapturePanel(settingsPage, canvasPage)

    await expect(dialog.getByText("4 images will be imported with this page.")).toBeVisible()
    // Opening the confirmation frame only stages private data; it must not
    // issue a Keepout write until the extension-origin Save button is clicked.
    expect(keepout.pageCaptures).toHaveLength(0)
    expect(canvas.previewRequests).toHaveLength(previewsBeforeCapture)
    expect(canvas.publicUrlRequests).toHaveLength(4)
    expect(canvas.publicUrlRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: "101", cookie: expect.stringContaining("canvas_session=authenticated"), secFetchSite: "same-origin" }),
      expect.objectContaining({ fileId: "102", cookie: expect.stringContaining("canvas_session=authenticated"), secFetchSite: "same-origin" }),
      expect.objectContaining({ fileId: "103", cookie: expect.stringContaining("canvas_session=authenticated"), secFetchSite: "same-origin" }),
      expect.objectContaining({ fileId: "104", cookie: expect.stringContaining("canvas_session=authenticated"), secFetchSite: "same-origin" }),
    ]))
    expect(canvas.signedRequests).toHaveLength(4)

    await dialog.getByRole("button", { name: "Save to Keepout", exact: true }).click()
    await expect.poll(() => keepout.pageCaptures).toHaveLength(1)
    const saved = keepout.pageCaptures[0].body as {
      images?: Array<{ mimeType?: string; dataBase64?: string }>
      markdown?: string
    }
    expect(saved.images).toHaveLength(4)
    for (const image of saved.images ?? []) {
      expect(image).toMatchObject({ mimeType: "image/png", dataBase64: TWO_BY_TWO_PNG })
    }
    expect(JSON.stringify(saved)).not.toContain(canvas.signedToken)
    expect(JSON.stringify(saved)).not.toContain("canvas_session=authenticated")
    expect(saved.markdown).not.toContain("signed-download")
    expect(saved.markdown).not.toContain("preview")
  } finally {
    await canvas.close()
    await keepout.close()
  }
})

test("rejects a Canvas image when its authenticated public URL is denied without saving a partial page", async ({
  context,
  openSidepanel,
}) => {
  const keepout = await startKeepoutServer()
  const canvas = await startAuthenticatedCanvasServer({ denyPublicUrl: true })
  try {
    const settingsPage = await openSidepanel()
    await configureKeepout(settingsPage, keepout.port)
    const canvasPage = await context.newPage()
    await canvasPage.goto(`http://localhost:${canvas.port}/courses/42/pages/lesson`)
    const response = await settingsPage.evaluate((url) => new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
      chrome.tabs.query({}, (tabs) => {
        const tab = tabs.find((candidate) => candidate.url === url)
        if (typeof tab?.id !== "number") return reject(new Error("Could not find denied Canvas page tab"))
        chrome.runtime.sendMessage({ type: "keepout/open-canvas-page", tabId: tab.id }, (reply) => {
          const error = chrome.runtime.lastError
          if (error) reject(new Error(error.message))
          else resolve(reply as { ok?: boolean; error?: string })
        })
      })
    }), canvasPage.url())
    expect(response.ok).toBe(false)
    expect(response.error).toMatch(/Could not import image|HTTP 403|Nothing has been saved/i)
    await expect(canvasPage.locator("#keepout-capture-root > iframe#keepout-capture-frame")).toHaveCount(0)
    expect(keepout.pageCaptures).toHaveLength(0)
  } finally {
    await canvas.close()
    await keepout.close()
  }
})
