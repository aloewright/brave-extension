/**
 * Cookies MCP tool handlers (ALO-247, M5).
 *
 * All four cookies_* tools are gated behind a single consent boolean at
 * chrome.storage.local["settings.cookies.allowAll"]. M7 (ALO-250) replaces
 * this with a per-call consent prompt (the gate becomes the "remember my
 * choice" preference) — TODO below marks the swap site.
 */

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export const COOKIES_GATE_KEY = "settings.cookies.allowAll"

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}
function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

async function consentOk(): Promise<boolean> {
  // TODO(ALO-250): replace with a per-call prompt; this gate becomes the
  // "always allow" preference rather than a blanket allowlist.
  const r = await chrome.storage.local.get(COOKIES_GATE_KEY)
  return !!r?.[COOKIES_GATE_KEY]
}

const CONSENT_DENIED_MSG =
  "cookies tool requires consent (will prompt in M7)"

async function cookies_get(args: any): Promise<ToolResult> {
  if (!(await consentOk())) return err(CONSENT_DENIED_MSG)
  try {
    const filter: chrome.cookies.GetAllDetails = {}
    if (typeof args?.url === "string" && args.url) filter.url = args.url
    if (typeof args?.name === "string" && args.name) filter.name = args.name
    if (typeof args?.domain === "string" && args.domain) filter.domain = args.domain
    const list = await chrome.cookies.getAll(filter)
    return ok(JSON.stringify(list, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function cookies_set(args: any): Promise<ToolResult> {
  if (!(await consentOk())) return err(CONSENT_DENIED_MSG)
  const url = String(args?.url ?? "")
  const name = String(args?.name ?? "")
  const value = String(args?.value ?? "")
  if (!url) return err("url required")
  if (!name) return err("name required")
  try {
    const details: chrome.cookies.SetDetails = { url, name, value }
    if (typeof args?.domain === "string") details.domain = args.domain
    if (typeof args?.path === "string") details.path = args.path
    if (typeof args?.secure === "boolean") details.secure = args.secure
    if (typeof args?.httpOnly === "boolean") details.httpOnly = args.httpOnly
    if (typeof args?.sameSite === "string") {
      details.sameSite = args.sameSite as chrome.cookies.SameSiteStatus
    }
    if (typeof args?.expirationDate === "number") {
      details.expirationDate = args.expirationDate
    }
    const cookie = await chrome.cookies.set(details)
    return ok(JSON.stringify(cookie, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function cookies_remove(args: any): Promise<ToolResult> {
  if (!(await consentOk())) return err(CONSENT_DENIED_MSG)
  const url = String(args?.url ?? "")
  const name = String(args?.name ?? "")
  if (!url) return err("url required")
  if (!name) return err("name required")
  try {
    const removed = await chrome.cookies.remove({ url, name })
    return ok(JSON.stringify({ removed: !!removed, url, name }, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function cookies_clear(args: any): Promise<ToolResult> {
  if (!(await consentOk())) return err(CONSENT_DENIED_MSG)
  try {
    const filter: chrome.cookies.GetAllDetails = {}
    if (typeof args?.domain === "string" && args.domain) filter.domain = args.domain
    const list = await chrome.cookies.getAll(filter)
    let removed = 0
    for (const c of list) {
      // Reconstruct the URL chrome.cookies.remove expects. Using https when
      // the cookie is secure-only, http otherwise; either resolves the same
      // store entry server-side.
      const proto = c.secure ? "https://" : "http://"
      const host = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain
      const url = `${proto}${host}${c.path || "/"}`
      try {
        const r = await chrome.cookies.remove({ url, name: c.name })
        if (r) removed++
      } catch {
        /* skip individual failures */
      }
    }
    return ok(JSON.stringify({ removed, scanned: list.length }, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

export const COOKIES_TOOL_HANDLERS: Record<
  string,
  (args: any) => Promise<ToolResult>
> = {
  cookies_get,
  cookies_set,
  cookies_remove,
  cookies_clear
}
