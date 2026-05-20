import { Hono } from "hono"
import { requireToken } from "./auth"
import conversations from "./routes/conversations"
import links from "./routes/links"
import bookmarks from "./routes/bookmarks"
import recordings from "./routes/recordings"
import pdfs from "./routes/pdfs"
import search from "./routes/search"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.route("/api/conversations", conversations)
app.route("/api/links", links)
app.route("/api/bookmarks", bookmarks)
app.route("/api/recordings", recordings)
app.route("/api/pdfs", pdfs)
app.route("/api/search", search)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
