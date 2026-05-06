# AI Dev Sidebar — Unified Terminal + MCP Sidebar (Brave)

**Status:** Draft
**Date:** 2026-04-28
**Owner:** aloe
**Milestone tracking:** Linear (project `AI Dev Sidebar — Unified Sidebar`). All milestones below map to Linear milestones; tasks in this spec map to Linear issues under that project.

## 1. Goal

Replace the current chat-style "command line" sidepanel with a real multi-tab terminal emulator that runs the user's shell, exposes browser control to Claude Code via a local MCP server, and folds in the existing `lean-extensions` features (extensions manager, links library, captures, cookies, recorder) under a single Brave sidepanel.

The user can:
- Open one or more shells in the sidepanel and run `claude` (or anything) directly.
- Click `+ Reference` and pick an element on the page; it appears as a chip claude can read via MCP.
- Have an external `claude` session in any terminal connect to the same MCP server with zero manual configuration.

## 2. Non-goals (MVP)

- Brave Shields tools (post-MVP).
- Brave Leo interop (no extension API).
- Brave Wallet integration.
- Brave Workspaces (no extension API).
- Cloud upload of recordings.
- Recording transcription.
- Multi-element picker (single-pick only).
- Cross-platform PTY (macOS arm64 only for v1).

## 3. Architecture

Three processes, one local port.

```
Brave (extension)
  Sidepanel (React) ── chrome.runtime ──> background.ts ── stdio ──> ai-dev-host (Node)
                                                                       │   │
                                                                       │   └─ PTY manager (node-pty)
                                                                       └─ MCP server (HTTP+SSE 127.0.0.1:8473)
                                                                                ▲
                                                                                └─ claude-code (any terminal)
```

- **Native host** is the only long-running process. Owns PTY pool and MCP server.
- **Extension** (privileged): talks to host over the existing native-messaging stdio channel; pushes browser state into the MCP server's resource store via private RPCs over that same channel.
- **Claude Code** connects to the MCP server like any external SSE client. Multiple sessions OK.

## 4. Sidepanel Shell

Vertical icon rail on the left, content on the right. Sections (top → bottom):

1. **Terminal** (›_) — multi-tab xterm.js + element picker + references tray.
2. **Inspector** (🔍 magnifier) — existing tokens/scanner workflow. Independent from the terminal's element picker.
3. **Extensions** (⊞) — from lean-extensions: list, enable/disable, profiles, groups, lean-mode.
4. **Library** (★) — links, captures, bookmarks (`chrome.bookmarks` read/write), recordings list.
5. **Cookies** (🍪) — own section.
6. **Recorder** (● record icon) — start/stop video capture.
7. **Settings** (⚙) — merged settings + MCP server status + auth controls.

Code consolidation:
- `src/sections/{terminal,inspector,extensions,library,cookies,recorder,settings}/`. Each is a self-contained module exporting a root component.
- Move ai-dev-sidebar's `InspectorPanel`, `ScanTab`, `TokensPanel`, `ExportPanel` into `sections/inspector/`.
- Copy lean-extensions' `ExtensionsSection`, `ProfilesSection`, `GroupsSection`, `CookiesSection`, `LinksSection`, `CaptureSection`, `RecordPanel` into matching `sections/`.
- Drop existing chat UI (`VirtualizedChat`, `ChatMessage`, `LoadingDots`).
- Drop lean-extensions' `dashboard.tsx` and `newtab.tsx` (no full-page or new-tab takeover).
- Single `popup.tsx` simply opens the sidepanel.
- Storage namespacing: `terminal.*`, `inspector.*`, `extensions.*`, `library.*`, `cookies.*`, `recorder.*`, `settings.*`. One-time best-effort migration from any installed lean-extensions storage.
- Manifest permissions union: `storage`, `unlimitedStorage`, `tabs`, `activeTab`, `sidePanel`, `nativeMessaging`, `debugger`, `scripting`, `contextMenus`, `tabCapture`, `offscreen`, `management`, `bookmarks`, `cookies`, `downloads`.

## 5. Terminal Subsystem

**Native host (`native-host/ai-dev-host.mjs`):**
- New `PTYManager` holding `Map<sessionId, IPty>` using `@homebridge/node-pty-prebuilt-multiarch` (prebuilt macOS arm64 binaries — no C toolchain).
- Native-messaging RPCs: `pty.spawn({cwd, env, cols, rows}) → {sessionId}`, `pty.write({sessionId, data})`, `pty.resize({sessionId, cols, rows})`, `pty.kill({sessionId})`.
- Output streamed back as `pty.data` events tagged with `sessionId`. Frames are 1 MB max, so output is chunked.
- Default spawn: `$SHELL -l` in `os.homedir()`. Env inherits, plus `AI_DEV_MCP_URL=http://127.0.0.1:8473` and `AI_DEV_MCP_TOKEN=…` injected so `claude` works immediately.

