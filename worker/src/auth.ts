import type { MiddlewareHandler } from "hono"
import type { Env } from "./env"

/**
 * Constant-time check of the X-Sidebar-Token header against env.SIDEBAR_TOKEN.
 * The /api/health route is allow-listed inside this middleware so callers can
 * health-check the deployed Worker without holding a token.
 */
export function requireToken(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next()
    const got = c.req.header("x-sidebar-token") ?? c.req.query("token") ?? ""
    const want = c.env.SIDEBAR_TOKEN ?? ""
    if (!want || !timingSafeEqual(got, want)) {
      return c.json({ error: { code: "unauthorized", message: "missing or invalid token" } }, 401)
    }
    await next()
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}
