# Roadmap

## Now
- Vitest unit-test harness landed: `tests/setup.ts` ships an in-memory
  `chrome.storage.local` shim and the storage + types layers have happy-path coverage.
- GitHub Actions `tests` workflow gates `npm test` on every PR and push to
  `main` (Node 22, deps installed with `--ignore-scripts`).
- `typecheck` script + workflow scaffolded (PDX-124). The job runs
  `tsc --noEmit -p .` on every PR/push but is currently **non-blocking**
  (`continue-on-error: true`) so any drift introduced before the gate
  landed has time to be cleaned up.

## Next
- **Flip `typecheck` to blocking.** Remove `continue-on-error: true` from
  `.github/workflows/typecheck.yml` once the dust settles on PDX-124. At
  that point a TS error will fail CI just like a unit-test regression.
- Playwright end-to-end smoke for the sidepanel (load extension, send a message,
  assert streamed reply) -- tracked as ALO-104.
- Settings UI polish: validate paths, surface CloudOS sync errors inline,
  keyboard navigation across backends.
- Coverage gate (`@vitest/coverage-v8`) wired into the test script once the
  suite expands beyond the storage layer.

## Recently shipped
- Typecheck scaffolding (PDX-124): added `pnpm typecheck`, `@types/node` for
  the integration test, and a non-blocking `typecheck.yml` workflow. Fixed
  the pre-existing TS errors in `src/background.ts` (chrome.offscreen +
  chrome.runtime.getContexts now have proper local interfaces instead of
  `@ts-ignore`), `src/components/SettingsPanel.tsx` (Tailwind ring color
  driven via the `--tw-ring-color` custom property instead of the invalid
  `ringColor` style key), and `src/components/VirtualizedChat.tsx`
  (`String.prototype.match` null-fallback now uses `?? []` with an explicit
  `string[]` annotation so reduce's accumulator infers as `number`).
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
