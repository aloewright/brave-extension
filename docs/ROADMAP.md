# Roadmap (cycle log)

See the top-level `ROADMAP.md` for the rolling Now/Next/Later list. This
file captures per-cycle deltas as the cross-repo swarm ships them.

## Cycle 2026-04-29

### Now (shipped this cycle)
- **ALO-113 — Dependabot weekly rotation.** `.github/dependabot.yml` opens
  weekly Monday 06:00 UTC PRs for `npm` and `github-actions`, with
  minor/patch updates grouped into `dev-deps-minor-patch` and labelled
  `dependencies` + `automated`. Mirrors the rotation now live in
  `codemode` and `lean-extensions`.
- **ALO-104 (slice) — sidepanel interaction test.** `tests/sidepanel.test.tsx`
  pins the per-backend `visibleMessages` filter and the `/clear` →
  `clearMessages(activeBackend)` contract that the side panel relies on,
  using the existing Vitest + happy-dom harness. No new dependencies.

### Next
- **ALO-104 (full) — Playwright e2e.** Load the unpacked extension, open
  the side panel, send a message, and assert the streamed reply renders.
  Pair it with native-host integration tests covering `exec`, `stream`,
  `kill`, and `session-status` round-trips against a stub child process.

### Later
- Coverage gate (`@vitest/coverage-v8`) wired into `npm test` once the
  suite expands beyond the storage + sidepanel-helper layers.
- Firefox port and opt-in telemetry — tracked in the top-level
  `ROADMAP.md`.
