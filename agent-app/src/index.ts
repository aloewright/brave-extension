import { buildApp } from "./app"

// Re-export so the [[durable_objects]] binding resolves the class.
export { ChatAgent } from "./agents/chat-agent"

// Re-export the base app builder. NOTE: importing this entry module loads
// agents, which eagerly pulls in `cloudflare:`-scheme modules the plain
// vitest/node loader cannot resolve — so unit tests import buildApp from
// "../src/app" (the agents-free module) instead of from here.
export { buildApp } from "./app"

// The ChatAgent DO is reached internally via the REST routes (stub.fetch), so
// the public Agents client/WebSocket middleware (hono-agents) is intentionally
// NOT mounted in Plan 1 — mounting it would expose `/agents/*` DO state outside
// requireAccess. A later plan needing the agents client protocol must mount it
// behind auth + per-session ownership.
const app = buildApp()

app.notFound((c) =>
  c.json({ error: { code: "not_found", message: "no such route" } }, 404)
)

export default app
