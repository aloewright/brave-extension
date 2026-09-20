import { expect, test } from "./_fixtures"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const VIDEO_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  0x65, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74, 0x65, 0x64,
])

type KeepoutRequest = { path: string; body?: unknown; bytes?: Buffer; authorization?: string; nonce?: string }

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part))
  return Buffer.concat(parts)
}

async function startSyntheticCanvasAndKeepout() {
  const keepoutRequests: KeepoutRequest[] = []
  const canvasRequests: Array<{ path: string; cookie?: string; site?: string }> = []
  const token = "e2e-loopback-token"
  const uploadNonce = "10000000-0000-4000-8000-000000000001"
  const signedToken = "never-store-this-signed-token"
  let canvasPort = 0
  const keepout = createServer(async (request, response) => {
    const body = await readBody(request)
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
    keepoutRequests.push({
      path,
      authorization: request.headers.authorization,
      nonce: request.headers["x-keepout-upload"] as string | undefined,
      ...(body.length ? { bytes: body } : {}),
      ...(request.headers["content-type"] === "application/json" && body.length ? { body: JSON.parse(body.toString("utf8")) } : {}),
    })
    if (request.headers.authorization !== `Bearer ${token}`) return response.writeHead(401).end()
    if (request.method === "POST" && path === "/v1/page-captures") {
      const capture = JSON.parse(body.toString("utf8")) as { id: string }
      return response.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ id: capture.id, createdAt: "2026-09-20T00:00:00Z" }))
    }
    if (request.method === "POST" && path === "/v1/page-videos") {
      const input = JSON.parse(body.toString("utf8")) as { id: string }
      return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: input.id, chunkBytes: 1_048_576, uploadNonce, index: 0 }))
    }
    if (request.method === "POST" && /^\/v1\/page-videos\/[0-9a-f-]+\/chunks$/.test(path)) return response.writeHead(200).end()
    if (request.method === "POST" && /^\/v1\/page-videos\/[0-9a-f-]+\/complete$/.test(path)) return response.writeHead(200, { "content-type": "application/json" }).end("{}")
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => keepout.listen(0, "127.0.0.1", resolve))
  const keepoutAddress = keepout.address()
  if (!keepoutAddress || typeof keepoutAddress === "string" || keepoutAddress.port < 1024) throw new Error("Keepout test server needs a loopback high port")

  const canvas = createServer((request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    canvasRequests.push({ path: url.pathname, cookie: request.headers.cookie, site: request.headers["sec-fetch-site"] as string | undefined })
    if (url.pathname === "/courses/42/pages/lesson") {
      response.setHeader("set-cookie", "canvas_session=signed-in; Path=/; SameSite=Lax")
      response.setHeader("content-type", "text/html; charset=utf-8")
      response.end(`<!doctype html><main id="wiki_page_show"><h1 class="page-title">Encrypted video lesson</h1><div class="show-content user_content"><a download href="/courses/42/files/123/download">Lecture.mp4</a><a download href="/courses/42/files/124/download">Broken.mp4</a></div></main>`)
      return
    }
    if (url.pathname === "/api/v1/files/123/public_url" || url.pathname === "/api/v1/files/124/public_url") {
      const file = url.pathname.includes("123") ? "123" : "124"
      if (!request.headers.cookie?.includes("canvas_session=signed-in") || request.headers["sec-fetch-site"] !== "same-origin") return response.writeHead(403).end()
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ public_url: `http://127.0.0.1:${canvasPort}/signed/${file}?token=${signedToken}` }))
      return
    }
    if (url.pathname === "/signed/123") {
      if (url.searchParams.get("token") !== signedToken || request.headers.cookie) return response.writeHead(403).end()
      return response.writeHead(200, { "content-type": "video/mp4", "content-length": VIDEO_BYTES.length }).end(VIDEO_BYTES)
    }
    if (url.pathname === "/signed/124") return response.writeHead(200, { "content-type": "text/html" }).end("<html>sign in</html>")
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve) => canvas.listen(0, "127.0.0.1", resolve))
  const canvasAddress = canvas.address()
  if (!canvasAddress || typeof canvasAddress === "string" || canvasAddress.port < 1024) throw new Error("Canvas test server needs a loopback high port")
  canvasPort = canvasAddress.port
  return {
    canvasPort,
    keepoutPort: keepoutAddress.port,
    token,
    keepoutRequests,
    canvasRequests,
    close: async () => {
      canvas.closeAllConnections(); keepout.closeAllConnections()
      await Promise.all([new Promise<void>((resolve) => canvas.close(() => resolve())), new Promise<void>((resolve) => keepout.close(() => resolve()))])
    },
  }
}

