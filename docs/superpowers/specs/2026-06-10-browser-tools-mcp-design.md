# Browser Page Tools over MCP — Design

**Date:** 2026-06-10
**Status:** Approved

## Problem

The in-page "page agent" (chat overlay + on-device Foundation Models planning loop) does not work in practice and fails silently at every layer:

- Planning goes through the Swift Foundation Models bridge with a 15s timeout and falls back to a deterministic stub that just reports "observed N nodes," with no indication to the user.
- Step streaming is broken: background sends `PAGE_AGENT_STEP` but the content script listens for `PAGE_AGENT_STEP_EVENT`, so progress never renders.
- Hindsight memory is hardcoded to `localhost:8888` and silently drops when unavailable.
- The cloud path only fires when `sidebarSyncEnabled` + `sidebarApiUrl` are configured; otherwise it silently degrades.

Meanwhile the DOM tool layer (`DOM_TOOL_HANDLERS` in `src/background/dom-tools.ts`) works, and the native host already runs an MCP server (HTTP+SSE, ports 8473–8483, self-registered in `~/.claude.json`) with a tool-request bridge back into the extension (`mcp.setToolRequestBridge` → `mcp.tool.call` → `handleMcpToolCall`).

## Decision

Delete the in-page agent entirely and expose the DOM tools over the existing MCP server. The extension becomes a pure tool provider ("hands and eyes"); any MCP client (Claude Code first) is the brain.

## Architecture

Call flow:

```
MCP client (Claude Code)
  → native host MCP server (HTTP+SSE, ports 8473–8483)
  → tool-request bridge: { type: "mcp.tool.call", id, name, args } over native messaging port
  → background SW handleMcpToolCall()
  → DOM_TOOL_HANDLERS (src/background/dom-tools.ts)
  → chrome.scripting / chrome.tabs in target tab
  → result back over the same path as mcp.tool.result
```

No LLM, no planner, no overlay UI in the extension.

## Tool surface

Twelve tools, defined in `native-host/tool-defs/dom-tools.mjs` (currently a stub) and registered in `native-host/mcp-server.mjs`. All prefixed `browser_`:

| MCP tool | Backing handler | Notes |
|---|---|---|
| `browser_tabs` | new handler in dom-tools.ts | Lists open tabs: id, url, title, active flag |
| `browser_observe` | `browser_observe` | Interactive-element snapshot with refs |
| `browser_click` | `click` | |
| `browser_type` | `type` | |
| `browser_scroll_to` | `scroll_to` | |
| `browser_navigate` | `navigate` | Waits for `status: "complete"` |
| `browser_wait_for` | `wait_for_selector` | |
| `browser_screenshot` | `screenshot` | |
| `browser_screenshot_element` | `screenshot_element` | |
| `browser_get_dom` | `get_dom` | |
| `browser_query` | `query_selector` | |
| `browser_eval_js` | `eval_js` | Gated (see below) |

**Tab targeting:** every tool takes an optional `tabId`. Omitted means the active tab, resolved at call time in the background worker. `browser_tabs` provides ids for explicit targeting.

**Schemas** mirror the existing handler parameters (selector/ref for click and type, text for type, URL for navigate, etc.).

## Error handling

Failures must be loud and structured — an external agent can only recover from errors it can see:

- Restricted URLs (`chrome://`, `about:`, web store) return an explicit error naming the URL, not a silent no-op.
- `browser_observe` results include `totalNodes`, `returnedNodes`, and a `truncated` flag (current behavior silently caps at 80 nodes / 20KB text).
- `browser_eval_js` remains gated behind the existing `allowEvalJs` extension setting (off by default); when gated, it returns the error "eval_js is disabled in extension settings".
- Per-call timeout of 30s on the native-host bridge, so a dead extension port returns an MCP error instead of hanging the client.
- `browser_click` / `browser_type` run without an extension-side consent prompt; the MCP client's own permission layer is the consent surface.

## Deletions

The in-page agent is removed entirely:

- `src/contents/page-agent.ts` — overlay content script
- `src/background/page-agent-program.ts` — planner/program executor
- In `src/background.ts` (~lines 1330–1523): `handlePageAgentMessage`, `pageAgentObserve`, the `foundationModels.plan` call for this path, and the hardcoded Hindsight client (`localhost:8888`, bank `page-agent-bank`)
- All `PAGE_AGENT_*` message types
- The page-agent toggle in `src/components/SidebarRail.tsx`

`DOM_TOOL_HANDLERS` in `src/background/dom-tools.ts` survives as the single implementation.

The Swift Foundation Models bridge in the native host (`foundation-models-bridge.swift`, `foundationModels.plan` handler in `ai-dev-host.mjs`) is left in place if anything else uses it; if implementation confirms it is orphaned, it is deleted in a follow-up, not in this change.

## Testing

- Unit tests (plain vitest, per the existing harness convention — no vitest-pool-workers) for:
  - MCP tool name → handler dispatch mapping
  - `tabId` resolution (explicit id vs. active-tab default)
  - Gating and error shaping (restricted URL, eval_js disabled, truncation flags)
- Update the rail smoke test that covers the removed page-agent toggle.
- Manual end-to-end check from Claude Code: `browser_tabs` → `browser_observe` → `browser_click` on a real page.

## Out of scope

- Any in-browser chat/agent UI (may return later as a thin client over an external agent).
- Hindsight/memory integration for page actions.
- Consent prompts inside the extension for write actions.
- Deleting the Swift bridge (follow-up if orphaned).
