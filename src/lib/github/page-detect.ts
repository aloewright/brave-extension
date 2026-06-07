// Minimal local port of github-url-detection. Pure URL/pathname predicates.

const RESERVED = new Set([
  "new", "settings", "notifications", "marketplace", "explore", "issues",
  "pulls", "search", "sponsors", "orgs", "login", "join", "about", "topics",
  "trending", "codespaces", "dashboard"
])

const parts = (url: URL) => url.pathname.split("/").filter(Boolean)

export const isDashboard = (url: URL) => parts(url).length === 0
export const isNewRepo = (url: URL) => url.pathname === "/new"

export function isRepoRoot(url: URL): boolean {
  const p = parts(url)
  return p.length === 2 && !RESERVED.has(p[0])
}

export function isRepo(url: URL): boolean {
  const p = parts(url)
  return p.length >= 2 && !RESERVED.has(p[0])
}

export const isPR = (url: URL) => /^\/[^/]+\/[^/]+\/pull\/\d+/.test(url.pathname)
export const isPRFiles = (url: URL) => /^\/[^/]+\/[^/]+\/pull\/\d+\/files\/?$/.test(url.pathname)
export const isPRConversation = (url: URL) => /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
export const isIssue = (url: URL) => /^\/[^/]+\/[^/]+\/issues\/\d+/.test(url.pathname)
export const isCommit = (url: URL) => /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]+/i.test(url.pathname)
export const isRepoSettings = (url: URL) => /^\/[^/]+\/[^/]+\/settings\/?$/.test(url.pathname)

export function isProfile(url: URL): boolean {
  const p = parts(url)
  return p.length === 1 && !RESERVED.has(p[0])
}

/** A single-file view: blob/<ref>/<path>. */
export const isSingleFile = (url: URL) => /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)
