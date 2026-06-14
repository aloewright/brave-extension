import { Hono } from "hono"
import { requireToken } from "./auth"
import conversations from "./routes/conversations"
import links from "./routes/links"
import bookmarks from "./routes/bookmarks"
import captures from "./routes/captures"
import agent from "./routes/agent"
import categorize from "./routes/categorize"
import recordings from "./routes/recordings"
import videos from "./routes/videos"
import pdfs from "./routes/pdfs"
import highlights from "./routes/highlights"
import extensions from "./routes/extensions"
import notes from "./routes/notes"
import search from "./routes/search"
import tts from "./routes/tts"
import scrapes, { runDueScrapeJobs } from "./routes/scrapes"
import newtab from "./routes/newtab"
import type { Env } from "./env"

// Re-exported so the [[workflows]] binding can resolve the class.
export { IngestWorkflow } from "./workflows/ingest"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.route("/api/conversations", conversations)
app.route("/api/links", links)
app.route("/api/bookmarks", bookmarks)
app.route("/api/bookmarks/categorize", categorize)
app.route("/api/captures", captures)
app.route("/api/agent", agent)
app.route("/api/recordings", recordings)
app.route("/api/videos", videos)
app.route("/api/pdfs", pdfs)
app.route("/api/highlights", highlights)
app.route("/api/extensions", extensions)
app.route("/api/notes", notes)
app.route("/api/search", search)
app.route("/api/tts", tts)
app.route("/api/scrapes", scrapes)
app.route("/api/newtab", newtab)

app.notFound((c) => {
  // For /api/* paths, return the JSON 404. For everything else, hand off to
  // the static-assets binding so the SPA can claim the path (with
  // not_found_handling="single-page-application" falling back to index.html
  // for client-side routes).
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "not_found", message: "no such route" } }, 404)
  }
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw)
  }
  return c.json({ error: { code: "not_found", message: "no such route" } }, 404)
})

type ScheduledHonoApp = typeof app & {
  scheduled: ExportedHandlerScheduledHandler<Env>
}

const worker = app as ScheduledHonoApp
worker.scheduled = async (_controller, env, ctx) => {
  ctx.waitUntil(runDueScrapeJobs(env).catch((err) => {
    console.warn("scrape cron failed", err)
  }))
}

export default worker