**Sidepanel (`sections/terminal/`):**
- `TerminalPanel` — root component.
- xterm.js + `xterm-addon-fit` + `xterm-addon-web-links`, one `Terminal` instance per session.
- Tab strip with `+` button. First click on the empty state ("Open Terminal") creates session 1; `+` adds more. Closing the last tab returns to empty state.
- Tabs local to the sidepanel; closing the panel kills all PTYs for that panel (host tracks owner).
- Shortcuts: `Cmd+T` new tab, `Cmd+W` close tab, `Cmd+1..9` switch.

Bundle note: xterm.js ~250 KB; `node-pty` prebuilt binary shipped via the existing `pnpm install-host` script (extended).

## 6. Element Picker & References Tray

**Picker:**
- `[+ Reference]` button above the terminal tabs.
- Injects `contents/picker.ts` (forked from `contents/inspector.ts`) — overlay highlights elements on hover, click captures, `Esc` cancels.
- Single-pick per click; auto-exits picker mode after capture.

**Reference payload:**
```ts
{
  id: "ref_01HX...",        // ULID
  tabId, url, title,
  selector,                  // unique CSS selector
  outerHTML,                 // ≤ 8 KB
  textContent,               // ≤ 4 KB
  boundingBox: { x, y, w, h },
  screenshot,                // element-only PNG, ≤ 200 KB, base64 data URL
  createdAt
}
```

**Tray:**
- Collapsible panel below the terminal.
- Chips show favicon + truncated text. Click → preview popover. `×` removes. "Clear all" button.
- Drag chip into terminal → inserts `@ref_01HX…` token.
- Tray is the source of truth; MCP server mirrors it.

**MCP exposure:**
- Each reference is exposed as MCP resource `ai-dev://reference/{id}`; auto-listed.
- Tools `list_references`, `get_reference({id})`, `clear_references` for clients that don't auto-list resources.
- Extension pushes tray changes via the native-messaging channel; host emits MCP `notifications/resources/list_changed`.

## 7. MCP Server

**Transport:** HTTP + SSE on `127.0.0.1:8473` (auto-falls-back to `8474..8483` if in use). Bearer token via `Authorization` header.

### 7.1 Auth & Auto-Registration (zero-touch)

- Host generates a 256-bit token on each start and writes `~/.config/ai-dev-sidebar/mcp-token` (chmod 600). Token rotates every start.
- Host writes `~/.config/ai-dev-sidebar/env` containing `AI_DEV_MCP_TOKEN=...` and `AI_DEV_MCP_URL=http://127.0.0.1:<port>`.
- Host merges/updates `~/.claude.json` `mcpServers."ai-dev-sidebar"` entry:
  ```json
  {
    "type": "sse",
    "url": "http://127.0.0.1:8473/sse",
    "headers": { "Authorization": "Bearer ${AI_DEV_MCP_TOKEN}" }
  }
  ```
  Existing MCP servers in the file are left untouched.
- PTY shells inherit the env so in-extension `claude` works immediately.
- For external terminals, host drops a wrapper `~/.config/ai-dev-sidebar/claude` that sources the env file and `exec`s the real `claude`. Settings exposes a one-click "Enable `claude` in any terminal" that prepends `~/.config/ai-dev-sidebar` to `PATH` via `~/.zshrc` / `~/.bashrc` (idempotent, marker-guarded). Decline is fine — in-extension terminal always works.
- Server validates `Authorization: Bearer` against the in-memory token; 401s carry a debug header pointing to the host log.
- Settings panel shows: server status, registration status, "Available in any terminal" status, "Rotate token now", "Reset registration".

### 7.2 Resources

- `ai-dev://reference/{id}` — picked elements.
- `ai-dev://tab/{tabId}` — URL, title, viewport, frame tree.
- `ai-dev://tab/{tabId}/console` — last 500 console messages (ring buffer).
- `ai-dev://tab/{tabId}/network` — last 200 network entries (ring buffer).
- `ai-dev://tabs` — all open tabs across windows.
- `ai-dev://bookmarks` — full tree.
- `ai-dev://library/links` — collected links.
- `ai-dev://library/captures` — captured pages.
- `ai-dev://recordings` — recordings metadata.
- `ai-dev://extensions` — installed extensions + state.

### 7.3 Tools

*Tabs / navigation:* `tabs_list`, `tabs_create`, `tabs_update`, `tabs_remove`, `tabs_activate`, `tabs_reload`, `tabs_go_back`, `tabs_go_forward`.

*Tab groups:* `tab_groups_list`, `tab_groups_create`, `tab_groups_update`, `tab_groups_ungroup`.

*DOM / interaction:* `query_selector`, `click`, `type`, `scroll_to`, `wait_for_selector`, `screenshot`, `screenshot_element`, `get_dom`, `eval_js` (off by default; Settings toggle).

*References:* `list_references`, `get_reference`, `clear_references`.

