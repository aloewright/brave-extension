import type { Context, MiddlewareHandler } from "hono"
import type { Env } from "./env"
import { verifyAccessJwt } from "./access-jwt"

type Vars = { userId: string }

/**
 * Dual-mode Cloudflare Access auth:
 *  - Service token: CF-Access-Client-Id / CF-Access-Client-Secret matched
 *    (constant-time) against ACCESS_CLIENT_ID / ACCESS_CLIENT_SECRET. Used by
 *    the sidebar extension. userId = the client id.
 *  - SSO JWT: Cf-Access-Jwt-Assertion verified against the team JWKS. Used by
 *    the web UI. userId = the verified email/sub.
 * /api/health is allow-listed.
 */
export function requireAccess(): MiddlewareHandler<{ Bindings: Env; Variables: Vars }> {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next()

    // 1. Service token
    const cid = c.req.header("cf-access-client-id")
    const csec = c.req.header("cf-access-client-secret")
    if (cid && csec) {
      const wantId = c.env.ACCESS_CLIENT_ID ?? ""
      const wantSec = c.env.ACCESS_CLIENT_SECRET ?? ""
      if (wantId && wantSec && timingSafeEqual(cid, wantId) && timingSafeEqual(csec, wantSec)) {
        c.set("userId", cid)
        return next()
      }
      return unauthorized(c)
    }

    // 2. SSO JWT
    const jwt = c.req.header("cf-access-jwt-assertion")
    if (jwt && c.env.ACCESS_AUD && c.env.ACCESS_TEAM_DOMAIN) {
      const id = await verifyAccessJwt(jwt, c.env.ACCESS_AUD, c.env.ACCESS_TEAM_DOMAIN)
      if (id) {
        c.set("userId", id.email ?? id.sub)
        return next()
      }
    }

    return unauthorized(c)
  }
}

function unauthorized(c: Context) {
  return c.json({ error: { code: "unauthorized", message: "Access denied" } }, 401)
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const len = Math.max(ea.length, eb.length)
  let mismatch = ea.length !== eb.length ? 1 : 0
  for (let i = 0; i < len; i++) mismatch |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return mismatch === 0
}
