# Roadmap (cycle log)

See the top-level `ROADMAP.md` for the rolling Now/Next/Later list. This
file captures per-cycle deltas as the cross-repo swarm ships them.

## Cycle 2026-05-06

### Now (shipped this cycle)

- **ALO-275 — Dependabot auto-merge.**
  `.github/workflows/dependabot-auto-merge.yml` uses
  `dependabot/fetch-metadata@v2` to detect the `dev-deps-minor-patch`
  group and any individual minor/patch update, then runs
  `gh pr merge --auto --squash`. Major-version bumps get an automated
  comment pointing reviewers at the SOP and stay open.
- **ALO-276 — Shared triage SOP.** `docs/dependabot-triage.md` is the
  single source of truth across the five swarm repos for what
  auto-merges, what doesn't, the Monday routine, and how high-severity
  Dependabot alerts route to Linear.
- **Workflow contract test.** `tests/dependabot-auto-merge.workflow.test.ts`
  pins the auto-merge contract under vitest (no new deps): asserts the
  workflow runs only against `dependabot[bot]`, classifies via
  `dependabot/fetch-metadata@v2`, calls `gh pr merge` exactly once
  inside the minor/patch branch, and passes `dependency-names` via
  `$DEP_NAMES` env to avoid shell-injection inside the major-version
  comment step.

### Next

- Wire a GitHub → Linear webhook so each Monday's grouped Dependabot PR
  opens a triage issue and auto-closes when the PR auto-merges
  (deferred follow-up to ALO-276).

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
