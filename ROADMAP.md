# Roadmap

## Now
- Vitest unit-test harness landed: `tests/setup.ts` ships an in-memory
  `chrome.storage.local` shim and the storage + types layers have happy-path coverage.
- GitHub Actions `tests` workflow gates `npm test` on every PR and push to
  `main` (Node 22, deps installed with `--ignore-scripts`).

## Next
- Playwright end-to-end smoke for the sidepanel (load extension, send a message,
  assert streamed reply) -- tracked as ALO-104.
- Settings UI polish: validate paths, surface CloudOS sync errors inline,
  keyboard navigation across backends.
- Coverage gate (`@vitest/coverage-v8`) wired into the test script once the
  suite expands beyond the storage layer.

## Recently shipped
- Idempotent per-backend shard migration for the legacy `ai-dev-messages`
  key — `getMessagesForBackend` short-circuits on a single storage round-trip
  when the shard is present, the legacy key is only consulted when needed,
  and re-runs never double-shard or wipe history (PDX-87).
- Native-host integration tests covering `exec`, `stream`, `kill`, and
  `session-status` round-trips against a stub child process (PDX-88).

## Later
- Firefox port (manifest v3 with the WebExtension `browser.*` shim and a
  Plasmo target swap).
- Opt-in telemetry for backend-selection mix, error rates, and command latency
  — strictly local-first, off by default.
- MCP transport hardening: reconnect/backoff for HTTP+SSE, auth-refresh hooks,
  per-server health surfacing in the UI.
- Conversation export (Markdown / JSONL) and per-project memory pinning.
