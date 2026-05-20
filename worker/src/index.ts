import { Hono } from "hono"
import { requireToken } from "./auth"
import type { Env } from "./env"

const app = new Hono<{ Bindings: Env }>()

app.use("/api/*", requireToken())

app.get("/api/health", (c) =>
  c.json({ ok: true, version: "0.1.0", deployedAt: new Date().toISOString() })
)

app.notFound((c) => c.json({ error: { code: "not_found", message: "no such route" } }, 404))

export default app
