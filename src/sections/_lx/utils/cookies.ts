export interface CookieInsightInput {
  name: string
  value?: string
  domain: string
  path?: string
  secure: boolean
  httpOnly: boolean
  sameSite?: string
  expirationDate?: number
  hostOnly?: boolean
}

export type CookieCategory =
  | "Auth/session"
  | "Analytics"
  | "Marketing"
  | "A/B testing"
  | "Preference"
  | "Unknown"

export type CookieRisk = "low" | "medium" | "high"

export interface CookieInsight {
  category: CookieCategory
  risk: CookieRisk
  scopeLabel: string
  scopeDescription: string
  sendingLabel: string
  sendingDescription: string
  persistenceLabel: string
  recommendation: string
}

const marketingPatterns = [
  /(^|[_-])gcl/i,
  /(^|[_-])fbp/i,
  /(^|[_-])fbc/i,
  /^fr$/i,
  /^ttp$/i,
  /ttclid/i,
  /li_fat_id/i,
  /doubleclick/i,
  /googleads/i,
  /adservice/i,
  /adsystem/i,
  /criteo/i,
  /tapad/i,
  /campaign/i,
  /remarket/i,
  /retarget/i
]

const analyticsPatterns = [
  /^_ga/i,
  /^_gid$/i,
  /^_gat/i,
  /^_pk_/i,
  /^_hj/i,
  /^_clck$/i,
  /^_clsk$/i,
  /^_ym/i,
  /amplitude/i,
  /mixpanel/i,
  /segment/i,
  /posthog/i,
  /plausible/i,
  /umami/i,
  /hotjar/i,
  /clarity/i,
  /analytics/i
]

const authPatterns = [
  /(^|[_-])session/i,
  /(^|[_-])sess/i,
  /(^|[_-])sid$/i,
  /auth/i,
  /token/i,
  /csrf/i,
  /xsrf/i,
  /jwt/i,
  /remember/i,
  /logged/i,
  /login/i
]

const experimentPatterns = [
  /(^|[_-])ab($|[_-])/i,
  /experiment/i,
  /variant/i,
  /split/i,
  /bucket/i,
  /optimizely/i,
  /vwo/i,
  /launchdarkly/i,
  /feature[_-]?flag/i
]

const preferencePatterns = [
  /pref/i,
  /theme/i,
  /locale/i,
  /language/i,
  /consent/i,
  /settings/i,
  /timezone/i,
  /currency/i
]

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value))
}

export function normalizeCookieDomain(domain: string) {
  return domain.replace(/^\./, "").toLowerCase()
}

export function cookieMatchesHost(cookie: Pick<CookieInsightInput, "domain" | "hostOnly">, hostname: string) {
  const normalizedDomain = normalizeCookieDomain(cookie.domain)
  const normalizedHost = hostname.toLowerCase()

  if (cookie.hostOnly) return normalizedHost === normalizedDomain

  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`)
}

export function classifyCookie(cookie: CookieInsightInput): CookieCategory {
  const normalized = `${cookie.name} ${normalizeCookieDomain(cookie.domain)}`.toLowerCase()

  if (matchesAny(normalized, marketingPatterns)) return "Marketing"
  if (matchesAny(normalized, analyticsPatterns)) return "Analytics"
  if (matchesAny(normalized, authPatterns)) return "Auth/session"
  if (matchesAny(normalized, experimentPatterns)) return "A/B testing"
  if (matchesAny(normalized, preferencePatterns)) return "Preference"

  return "Unknown"
}

function isPersistent(cookie: CookieInsightInput) {
  return typeof cookie.expirationDate === "number"
}

function sameSiteStatus(cookie: CookieInsightInput) {
  return cookie.sameSite || "unspecified"
}

export function sameSiteLabel(cookie: CookieInsightInput) {
  const sameSite = sameSiteStatus(cookie)
  if (sameSite === "no_restriction") return "SameSite=None"
  if (sameSite === "strict") return "SameSite=Strict"
  if (sameSite === "lax") return "SameSite=Lax"
  return "SameSite default"
}

export function analyzeCookie(cookie: CookieInsightInput): CookieInsight {
  const category = classifyCookie(cookie)
  const persistent = isPersistent(cookie)
  const domainCookie = !cookie.hostOnly
  const sameSite = sameSiteStatus(cookie)
  const crossSiteCapable = sameSite === "no_restriction"

  let risk: CookieRisk = "low"
  if (category === "Marketing") {
    risk = crossSiteCapable || persistent || domainCookie ? "high" : "medium"
  } else if (category === "Analytics") {
    risk = crossSiteCapable || (persistent && domainCookie) ? "high" : "medium"
  } else if (category === "A/B testing") {
    risk = persistent || domainCookie ? "medium" : "low"
  } else if (category === "Auth/session") {
    risk = crossSiteCapable ? "medium" : "low"
  } else if (category === "Preference") {
    risk = crossSiteCapable && persistent ? "medium" : "low"
  } else if (crossSiteCapable && persistent) {
    risk = "high"
  } else if (persistent && domainCookie) {
    risk = "medium"
  }

  const scopeLabel = cookie.hostOnly ? "Host-only" : "Domain + subdomains"
  const scopeDescription = cookie.hostOnly
    ? "Only the exact host that set this cookie can receive it."
    : "This domain and its subdomains can receive this cookie."

  let sendingLabel = "Limited cross-site use"
  let sendingDescription =
    "Other sites cannot read this value directly. Modern browsers usually limit when it is sent outside this site."

  if (sameSite === "no_restriction") {
    sendingLabel = "Third-party capable"
    sendingDescription =
      "Other sites cannot read this value directly, but embedded requests to this company can include it in third-party contexts after you allow that company from the permission popup."
  } else if (sameSite === "strict") {
    sendingLabel = "Same-site only"
    sendingDescription = "Only same-site requests should include this cookie."
  } else if (sameSite === "lax") {
    sendingLabel = "Mostly first-party"
    sendingDescription =
      "Same-site requests and top-level navigation can include this cookie; embedded third-party requests are limited."
  }

  const persistenceLabel = persistent ? "Persistent" : "Session"

  let recommendation =
    "Unknown purpose. Review the name, domain, and expiration before deleting it."

  if (category === "Auth/session") {
    recommendation =
      "Usually worth keeping for sites you sign in to, unless it is third-party capable or from a domain you do not trust."
  } else if (category === "Preference") {
    recommendation = "Usually safe to keep if it saves a setting you want."
  } else if (category === "A/B testing") {
    recommendation =
      "Usually safe to remove; the site may put you into a new experiment group next visit."
  } else if (category === "Analytics") {
    recommendation =
      "Consider removing if you do not want visit analytics to persist across sessions."
  } else if (category === "Marketing") {
    recommendation =
      "Good removal candidate when persistent or third-party capable; these often support ad attribution or retargeting."
  }

  return {
    category,
    risk,
    scopeLabel,
    scopeDescription,
    sendingLabel,
    sendingDescription,
    persistenceLabel,
    recommendation
  }
}
