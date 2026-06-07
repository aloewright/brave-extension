// Verifies a Cloudflare Access SSO JWT (Cf-Access-Jwt-Assertion) against the
// team's JWKS. Returns the verified identity (email/sub) or null. Uses Web
// Crypto only — no node deps — so it runs in the Worker. JWKS is fetched from
// https://<team>/cdn-cgi/access/certs and cached in module memory.

interface AccessIdentity {
  sub: string
  email?: string
}

interface Jwk {
  kid: string
  kty: string
  n: string
  e: string
  alg?: string
}

let jwksCache: { domain: string; keys: Jwk[]; fetchedAt: number } | null = null
const JWKS_TTL_MS = 60 * 60 * 1000

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4))
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  if (
    jwksCache &&
    jwksCache.domain === teamDomain &&
    Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys
  }
  try {
    const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
    if (!res.ok) return []
    const body = (await res.json()) as { keys: Jwk[] }
    jwksCache = { domain: teamDomain, keys: body.keys ?? [], fetchedAt: Date.now() }
    return jwksCache.keys
  } catch {
    return []
  }
}

export async function verifyAccessJwt(
  token: string,
  expectedAud: string,
  teamDomain: string
): Promise<AccessIdentity | null> {
  if (!token) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null

  let header: { kid?: string; alg?: string }
  let payload: {
    aud?: string | string[]
    exp?: number
    iss?: string
    sub?: string
    email?: string
  }
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]!)))
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!)))
  } catch {
    return null
  }

  if (payload.exp && payload.exp * 1000 < Date.now()) return null
  const auds = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : []
  if (!auds.includes(expectedAud)) return null
  if (payload.iss && payload.iss !== `https://${teamDomain}`) return null

  const jwks = await getJwks(teamDomain)
  const jwk = jwks.find((k) => k.kid === header.kid)
  if (!jwk) return null

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    )
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const sig = b64urlToBytes(parts[2]!)
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed)
    if (!ok) return null
  } catch {
    return null
  }

  return { sub: payload.sub ?? payload.email ?? "unknown", email: payload.email }
}
