import { Hono } from "hono"
import { requireAccess } from "./auth"
import sessions from "./routes/sessions"
import models from "./routes/models"
import type { Env } from "./env"

type Vars = { userId: string }

// The base REST app. Deliberately free of any `agents` / `hono-agents` imports
// so it can be imported and exercised from plain vitest (which cannot load the
// `cloudflare:` modules those packages pull in at module-eval time). The deployed
// Worker entry (src/index.ts) layers agentsMiddleware + the ChatAgent DO export
// on top of this.
export function buildApp() {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>()

  // Auth guard for our REST API.
  app.use("/api/*", requireAccess())

  app.get("/api/health", (c) =>
    c.json({ ok: true, app: "agent-app", version: "0.1.0" })
  )

  app.route("/api/sessions", sessions)
  app.route("/api", models)

  return app
}
