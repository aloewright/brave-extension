# Dependabot Triage SOP

_Last updated: 2026-05-06_

This is the shared standard operating procedure for the weekly Dependabot
rotation across the swarm repos: `alex`, `cloudos`, `codemode`,
`brave-extension`, `lean-extensions`.

## Schedule

Dependabot opens grouped weekly PRs every Monday at 06:00 UTC for two
ecosystems: `npm` (or `swift` for `alex`) and `github-actions`. Minor
and patch version updates are bundled into a single
`dev-deps-minor-patch` PR; major updates and security advisories open
individually.

## Auto-merge vs. needs-human

The `.github/workflows/dependabot-auto-merge.yml` workflow decides
automatically:

- **Auto-merge** (squash, after CI passes):
  - Any PR in the `dev-deps-minor-patch` group.
  - Any individual `version-update:semver-minor` or
    `version-update:semver-patch` PR.
- **Needs human review** — auto-merge is skipped and the bot posts a
  comment:
  - `version-update:semver-major` (any major bump).
  - Anything failing CI (auto-merge stays queued; if CI fails the PR
    will not merge).
  - PRs that touch `package.json` engines, lockfile schema, build
    tooling, or runtime in a way the grouped diff makes hard to read.

If a minor/patch PR is mis-grouped (e.g. a "minor" bump that turns out
to be breaking), close it with a note explaining which dependency is
the culprit and Dependabot will reopen the rest in a fresh group next
Monday.

## Routine (Monday morning)

1. Open the Dependabot tab for each repo:
   - https://github.com/aloewright/alex/security/dependabot
   - https://github.com/aloewright/cloudos/security/dependabot
   - https://github.com/aloewright/codemode/security/dependabot
   - https://github.com/aloewright/brave-extension/security/dependabot
   - https://github.com/aloewright/lean-extensions/security/dependabot
2. For the grouped `dev-deps-minor-patch` PR: confirm CI is green and
   let auto-merge close it. No action required on green PRs.
3. For any individual major PR: read the changelog, decide whether the
   bump is worth taking now or whether to ignore the dependency at the
   current major in `dependabot.yml`.
4. For high-severity Dependabot alerts (Security tab, not the PR tab):
   open a Linear issue immediately, prioritize Urgent, link the
   alert(s).

## High-severity routing

Security alerts of `high` or `critical` severity bypass the Monday
rotation. They should be:

1. Filed as a Linear issue with priority `Urgent` and labelled
   `dependabot` + `security`.
2. Routed to whoever last touched the affected package (`git blame`
   the import).
3. Patched on a feature branch within 7 days of disclosure; if the
   transitive vulnerability has no upstream fix, document the
   reachability analysis in the issue and add an `ignore` entry in
   `.github/dependabot.yml` with a comment linking the analysis.

## Configuration reference

- `.github/dependabot.yml` — schedule, grouping, labels, ignore list.
- `.github/workflows/dependabot-auto-merge.yml` — auto-merge rules and
  major-version comment.
- This file — the human process around the above two.

## Linear automation (future)

Tracked in ALO-276 follow-ups: a GitHub → Linear webhook can open a
triage issue every Monday once the grouped PR appears, and close it
automatically when auto-merge merges the PR. Out of scope for the
initial rollout — manual triage above is the baseline.
