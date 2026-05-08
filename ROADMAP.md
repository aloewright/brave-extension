# Roadmap

Living plan for AI Dev Sidebar. Items move up the list as they land.

## Now

- Hardening of the legacy `ai-dev-messages` migration into per-backend shards
  (`getMessages()` / `setMessages()`) — ensure switching backends never wipes
  history and write a migration test against the in-memory storage shim.
- Settings UI polish: validate paths, surface CloudOS sync errors inline,
  keyboard navigation across backends (Claude Code, Gemini, Copilot, Codex).
- Native-host integration tests covering `exec`, `stream`, `kill`, and
  `session-status` round-trips against a stub child process.

## Next

- Playwright end-to-end smoke for the sidepanel (load extension, send a
  message, assert streamed reply).
- Ratchet the 60%/50% coverage floor onto more of `src/lib/**` and the
  `_lx` sections as their suites land (ALO-111).
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

- CI hardening (ALO-110 / ALO-111 / ALO-112): the `tests` workflow gained a
  non-blocking `build` job that runs the full Plasmo production build to
  catch manifest / bundler regressions; `vitest.config.ts` now enforces a
  60% line / 50% branch coverage floor (scoped to `src/lib/**` initially),
  and `pnpm test:coverage` runs the v8 reporter.
- Vitest unit-test harness landed: `tests/setup.ts` ships an in-memory
  `chrome.storage.local` shim and the storage + types layers have happy-path
  coverage.
- GitHub Actions `tests` workflow gates `pnpm test` on every PR and push to
  `main` (Node 22, deps installed with `--ignore-scripts`).
