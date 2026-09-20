import { expect, test } from "./_fixtures"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"

// A compact ISO-base-media prefix: enough for the extension's bounded probe,
// followed by recognizable bytes so the completed Chrome download is verifiable.
const VIDEO_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  0x63, 0x61, 0x6e, 0x76, 0x61, 0x73, 0x2d, 0x65,
  0x32, 0x65, 0x2d, 0x65, 0x2d, 0x76, 0x69, 0x64,
  0x65, 0x6f,
])

type SignedRequest = { range?: string; cookie?: string }

async function startCanvasVideoServer() {
  const publicURLRequests: Array<{ cookie?: string; secFetchSite?: string }> = []
  const signedRequests: SignedRequest[] = []
  const signedToken = "canvas-video-e2e-signed-token"
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    if (url.pathname === "/courses/42/pages/lesson") {
      response.setHeader("set-cookie", "canvas_session=authenticated; Path=/; SameSite=Lax")
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(`<!doctype html><title>Canvas video lesson</title><main id="wiki_page_show"><h1 class="page-title">Video lesson</h1><div class="show-content user_content"><p>Watch the lecture.</p><a download href="/courses/42/files/123/download">Lecture.mp4</a></div></main>`)
      return
    }
    if (url.pathname === "/api/v1/files/123/public_url") {
      publicURLRequests.push({ cookie: request.headers.cookie, secFetchSite: request.headers["sec-fetch-site"] })
      if (!request.headers.cookie?.includes("canvas_session=authenticated") || request.headers["sec-fetch-site"] !== "same-origin") {
        response.writeHead(403).end()
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ public_url: `http://127.0.0.1:${address.port}/signed-download/123?session=${signedToken}` }))
      return
    }
    if (url.pathname === "/signed-download/123") {
      signedRequests.push({ range: request.headers.range, cookie: request.headers.cookie })
      if (url.searchParams.get("session") !== signedToken || request.headers.cookie) {
        response.writeHead(403).end()
        return
      }
      response.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": VIDEO_BYTES.length,
        "accept-ranges": "bytes",
      })
      response.end(VIDEO_BYTES)
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const bound = server.address()
  if (!bound || typeof bound === "string") throw new Error("Canvas video test server did not bind a TCP port")
  const address = { port: bound.port }
  return {
    port: address.port,
    publicURLRequests,
    signedRequests,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

async function canvasTabID(
  extensionPage: import("@playwright/test").Page,
  pageURL: string,
): Promise<number> {
  return extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((candidate) => candidate.url === url)
    if (typeof tab?.id !== "number") throw new Error("Could not find the Canvas test tab")
    return tab.id
  }, pageURL)
}

test("downloads an authenticated Canvas file through a signed cookie-free URL", async ({
  context,
  openSidepanel,
}) => {
  const canvas = await startCanvasVideoServer()
  let completedDownloadID: number | undefined
  let extensionPage: import("@playwright/test").Page | undefined
  try {
    extensionPage = await openSidepanel()
    await extensionPage.evaluate(() => {
      const completed: number[] = []
      Object.defineProperty(window, "__canvasVideoCompletedDownloads", { value: completed })
      chrome.downloads.onChanged.addListener((delta) => {
        if (delta.state?.current === "complete") completed.push(delta.id)
      })
    })
    const canvasPage = await context.newPage()
    // Canvas is localhost while the signed URL is 127.0.0.1: distinct origins
    // that make accidental Canvas-cookie forwarding observable in this test.
    await canvasPage.goto(`http://localhost:${canvas.port}/courses/42/pages/lesson`)
    const tabId = await canvasTabID(extensionPage, canvasPage.url())
    const opened = await extensionPage.evaluate((selectedTabId) => new Promise<{ ok?: boolean; error?: string }>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "keepout/open-canvas-page", tabId: selectedTabId }, (reply) => {
        const error = chrome.runtime.lastError
        if (error) reject(new Error(error.message))
        else resolve(reply as { ok?: boolean; error?: string })
      })
    }), tabId)
    expect(opened).toMatchObject({ ok: true })

    const dialog = canvasPage
      .frameLocator("#keepout-capture-root > iframe#keepout-capture-frame")
      .getByRole("dialog", { name: "Save to Keepout" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Download video", exact: true }).click()

    await expect.poll(() => extensionPage.evaluate(() =>
      (window as Window & typeof globalThis & { __canvasVideoCompletedDownloads: number[] }).__canvasVideoCompletedDownloads,
    )).toHaveLength(1)
    completedDownloadID = await extensionPage.evaluate(() =>
      (window as Window & typeof globalThis & { __canvasVideoCompletedDownloads: number[] }).__canvasVideoCompletedDownloads[0],
    )
    const download = await extensionPage.evaluate(async (id) => (await chrome.downloads.search({ id }))[0], completedDownloadID)
    expect(download?.state).toBe("complete")
    expect(download?.filename).toMatch(/Canvas[\\/]Lecture\.mp4$/)
    expect(await readFile(download!.filename)).toEqual(VIDEO_BYTES)

    expect(canvas.publicURLRequests).toEqual([
      expect.objectContaining({ cookie: expect.stringContaining("canvas_session=authenticated"), secFetchSite: "same-origin" }),
    ])
    // First request is the bounded Range probe; Chrome then makes the actual
    // download. Neither request may carry the authenticated Canvas cookie.
    expect(canvas.signedRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ range: "bytes=0-511", cookie: undefined }),
    ]))
    expect(canvas.signedRequests.length).toBeGreaterThanOrEqual(2)
    expect(canvas.signedRequests.every((request) => !request.cookie)).toBe(true)
  } finally {
    if (completedDownloadID !== undefined && extensionPage) {
      await extensionPage.evaluate(async (id) => {
        await chrome.downloads.removeFile(id).catch(() => {})
        await chrome.downloads.erase({ id }).catch(() => {})
      }, completedDownloadID).catch(() => {})
    }
    await canvas.close()
  }
})
