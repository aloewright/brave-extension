/**
 * Tool consent classification (ALO-250, M7).
 *
 * Single source of truth mapping every MCP tool registered in
 * native-host/mcp-server.mjs (and tool-defs/*) to a consent class:
 *
 *   - "read"          : auto-allow, no prompt
 *   - "write"         : prompt per call, with "remember for this session"
 *   - "gated"         : binary Settings flag (eval_js, extensions_uninstall)
 *   - "always-prompt" : prompt every call (cookies). Optional permanent
 *                       allow-all override lives in Settings.
 *
 * Unknown tools default to "write" for safety. Update this map alongside
 * any new tool registration.
 *
 * Tool count: 41 total
 *   read          : 20  (DOM reads, references, library reads incl.
 *                        captures_list/get, chrome reads, recorder reads,
 *                        tabs_list, brave_search, echo)
 *   write         : 15  (DOM mutations, clear_references, library writes,
 *                        chrome mutations, recorder controls)
 *   gated         : 2   (eval_js, extensions_uninstall)
 *   always-prompt : 4   (cookies_*)
 */

export type ToolClass = "read" | "write" | "gated" | "always-prompt"

const READ_TOOLS: string[] = [
  // DOM
  "browser_observe",
  "query_selector",
  "get_dom",
  "screenshot",
  "screenshot_element",
  "wait_for_selector",
  // Reference tools (host-side reads)
  "list_references",
  "get_reference",
  // Library reads
  "bookmarks_search",
  "links_list",
  "captures_list",
  "captures_get",
  // Chrome reads
  "extensions_list",
  "profiles_list",
  "groups_list",
  // Recorder reads
  "recorder_list",
  "recorder_get",
  // Tabs / search reads
  "tabs_list",
  "brave_search",
  // Sanity
  "echo"
]

const WRITE_TOOLS: string[] = [
  // DOM mutations
  "click",
  "type",
  "scroll_to",
  "navigate",
  // References mutations
  "clear_references",
  // Library mutations
  "bookmarks_create",
  "bookmarks_remove",
  "bookmarks_move",
  "links_add",
  "links_remove",
  // Chrome mutations
  "extensions_set_enabled",
  "profiles_apply",
  "groups_apply",
  // Recorder controls
  "recorder_start",
  "recorder_stop"
]

const GATED_TOOLS: string[] = ["eval_js", "extensions_uninstall"]

const ALWAYS_PROMPT_TOOLS: string[] = [
  "cookies_get",
  "cookies_set",
  "cookies_remove",
  "cookies_clear"
]

const CLASS_MAP = new Map<string, ToolClass>()
for (const n of READ_TOOLS) CLASS_MAP.set(n, "read")
for (const n of WRITE_TOOLS) CLASS_MAP.set(n, "write")
for (const n of GATED_TOOLS) CLASS_MAP.set(n, "gated")
for (const n of ALWAYS_PROMPT_TOOLS) CLASS_MAP.set(n, "always-prompt")

export function getToolClass(toolName: string): ToolClass {
  // Default unknown tools to "write" (require consent) for safety.
  return CLASS_MAP.get(toolName) ?? "write"
}

export const TOOL_CLASSES: Readonly<Record<string, ToolClass>> = Object.freeze(
  Object.fromEntries(CLASS_MAP)
)

export const TOOL_CLASS_COUNTS = {
  read: READ_TOOLS.length,
  write: WRITE_TOOLS.length,
  gated: GATED_TOOLS.length,
  "always-prompt": ALWAYS_PROMPT_TOOLS.length
}
