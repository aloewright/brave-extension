import { Hono } from "hono"
import { OAUTH_COOKIE_NAME, requireToken } from "./auth"
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

const OAUTH_STATE_COOKIE = "txt_oauth_state"
const OAUTH_VERIFIER_COOKIE = "txt_oauth_verifier"
const OAUTH_ISSUER = "https://auth.fly.pm"
const OAUTH_CLIENT_ID = "txt.fly.pm"
const OAUTH_REDIRECT_PATH = "/oauth/callback"

app.get("/auth/fly/start", async (c) => {
  const issuer = oauthIssuer(c.env)
  const clientId = oauthClientId(c.env)
  const state = randomBase64Url(24)
  const verifier = randomBase64Url(64)
  const challenge = await pkceChallenge(verifier)
  const redirectUri = new URL(OAUTH_REDIRECT_PATH, c.req.url).toString()
  const authorize = new URL(`${issuer}/api/auth/oauth2/authorize`)
  authorize.searchParams.set("client_id", clientId)
  authorize.searchParams.set("redirect_uri", redirectUri)
  authorize.searchParams.set("response_type", "code")
  authorize.searchParams.set("scope", "openid profile email offline_access")
  authorize.searchParams.set("state", state)
  authorize.searchParams.set("code_challenge", challenge)
  authorize.searchParams.set("code_challenge_method", "S256")

  const headers = new Headers({ location: authorize.toString() })
  appendCookie(headers, OAUTH_STATE_COOKIE, state, { maxAge: 600, httpOnly: true })
  appendCookie(headers, OAUTH_VERIFIER_COOKIE, verifier, { maxAge: 600, httpOnly: true })
  return new Response(null, { status: 302, headers })
})

app.get(OAUTH_REDIRECT_PATH, async (c) => {
  const url = new URL(c.req.url)
  const error = url.searchParams.get("error")
  const headers = new Headers()
  clearCookie(headers, OAUTH_STATE_COOKIE)
  clearCookie(headers, OAUTH_VERIFIER_COOKIE)
  if (error) {
    headers.set("location", `/?oauth_error=${encodeURIComponent(url.searchParams.get("error_description") || error)}`)
    return new Response(null, { status: 302, headers })
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  const expectedState = readCookie(c.req.header("cookie") ?? "", OAUTH_STATE_COOKIE)
  const verifier = readCookie(c.req.header("cookie") ?? "", OAUTH_VERIFIER_COOKIE)
  if (!code || !state || !expectedState || state !== expectedState || !verifier) {
    headers.set("location", "/?oauth_error=invalid_oauth_callback")
    return new Response(null, { status: 302, headers })
  }

  const body = new URLSearchParams()
  body.set("grant_type", "authorization_code")
  body.set("client_id", oauthClientId(c.env))
  body.set("code", code)
  body.set("redirect_uri", new URL(OAUTH_REDIRECT_PATH, c.req.url).toString())
  body.set("code_verifier", verifier)

  const tokenRes = await fetch(`${oauthIssuer(c.env)}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  })
  const tokenPayload = await tokenRes.json().catch(() => null) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  } | null
  if (!tokenRes.ok || !tokenPayload?.access_token) {
    const message = tokenPayload?.error_description || tokenPayload?.error || "oauth_token_exchange_failed"
    headers.set("location", `/?oauth_error=${encodeURIComponent(message)}`)
    return new Response(null, { status: 302, headers })
  }

  appendCookie(headers, OAUTH_COOKIE_NAME, tokenPayload.access_token, {
    maxAge: Math.max(60, Math.min(tokenPayload.expires_in ?? 3600, 3600)),
    httpOnly: true
  })
  headers.set("location", "/")
  return new Response(null, { status: 302, headers })
})

app.get("/auth/fly/logout", (c) => {
  const headers = new Headers({ location: "/" })
  clearCookie(headers, OAUTH_COOKIE_NAME)
  return new Response(null, { status: 302, headers })
})

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

function oauthIssuer(env: Env): string {
  return (env.FLY_OAUTH_ISSUER || OAUTH_ISSUER).replace(/\/+$/, "")
}

function oauthClientId(env: Env): string {
  return env.FLY_OAUTH_CLIENT_ID || OAUTH_CLIENT_ID
}

function appendCookie(
  headers: Headers,
  name: string,
  value: string,
  opts: { maxAge: number; httpOnly?: boolean },
): void {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${opts.maxAge}`,
    "SameSite=Lax",
    "Secure",
  ]
  if (opts.httpOnly) parts.push("HttpOnly")
  headers.append("set-cookie", parts.join("; "))
}

function clearCookie(headers: Headers, name: string): void {
  headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure; HttpOnly`)
}

function readCookie(header: string, name: string): string {
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=")
    if (rawKey === name) return decodeURIComponent(rawValue.join("="))
  }
  return ""
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return bytesToBase64Url(new Uint8Array(digest))
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}