*Bookmarks:* `bookmarks_search`, `bookmarks_create`, `bookmarks_remove`, `bookmarks_move`.

*Library:* `links_list`, `links_add`, `links_remove`, `captures_list`, `captures_get`.

*Cookies:* `cookies_get`, `cookies_set`, `cookies_remove`, `cookies_clear` — always prompt-each-time by default.

*Extensions:* `extensions_list`, `extensions_set_enabled`, `extensions_uninstall`, `profiles_list`, `profiles_apply`, `groups_apply`.

*Brave Search:* `brave_search({query, count?})` — direct HTTPS to the Brave Search API; user supplies API key in Settings.

*Recorder:* `recorder_start({source, tabId?})`, `recorder_stop`, `recorder_list`, `recorder_get`.

### 7.4 Consent Model

- Read tools: auto-allow.
- Write tools: prompt per call with "remember for this session" checkbox.
- `eval_js`, `extensions_uninstall`: gated off in Settings until explicitly enabled.
- Cookies tools: always prompt per call (sensitive). Configurable.
- Prompts render as a banner at the top of the sidepanel; never native dialogs.

## 8. Recorder

- Source options: `tab` (chrome.tabCapture), `screen` (getDisplayMedia), `camera` (getUserMedia).
- `MediaRecorder` produces **`video/mp4;codecs=h264`**. Brave/Chromium supports mp4 MediaRecorder; if the runtime reports unsupported, the recorder fails fast with a clear error (no webm fallback for v1).
- On stop:
  1. Auto-download via `chrome.downloads.download()` to the OS Downloads folder as `recording-<ISO>.mp4`.
  2. Mirror copy written to `~/.config/ai-dev-sidebar/recordings/{id}.mp4` so the MCP server can return a `file://` URI.
  3. Metadata entry persisted in `chrome.storage.local`: `{id, source, durationMs, sizeBytes, mimeType, filename, createdAt, originUrl?}`.
- MCP `recorder_get({id})` returns `{metadata, fileUri}`.
- Library section's "Recordings" subsection lists, previews, and re-downloads.

## 9. Error Handling

- Native host crash → background reconnects (extend existing `useNativeHost` exp-backoff); sidepanel surfaces "host disconnected" banner.
- PTY exit → terminal shows `[process exited code N — press any key to close]`, scrollback preserved.
- MCP port collision → fall back through `8473..8483`; updates `~/.claude.json` and env file with chosen port. All exhausted → Settings error.
- Tool failures return MCP `isError: true` with structured content.
- Picker on a navigating tab → auto-cancel; toast.

## 10. Testing

- **Unit (vitest):** MCP request/response framing, tool dispatch, token rotation, consent state machine, picker selector generation, storage migration.
- **Integration:** spin up host as a child process; fake MCP client over HTTP; mocked `chrome.*` shim already in `tests/setup.ts`.
- **Manual matrix** (`docs/superpowers/specs/2026-04-28-test-plan.md`): terminal lifecycle, picker → @ref → claude reads it, consent flows, fresh-machine auto-registration, registration on a machine with existing `~/.claude.json`.
- No PTY tests in CI (platform-specific). macOS arm64 manual only for v1.

## 11. Build & Install

- Extend `scripts/install-native-host.mjs`:
  - Install `@homebridge/node-pty-prebuilt-multiarch` prebuilt.
  - Generate token; write env file.
  - Register with `~/.claude.json`.
  - Optionally update `~/.zshrc` / `~/.bashrc` (user opt-in).
  - All steps idempotent.
- Add `scripts/uninstall-native-host.mjs` that reverses every step (including marker-guarded shell rc edits and the `~/.claude.json` entry).

## 12. Milestones (Linear)

1. **M1 — Sidepanel shell unification.** Vertical rail, sections scaffolded, lean-extensions code merged in, manifest unified, storage migration, drop legacy surfaces.
2. **M2 — PTY terminal.** node-pty integration, native-messaging RPCs, multi-tab xterm.js panel, shortcuts, lifecycle.
3. **M3 — MCP server core.** HTTP+SSE server, token + auto-registration, basic resources/tools (tabs, DOM, references stubs).
4. **M4 — Element picker + references tray + full DOM tools.** Picker overlay, tray UI, reference resources, drag-to-terminal, full DOM/interaction tool set.
5. **M5 — Library / cookies / extensions / bookmarks tools.** All MCP tools wired through to `chrome.*` APIs from the background worker.
6. **M6 — Recorder mp4 + MCP exposure.** mp4 capture, auto-download, disk-mirror, MCP `recorder_*` tools.
7. **M7 — Consent UX, settings panel, polish.** Banner consent flow, Settings panel for MCP/auth/permissions, error banners, install/uninstall scripts.
8. **M8 — Test pass + manual QA.** Unit + integration tests; manual test plan executed on a clean Brave install.

Each milestone gets a Linear milestone; each work item below it gets a Linear issue.
