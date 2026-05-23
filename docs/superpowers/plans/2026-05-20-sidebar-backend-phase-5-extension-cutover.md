# Sidebar Backend — Phase 5: Extension Client Cutover

> Stacked on Phase 4 (PR #40). Retires the extension's `notes.pdx.software` integration in favour of the new Worker. Adds sync hooks for the resource types that Phases 2-3 unlocked.

**Goal:** When this PR ships, the extension stops talking to `notes.pdx.software` and starts pushing to the new `sidebar-api` Worker. Conversations sync via the new endpoint; bookmarks snapshot pushes on Chrome bookmark changes; collected links replicate into D1; recordings auto-upload after `recorder-tools` saves to disk.

**Architecture:**
- New typed module `src/lib/sidebar-api.ts` (mirrors `worker/web/src/api.ts`) — single source of truth for talking to the Worker from the extension.
- Settings gain `sidebar*` fields alongside the existing `cloudos*` fields. A one-shot migration copies any non-empty `cloudos*` value into the matching `sidebar*` slot on first read. The legacy fields stay readable for one release so users mid-migration aren't broken.
- `useCloudosSync` is replaced by `useSidebarSync` at the call sites; the old hook stays in the repo as a deprecated read-only fallback (it returns `{ disabled: true }` until removed in a follow-up).

**Spec:** `docs/superpowers/specs/2026-05-20-sidebar-backend-worker-design.md` §9.

---

## Tasks

### Task 1 — Settings types + migration

- `src/types.ts` Settings: add `sidebarSyncEnabled`, `sidebarApiUrl`, `sidebarApiToken`, `sidebarPruneAfterSync`. Keep the four `cloudos*` fields with `@deprecated` JSDoc.
- `DEFAULT_SETTINGS`: `sidebarApiUrl = "https://sidebar.pdx.software"` (user-overridable in UI), `sidebarSyncEnabled = false`, the others empty/false. Cloudos defaults stay (so existing users see their config until they explicitly remove it).
- `src/storage.ts`: same default duplication, plus a `migrateCloudosToSidebar(settings)` helper called from `getSettings()` that copies any non-empty `cloudos*` value into the matching `sidebar*` slot when the latter is empty. Persist the result and set a `migration:cloudos-to-sidebar=1` marker so the migration runs once.
- `tests/storage.test.ts`: add a test that asserts the migration copies URL + token + flags but leaves cloudos fields intact.

### Task 2 — Extension sidebar-api client

- Create `src/lib/sidebar-api.ts` — same surface as `worker/web/src/api.ts` (`createApiClient(token, baseUrl)` returning `health` + `search` + per-resource list/get/blobUrl + new write helpers `conversations.upsert`, `links.upsert`, `bookmarks.snapshot`, `recordings.upload(blob, metadata)`).
- `tests/sidebar-api.test.ts` — covers header propagation, JSON handling, `ApiError` shape, multipart upload structure.

### Task 3 — `useSidebarSync` hook + cutover

- Add `src/hooks/useSidebarSync.ts` — same debounce/session logic as `useCloudosSync` but talks to `POST /api/conversations` (`{ backend, title, content_text, started_at, message_count }`).
- `src/sections/settings/SettingsSection.tsx`: import `useSidebarSync` instead of `useCloudosSync`.
- `src/hooks/useCloudosSync.ts`: keep the file but short-circuit when `sidebarSyncEnabled` is on (avoid double-syncing); leave a `@deprecated` banner.
- Test: the new hook fires once on first message and updates existing notes on subsequent messages.

### Task 4 — Settings UI

- `src/components/SettingsPanel.tsx`: rename the existing "CloudOS sync" block to "Sidebar sync" and bind to the `sidebar*` fields. Below it, keep a small read-only "Legacy CloudOS sync" section that displays the old fields and a "Clear" button for one release.

### Task 5 — Bookmark sync background hook

- `src/background/bookmark-sync.ts` — listens to `chrome.bookmarks.onCreated/onChanged/onRemoved/onMoved` and on extension startup; debounced 5s; calls `pullBookmarkSnapshot()` + `client.bookmarks.snapshot(...)`.
- Wired from `src/background.ts` when `sidebarSyncEnabled` is true.

### Task 6 — Link sync + recorder upload + PR

- Wrap `setLinks()` in `src/sections/_lx/storage.ts`: also fire-and-forget upload changed/new links via `client.links.upsert`.
- `src/background/recorder-tools.ts`: after the recorder saves a file to disk, also call `client.recordings.upload(blob, metadata)` so the same bytes land in R2.
- Open PR stacked on Phase 4.

## Out of scope

- **PDF capture (net-new UX)** — context-menu + download interception + auto-upload of PDF tabs. Lands in a follow-up because it's a new feature surface, not a cutover.
- **Web UI write actions** — still read-only on the Worker side.
- **Cloudos field removal** — the deprecated `cloudos*` Settings keys stay in this PR; a future cleanup PR drops them once we've verified the migration is solid.

## Done criteria

- `pnpm typecheck` clean across extension + worker.
- `pnpm test` green across both surfaces.
- After build: the extension's sidepanel exposes the new "Sidebar sync" settings; toggling it on with a valid URL+token streams conversations to the Worker. Bookmark snapshots land on chrome.bookmarks change. Recordings auto-upload after recording stops.
