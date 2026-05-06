/**
 * Cookies MCP tool handlers (ALO-247, M5).
 *
 * Consent: from M7 (ALO-250) onwards, gating is owned by the consent FSM
 * in src/background/consent.ts. Cookies are classified `always-prompt`,
 * so every call goes through the sidepanel banner unless the user has
 * enabled the permanent allow-all override at
 * chrome.storage.local["settings.cookies.allowAll"], which the FSM reads
 * directly. The handlers here just execute the chrome.cookies API call
 * once consent is granted.
 */

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export const COOKIES_GATE_KEY = "settings.cookies.allowAll"

const VALID_SAME_SITE = new Set([
  "no_restriction",
  "lax",
  "strict",
  "unspecified"
])

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}
function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

async function cookies_get(args: any): Promise<ToolResult> {
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
    if (typeof args?.sameSite === "string" && VALID_SAME_SITE.has(args.sameSite)) {
      details.sameSite = args.sameSite as chrome.cookies.SameSiteStatus
    } else if (args?.sameSite !== undefined) {
      return err(`invalid sameSite: ${args.sameSite}`)
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
