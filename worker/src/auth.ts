import type { MiddlewareHandler } from "hono"
import type { Env } from "./env"

const DEFAULT_ISSUER = "https://auth.fly.pm"
const DEFAULT_CLIENT_ID = "txt.fly.pm"
const CLOCK_SKEW_SECONDS = 60
const JWKS_CACHE_MS = 10 * 60 * 1000
export const OAUTH_COOKIE_NAME = "txt_oauth"

interface JwtHeader {
  alg?: string
  kid?: string
  typ?: string
}

interface JwtPayload {
  iss?: string
  sub?: string
  aud?: string | string[]
  azp?: string
  exp?: number
  nbf?: number
  iat?: number
  scope?: string
}

interface Jwk {
  kty: string
  kid?: string
  alg?: string
  crv?: string
  x?: string
  y?: string
  n?: string
  e?: string
}

interface Jwks {
  keys: Jwk[]
}

type ImportKeyAlgorithm = Parameters<SubtleCrypto["importKey"]>[2]
type VerifyAlgorithm = Parameters<SubtleCrypto["verify"]>[0]

let jwksCache: { issuer: string; jwks: Jwks; expiresAt: number } | null = null

/**
 * Constant-time check of the X-Sidebar-Token header against env.SIDEBAR_TOKEN,
 * or a verified auth.fly.pm OAuth bearer token.
 * The /api/health route is allow-listed inside this middleware so callers can
 * health-check the deployed Worker without holding a token.
 */
export function requireToken(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (c.req.path === "/api/health") return next()
    const got = readPresentedToken(c.req.raw)
    const want = c.env.SIDEBAR_TOKEN ?? ""
    if ((want && timingSafeEqual(got, want)) || await verifyFlyOAuthToken(got, c.env)) {
      await next()
      return
    }
    {
      return c.json({ error: { code: "unauthorized", message: "missing or invalid token" } }, 401)
    }
  }
}

function readPresentedToken(request: Request): string {
  const sidebarToken = request.headers.get("x-sidebar-token") ?? ""
  if (sidebarToken) return sidebarToken.trim()

  const auth = request.headers.get("authorization") ?? ""
  const bearer = auth.replace(/^Bearer\s+/i, "").trim()
  if (bearer && bearer !== auth) return bearer

  const cookieToken = readCookie(request.headers.get("cookie") ?? "", OAUTH_COOKIE_NAME)
  if (cookieToken) return cookieToken

  return new URL(request.url).searchParams.get("token")?.trim() ?? ""
}

function readCookie(header: string, name: string): string {
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=")
    if (rawKey === name) return decodeURIComponent(rawValue.join("="))
  }
  return ""
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

async function verifyFlyOAuthToken(token: string, env: Env): Promise<boolean> {
  if (!token || token.split(".").length !== 3) return false
  const issuer = (env.FLY_OAUTH_ISSUER || DEFAULT_ISSUER).replace(/\/+$/, "")
  const clientId = env.FLY_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID

  try {
    const parts = token.split(".")
    if (parts.length !== 3) return false
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string]
    const header = parseJwtPart<JwtHeader>(encodedHeader)
    const payload = parseJwtPart<JwtPayload>(encodedPayload)
    if (!header.alg || !payload.iss || payload.iss.replace(/\/+$/, "") !== issuer) return false
    if (!matchesAudience(payload, clientId)) return false

    const now = Math.floor(Date.now() / 1000)
    if (typeof payload.exp !== "number" || payload.exp < now - CLOCK_SKEW_SECONDS) return false
    if (typeof payload.nbf === "number" && payload.nbf > now + CLOCK_SKEW_SECONDS) return false

    const jwk = await findJwk(issuer, header)
    if (!jwk) return false
    const key = await importJwk(jwk, header.alg)
    return await crypto.subtle.verify(
      algorithmForVerify(header.alg, jwk),
      key,
      base64UrlToBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
    )
  } catch {
    return false
  }
}

function parseJwtPart<T>(encoded: string): T {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as T
}

function matchesAudience(payload: JwtPayload, clientId: string): boolean {
  if (payload.azp === clientId) return true
  if (payload.aud === clientId) return true
  return Array.isArray(payload.aud) && payload.aud.includes(clientId)
}

async function findJwk(issuer: string, header: JwtHeader): Promise<Jwk | null> {
  const jwks = await getJwks(issuer)
  return jwks.keys.find((key) => {
    if (header.kid && key.kid && header.kid !== key.kid) return false
    return !key.alg || !header.alg || key.alg === header.alg
  }) ?? null
}

async function getJwks(issuer: string): Promise<Jwks> {
  const now = Date.now()
  if (jwksCache && jwksCache.issuer === issuer && jwksCache.expiresAt > now) return jwksCache.jwks

  const res = await fetch(`${issuer}/api/auth/jwks`, {
    headers: { accept: "application/json" },
  })
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`)

  const jwks = await res.json<Jwks>()
  jwksCache = { issuer, jwks, expiresAt: now + JWKS_CACHE_MS }
  return jwks
}

async function importJwk(jwk: Jwk, alg: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("jwk", jwk as JsonWebKey, algorithmForImport(alg, jwk), false, ["verify"])
}

function algorithmForImport(alg: string, jwk: Jwk): ImportKeyAlgorithm {
  if (alg === "EdDSA") return { name: jwk.crv === "Ed448" ? "Ed448" : "Ed25519" }
  if (alg === "RS256") return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }
  if (alg === "ES256") return { name: "ECDSA", namedCurve: "P-256" }
  throw new Error(`Unsupported JWT alg: ${alg}`)
}

function algorithmForVerify(alg: string, jwk: Jwk): VerifyAlgorithm {
  if (alg === "EdDSA") return { name: jwk.crv === "Ed448" ? "Ed448" : "Ed25519" }
  if (alg === "RS256") return { name: "RSASSA-PKCS1-v1_5" }
  if (alg === "ES256") return { name: "ECDSA", hash: "SHA-256" }
  throw new Error(`Unsupported JWT alg: ${alg}`)
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
