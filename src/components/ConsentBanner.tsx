import { useState } from "react"
import { useConsentRequests } from "../hooks/useConsentRequests"
import type { ConsentRequest } from "../hooks/useConsentRequests"

/**
 * Consent banner (ALO-250, M7).
 *
 * Mounted at the top of the sidepanel. Renders the oldest pending tool
 * consent request with Allow / Deny buttons and a session-remember
 * checkbox. Subsequent requests queue up behind it. When no requests
 * are pending the banner renders nothing.
 */

function summariseArgs(toolName: string, args: any): string {
  if (!args || typeof args !== "object") return ""
  const trim = (s: unknown, n = 40) =>
    typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : ""

  switch (toolName) {
    case "click":
    case "scroll_to":
    case "wait_for_selector":
    case "screenshot_element":
    case "query_selector":
    case "get_dom":
      return trim(args.selector ?? args.css)
    case "type": {
      const sel = trim(args.selector, 30)
      const txt = trim(args.text, 30)
      return [sel, txt && `"${txt}"`].filter(Boolean).join(" ")
    }
    case "bookmarks_create":
      return [trim(args.title, 30), trim(args.url, 50)].filter(Boolean).join(" — ")
    case "bookmarks_remove":
    case "bookmarks_move":
      return trim(args.id ?? args.bookmarkId, 30)
    case "links_add":
      return [trim(args.title, 30), trim(args.url, 50)].filter(Boolean).join(" — ")
    case "links_remove":
      return trim(args.id, 30)
    case "extensions_set_enabled":
      return `${trim(args.id, 20)} → ${args.enabled ? "on" : "off"}`
    case "extensions_uninstall":
      return trim(args.id, 30)
    case "profiles_apply":
    case "groups_apply":
      return trim(args.id ?? args.profileId ?? args.groupId, 30)
    case "cookies_get":
    case "cookies_remove":
    case "cookies_clear":
      return [trim(args.url, 50), trim(args.domain, 30), trim(args.name, 20)]
        .filter(Boolean)
        .join(" ")
    case "cookies_set":
      return [trim(args.url, 50), trim(args.name, 20)].filter(Boolean).join(" ")
    case "recorder_start":
    case "recorder_stop":
      return trim(args.source ?? args.id, 30)
    default: {
      try {
        return trim(JSON.stringify(args), 80)
      } catch {
        return ""
      }
    }
  }
}

interface RowProps {
  req: ConsentRequest
  pendingCount: number
  onRespond: (decision: "allow" | "deny", remember: boolean) => void
}

function ConsentRow({ req, pendingCount, onRespond }: RowProps) {
  const [remember, setRemember] = useState(false)
  const summary = summariseArgs(req.toolName, req.args as any)
  const isAlwaysPrompt = req.toolClass === "always-prompt"

  return (
    <div className="border-b border-amber-700/40 bg-amber-900/30 text-amber-50 px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold truncate">
            {req.toolName}
            {isAlwaysPrompt && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300">
                sensitive
              </span>
            )}
          </div>
          {summary && (
            <div className="mt-0.5 text-[11px] text-amber-200 truncate">{summary}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-[11px]"
            onClick={() => onRespond("allow", remember)}
          >
            Allow
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white text-[11px]"
            onClick={() => onRespond("deny", false)}
          >
            Deny
          </button>
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {!isAlwaysPrompt ? (
          <label className="flex items-center gap-1.5 text-[11px] text-amber-100 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="accent-amber-400"
            />
            Remember for this session
          </label>
        ) : (
          <span className="text-[11px] text-amber-200/70">
            Always prompts (configurable in Settings)
          </span>
        )}
        {pendingCount > 1 && (
          <span className="text-[11px] text-amber-200/70">
            +{pendingCount - 1} more pending
          </span>
        )}
      </div>
    </div>
  )
}

export function ConsentBanner() {
  const { current, queue, respond } = useConsentRequests()
  if (!current) return null
  return (
    <ConsentRow
      req={current}
      pendingCount={queue.length}
      onRespond={(d, r) => respond(current.requestId, d, r)}
    />
  )
}

export default ConsentBanner
