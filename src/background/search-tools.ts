/**
 * Brave Search MCP tool handler (ALO-247, M5).
 *
 * Calls https://api.search.brave.com/res/v1/web/search with the user's
 * personal API key (no Cloudflare Gateway involved — this is a browser-side
 * direct call to a documented Brave HTTPS endpoint, not an LLM provider).
 *
 * API key lives at chrome.storage.local["settings.braveSearchApiKey"]; if
 * unset, every call returns a clear "configure API key in Settings" error.
 *
 * Result body is truncated to ~32KB to keep MCP message sizes reasonable.
 */

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export const BRAVE_API_KEY_KEY = "settings.braveSearchApiKey"
const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
const RESULT_BYTE_CAP = 32 * 1024

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}
function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

async function brave_search(args: any): Promise<ToolResult> {
  const query = String(args?.query ?? "").trim()
  if (!query) return err("query required")
  let count = Number(args?.count ?? 10)
  if (!Number.isFinite(count) || count <= 0) count = 10
  if (count > 20) count = 20

  const stored = await chrome.storage.local.get(BRAVE_API_KEY_KEY)
  const key = stored?.[BRAVE_API_KEY_KEY]
  if (typeof key !== "string" || !key) {
    return err("Brave Search API key not configured — set it in Settings.")
  }

  const url = new URL(BRAVE_ENDPOINT)
  url.searchParams.set("q", query)
  url.searchParams.set("count", String(count))

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15_000)
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: ac.signal,
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": key
      }
    })
    const text = await res.text()
    if (!res.ok) {
      return err(`Brave Search ${res.status}: ${text.slice(0, 256)}`)
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      return err("Brave Search returned non-JSON response")
    }
    let serialized = JSON.stringify(body, null, 2)
    let truncated = false
    if (serialized.length > RESULT_BYTE_CAP) {
      truncated = true
      serialized = serialized.slice(0, RESULT_BYTE_CAP) + "…[truncated]"
    }
    return ok(
      truncated
        ? `${serialized}\n\n[response truncated to ${RESULT_BYTE_CAP} bytes]`
        : serialized
    )
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return err("Brave Search timed out")
    }
    return err((e as Error).message)
  } finally {
    clearTimeout(timer)
  }
}

export const SEARCH_TOOL_HANDLERS: Record<
  string,
  (args: any) => Promise<ToolResult>
> = {
  brave_search
}
