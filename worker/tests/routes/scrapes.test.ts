import { afterEach, describe, expect, it, vi } from "vitest"
import app from "../../src/index"
import { runDueScrapeJobs } from "../../src/routes/scrapes"
import { makeEnv } from "../helpers"

function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("x-sidebar-token", "test-token")
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
  return new Request(`http://x${path}`, { ...init, headers })
}

describe("scrape routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("stores an extension-provided current-page scrape", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      req("/api/scrapes", {
        method: "POST",
        body: JSON.stringify({
          source: "extension",
          url: "https://example.com/page#section",
          title: "Example Page",
          text: "Example readable body",
          html: "<main>Example readable body</main>",
          links: [{ href: "https://example.com/a", text: "A" }],
          images: [{ src: "https://example.com/a.png", alt: "A" }],
          meta: { description: "demo" },
          timestamp: 1_700_000_000_000
        })
      }),
      env
    )

    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.scrape.status).toBe("ready")
    expect(body.scrape.source).toBe("extension")
    expect(body.scrape.chunkCount).toBeGreaterThan(0)

    const list = await app.fetch(req("/api/scrapes/runs"), env)
    const listed = await list.json() as any
    expect(listed.scrapes).toHaveLength(1)
    expect(listed.scrapes[0].title).toBe("Example Page")
  })

  it("fetches and extracts an ad hoc server-side scrape", async () => {
    const env = makeEnv()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<!doctype html>
          <html>
            <head>
              <title>Fetched Page</title>
              <meta name="description" content="Fetched description">
            </head>
            <body>
              <header>Navigation</header>
              <main><h1>Hello</h1><p>Useful body text</p><a href="/next">Next page</a></main>
              <img src="/hero.png" alt="Hero">
            </body>
          </html>`,
          { headers: { "content-type": "text/html" } }
        )
      )
    )

    const res = await app.fetch(
      req("/api/scrapes/run", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/start" })
      }),
      env
    )

    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.scrape.title).toBe("Fetched Page")
    expect(body.scrape.text).toContain("Useful body text")
    expect(body.scrape.links[0]).toEqual({ href: "https://example.com/next", text: "Next page" })
    expect(body.scrape.images[0]).toEqual({ src: "https://example.com/hero.png", alt: "Hero" })
  })

  it("runs due cron scrape jobs from the scheduled worker tick", async () => {
    const env = makeEnv()
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html><head><title>Cron Page</title></head><body>Cron body</body></html>", {
          headers: { "content-type": "text/html" }
        })
      )
    )

    const create = await app.fetch(
      req("/api/scrapes/jobs", {
        method: "POST",
        body: JSON.stringify({
          url: "https://example.com/cron",
          title: "Cron",
          scheduleType: "cron",
          cron: "* * * * *"
        })
      }),
      env
    )
    expect(create.status).toBe(201)

    const created = await create.json() as any
    await env.DB.prepare("UPDATE scrape_jobs SET next_run_at = ? WHERE id = ?")
      .bind(Date.now() - 1, created.job.id)
      .run()

    await expect(runDueScrapeJobs(env)).resolves.toEqual({ ran: 1 })

    const jobs = await app.fetch(req("/api/scrapes/jobs"), env)
    const listedJobs = await jobs.json() as any
    expect(listedJobs.jobs[0].lastStatus).toBe("ready")
    expect(listedJobs.jobs[0].lastRunId).toBeTruthy()

    const runs = await app.fetch(req(`/api/scrapes/runs?jobId=${created.job.id}`), env)
    const listedRuns = await runs.json() as any
    expect(listedRuns.scrapes).toHaveLength(1)
    expect(listedRuns.scrapes[0].title).toBe("Cron Page")
  })
})