async function tabID(extensionPage: import("@playwright/test").Page, url: string): Promise<number> {
  return extensionPage.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === target)
    if (typeof tab?.id !== "number") throw new Error("Canvas test tab was not found")
    return tab.id
  }, url)
}

test("saves an authenticated Canvas video through encrypted loopback upload without a browser download", async ({ context, openSidepanel }) => {
  const servers = await startSyntheticCanvasAndKeepout()
  try {
    const extensionPage = await openSidepanel()
    await extensionPage.evaluate(async ({ port, token }) => {
      await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      await chrome.storage.local.set({ "keepout.connection.port": port })
      await chrome.storage.session.set({ "keepout.connection.token": token })
    }, { port: servers.keepoutPort, token: servers.token })
    const downloadsBefore = await extensionPage.evaluate(() => chrome.downloads.search({}))

    const canvasPage = await context.newPage()
    await canvasPage.goto(`http://localhost:${servers.canvasPort}/courses/42/pages/lesson`)
    const opened = await extensionPage.evaluate((id) => new Promise<unknown>((resolve) => chrome.runtime.sendMessage({ type: "keepout/open-canvas-page", tabId: id }, resolve)), await tabID(extensionPage, canvasPage.url()))
    expect(opened).toMatchObject({ ok: true })
    const dialog = canvasPage.frameLocator("#keepout-capture-root > iframe#keepout-capture-frame").getByRole("dialog", { name: "Save to Keepout" })
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Save in Keepout", exact: true }).first().click()
    await expect(dialog.getByText(/Saved in Keepout.*bytes encrypted/i)).toBeVisible({ timeout: 10_000 })

    const pageSaves = servers.keepoutRequests.filter((request) => request.path === "/v1/page-captures")
    const starts = servers.keepoutRequests.filter((request) => request.path === "/v1/page-videos")
    const chunks = servers.keepoutRequests.filter((request) => request.path.endsWith("/chunks"))
    expect(pageSaves).toHaveLength(1)
    expect(starts).toHaveLength(1)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].bytes).toEqual(VIDEO_BYTES)
    expect(starts[0].body).toMatchObject({ id: expect.any(String), captureID: (pageSaves[0].body as { id: string }).id, contentType: "video/mp4" })
    expect(chunks[0].path).toBe(`/v1/page-videos/${(starts[0].body as { id: string }).id}/chunks`)
    expect(JSON.stringify(servers.keepoutRequests)).not.toContain("never-store-this-signed-token")
    expect(JSON.stringify(starts[0].body)).not.toMatch(/(?:url|sourceUrl|signed)/i)
    expect(servers.canvasRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/api/v1/files/123/public_url", cookie: expect.stringContaining("canvas_session=signed-in"), site: "same-origin" }),
    ]))
    expect(await extensionPage.evaluate(() => chrome.downloads.search({}))).toEqual(downloadsBefore)

    await dialog.getByRole("button", { name: "Save in Keepout", exact: true }).nth(1).click()
    await expect(dialog.getByText("Canvas returned a sign-in or preview page, not a video. Open the video in Canvas and try again.")).toBeVisible({ timeout: 10_000 })
    expect(servers.keepoutRequests.filter((request) => request.path === "/v1/page-captures")).toHaveLength(1)
  } finally {
    await servers.close()
  }
})
