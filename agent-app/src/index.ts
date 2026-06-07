import { agentsMiddleware } from "hono-agents"
import { buildApp } from "./app"

// Re-export so the [[durable_objects]] binding resolves the class.
export { ChatAgent } from "./agents/chat-agent"

// Re-export the base app builder. NOTE: importing this entry module loads
// agents/hono-agents, which eagerly pull in `cloudflare:`-scheme modules the
// plain vitest/node loader cannot resolve — so unit tests import buildApp from
// "../src/app" (the agents-free module) instead of from here.
export { buildApp } from "./app"

// Deployed Worker: layer the Agents SDK middleware (WebSocket upgrades +
// /agents/* routing) on top of the base app. Kept out of buildApp() so the base
// app stays hermetic. agentsMiddleware is a named export of hono-agents@3.0.11
// (verified against node_modules types).
const app = buildApp()
app.use("*", agentsMiddleware())

app.notFound((c) =>
  c.json({ error: { code: "not_found", message: "no such route" } }, 404)
)

export default app
