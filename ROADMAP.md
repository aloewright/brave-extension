# Roadmap

Living plan for AI Dev Sidebar. Items move up the list as they land.

## Now

- Hardening of the legacy `ai-dev-messages` migration into per-backend shards
  (`getMessages()` / `setMessages()`) — ensure switching backends never wipes
  history and write a migration test against the in-memory storage shim.
- Settings UI polish: validate paths, surface CloudOS sync errors inline,
  keyboard navigation across backends (Claude Code, Gemini, Copilot, Codex).

## Next

- Playwright end-to-end smoke for the sidepanel (load extension, send a
  message, assert streamed reply).
- Coverage gate (`@vitest/coverage-v8`) wired into the test script once the
  suite expands beyond the storage layer.
- MCP transport hardening: reconnect/backoff for HTTP+SSE, auth-refresh
  hooks, per-server health surfacing in the UI.
- Page-inspection / scraping context cards in the sidepanel so the active
  tab's selection or DOM snapshot is one click away.

## Later

- Firefox port (manifest v3 with the WebExtension `browser.*` shim and a
  Plasmo target swap).
- Opt-in telemetry for backend-selection mix, error rates, and command
  latency — strictly local-first, off by default.
- Conversation export (Markdown / JSONL) and per-project memory pinning.
- Multi-cursor / multi-pane layout so the user can compare answers from two
  backends side-by-side.

## Done

- Native-host integration tests covering `exec`, `stream`, `kill`, and
  `session-status` round-trips against a stub child process
  (`tests/native-host.integration.test.ts`). Uses
  `AI_DEV_SIDEBAR_EXEC_OVERRIDE` to swap real CLI binaries for inline
  `node -e` stubs and `AI_DEV_SIDEBAR_SESSION_STATE_PATH` to keep on-disk
  session state in a tmpdir.
- Vitest unit-test harness landed: `tests/setup.ts` ships an in-memory
  `chrome.storage.local` shim and the storage + types layers have happy-path
  coverage.
- GitHub Actions `tests` workflow gates `npm test` on every PR and push to
  `main` (Node 22, deps installed with `--ignore-scripts`).
