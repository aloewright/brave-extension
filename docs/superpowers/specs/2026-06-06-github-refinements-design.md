# GitHub Refinements — Design

**Date:** 2026-06-06
**Branch:** `cursor/github-refinements`
**Status:** Approved (architecture, security posture, feature set, storage); settings UI delegated.

## Goal

Add Refined-GitHub-style enhancements to the Brave Dev Extension: a content
script that injects opt-in tweaks onto `github.com`, plus a new sidebar
**GitHub** section where the user toggles features on/off (master switch +
per-category groups).

Refined GitHub itself is **not** vendored. Its ~293 features are each coupled to
an in-house framework (`dom-chef`, `github-url-detection`, `select-dom`,
`delegate-it`, `element-ready`, `octicons-plain-react`, a GraphQL `api` helper,
and the `feature-manager` runtime). We port a **curated subset** to thin local
equivalents instead — this is how the readme/attribution/license/build fluff and
the insecure paths get stripped.

## Security posture

- **Hard rule: no remote code.** Nothing loads or evals code from any origin.
- Network is limited to **GitHub only** — `github.com` and `api.github.com`.
- API/GraphQL features are allowed. The GitHub PAT is resolved from **Doppler**,
  reusing the existing secret-resolution path the codebase already uses for the
  Sidebar/Tasks tokens (`doppler_secret_get`, `pickSecretValue`, secret-name
  candidate lists). Token is never displayed; UI shows resolved / not-resolved.
- No `innerHTML`/`insertAdjacentHTML`/`eval` with dynamic content. DOM is built
  with a safe element factory. CSS features inject a `<style>` element we own.
- Token-backed features degrade to a silent no-op when no token is resolved.

## Architecture

```
src/contents/github.ts          PlasmoCSConfig matches ["https://github.com/*"], run_at document_idle
src/lib/github/
  page-detect.ts                URL/pathname predicates: isPR, isIssue, isRepoRoot,
                                isCommit, isProfile, isDashboard, isNotFound, isPRFiles, …
  observe.ts                    MutationObserver "run init when selector appears"; replaces
                                selector-observer + element-ready. AbortSignal-aware.
  dom.ts                        Safe element factory el(tag, props, children). No innerHTML/eval.
  api.ts                        GitHub REST+GraphQL client. Token from Doppler, in-memory cache.
                                Calls only github.com / api.github.com.
  registry.ts                   FeatureMeta[] + isFeatureOn() resolution rule.
  runtime.ts                    Reads toggles, runs enabled features whose pageTest matches,
                                re-runs on SPA navigation, lives-updates on storage change.
  features/                     One file per feature, each exports a FeatureMeta.
src/sections/github/
  GitHubSection.tsx             Master switch + per-category toggle groups (settings UI).
```

### FeatureMeta

```ts
interface FeatureMeta {
  id: string
  name: string
  description: string
  category: "global" | "repository" | "pull-requests" | "issues" | "profiles"
  defaultEnabled: boolean
  needsToken?: boolean
  pageTest: (url: URL) => boolean      // built from page-detect predicates
  init: (signal: AbortSignal) => void | Promise<void>
}
```

### Runtime flow

1. Content script loads on `github.com`, reads `settings.github`.
2. For each registered feature where `isFeatureOn(id)` && `pageTest(location)`,
   call `init(signal)`. Features use `observe()` to attach to React-rendered DOM.
3. On SPA navigation (history API / `turbo:`-style events), abort the previous
   signal and re-run step 2 against the new URL.
4. On `chrome.storage.onChanged` for the settings key, diff `enabled` +
   `features`, abort features turned off, init features turned on.

Every `init` is idempotent and self-healing: a stale selector means the feature
silently does nothing rather than breaking the page.

## Curated feature set (~20)

**Global:** `clean-sidebar`, `hide-newsfeed-noise`, `useful-not-found-page`,
`selectable-comment-quotes`.

**Repository:** `expand-all-files`, `copy-file-path`, `copy-raw-file`,
`sticky-file-headers`, `default-branch-button` [API].

**Pull Requests:** `collapse-all-diff-files`, `show-whitespace-toggle`,
`pr-ci-status-summary` [API], `conversation-links`, `sticky-pr-tabs`.

**Issues:** `comment-fields-keyboard-shortcuts`, `clean-issue-labels`,
`linked-issue-references` [API].

**Profiles:** `profile-repo-search`, `clean-profile`.

Explicitly **excluded** as fluff: easter eggs, decorative-only features,
attribution/welcome/sponsor UI.

CSS-only and URL-param features are the most stable; [API] features the most
valuable but token-dependent.

## Storage shape

Extends the existing `Settings` interface; persisted through the current
`getSettings`/`setSettings` path. No new storage keys, no migration (absent =
defaults).

```ts
interface GitHubFeatureSettings {
  enabled: boolean                    // master switch
  features: Record<string, boolean>   // per-feature overrides only; absent ⇒ defaultEnabled
}

// Settings gains:  github: GitHubFeatureSettings
// DEFAULT_SETTINGS: github: { enabled: true, features: {} }
```

Resolution (single source of truth in `registry.ts`):

```ts
function isFeatureOn(id: string, s: GitHubFeatureSettings): boolean {
  if (!s.enabled) return false
  return s.features[id] ?? registry[id].defaultEnabled
}
```

Storing only overrides keeps the object small and lets newly shipped features
adopt their `defaultEnabled` with no migration.

Token is **not** in settings — resolved on demand in `api.ts` from Doppler via
the same background bridge `SettingsSection` uses, cached in memory per page.

## Settings UI (delegated — no separate approval gate)

`src/sections/github/GitHubSection.tsx`, registered in `src/sidepanel.tsx` and
the sidebar rail (`SectionId` + `SidebarRail`). Layout:

- Master switch (`github.enabled`) at top; when off, the list is visually
  disabled.
- A "GitHub token" status row: resolved / not-resolved via Doppler secret-name
  candidates (`GITHUB_PAT`, `GITHUB_TOKEN`, `GH_TOKEN`, …), value never shown.
  Mirrors the Sidebar/Tasks token rows in `SettingsSection.tsx`.
- Per-category collapsible groups, each listing its features with a toggle,
  name, description, and an [API] badge where `needsToken`.
- Toggling writes `settings.github.features[id]` through `useSettings().update`.

Follows existing section conventions (Tailwind classes, `useSettings`, the
section component pattern in `src/sections/*`).

## Testing

- Unit (vitest): `page-detect` predicates against representative URLs;
  `isFeatureOn` resolution (master off, override on/off, default fallback);
  `observe` attach/abort lifecycle with a mock DOM (happy-dom).
- Each feature: a focused test that, given a minimal fixture DOM, `init` makes
  the expected mutation and `abort` cleans it up.
- No e2e against live github.com required for v1.

## Out of scope (v1)

- Vendoring or porting the full RGH feature set.
- Features requiring GitHub write scopes or destructive actions.
- Non-GitHub network calls of any kind.
```
