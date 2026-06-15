# Password Manager Swarm Plan

Date: 2026-06-14
Status: In progress
Scope: next development phase after the thin `go` launcher tab

## Goal

Make the extension aware of the self-hosted `go` password app without turning
the extension into a password vault.

The next phase should deliver a read-only integration bridge that answers:

- Is `go` reachable?
- Is the current browser session logged in, locked, or signed out?
- Is the backup configuration healthy?
- Is the vault ready for import/export operations?
- Which entry point should the extension open next?

This phase should not add passive autofill, auto-submit, local decrypted secret
storage, background clipboard writes, or domain-based password matching.

## Non-Negotiable Boundary

`go` is the vault of record. The extension may store:

- `passwordAppUrl`
- provider selection
- last status check timestamp/result
- non-sensitive UI preferences

The extension must not store:

- master password
- WebDAV password
- access token or refresh token unless there is a separate token design review
- encrypted or decrypted cipher payloads
- generated passwords by default
- per-site password match caches

## Proposed Architecture

### Session Handoff Slice

The extension cannot safely call authenticated `go` endpoints yet because the
webapp intentionally keeps bearer tokens in memory and strips them from
persisted browser storage. The next implemented slice uses a narrow, read-only
session pulse instead:

- `go` posts a same-origin browser message when its app phase changes.
- A content script scoped to `https://go.lazee.workers.dev/*` forwards only the
  sanitized status to the extension background.
- The extension stores only `state`, `email`, `role`, `origin`, route, and
  timestamp under `passwords.go.sessionStatus.v1`.
- Tokens, vault ciphers, generated passwords, WebDAV credentials, and master
  keys are still out of scope for extension storage.

This gives the Vault panel enough context to show signed-out, locked, or
unlocked go-tab state without creating a token handoff.

### Worker/API Contract

Add extension-safe endpoints to `password-app`:

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /api/extension/status` | optional session cookie | Reachability, version, invite gate, JWT safety |
| `GET /api/extension/session` | session cookie | `signed_out`, `locked`, `unlocked`, email, role |
| `GET /api/extension/backup/status` | admin session cookie | sanitized backup health, last run, next run |
| `GET /api/extension/import/status` | session cookie | supported formats, import enabled, current lock requirement |

All responses must be sanitized. Backup status can say a WebDAV destination is
configured, but it must not return the URL username, password, path secret, or
remote directory listing.

### Extension Client

Add `src/lib/go-vault-client.ts` with:

- URL builder based on `buildPasswordAppUrl`
- `fetchGoStatus()`
- `fetchGoSession()`
- `fetchGoBackupStatus()`
- `fetchGoImportStatus()`
- typed response guards
- short timeout and clear error shaping

The client should use `credentials: "include"` only if CORS is explicitly
configured for the extension origin. The current local extension id is:

`chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh`

### Extension UI

Upgrade `PasswordVaultSection` from a launcher to a small operations panel:

- status card: online/offline/version
- session card: signed out/locked/unlocked
- backup card: configured/last success/last failure
- import card: import/export readiness
- action buttons:
  - Open vault
  - Unlock/sign in
  - Run backup
  - Import/export
  - Account devices

The buttons should still open `go` routes. The extension should not attempt to
perform backup, import, or unlock operations itself in this phase.

## Swarm Lanes

### Lane A: API Contracts

Owner shape: password-app/backend worker agent

Tasks:

1. Add response types under `password-app/src/types` or a shared contract file.
2. Add `/api/extension/*` router.
3. Reuse existing auth/session helpers instead of adding a second auth model.
4. Add CORS coverage for the known extension origin.
5. Add tests proving secrets are not present in JSON responses.

Acceptance:

- `curl https://go.lazee.workers.dev/api/extension/status` returns public status.
- Authenticated browser requests can distinguish locked/unlocked/signed-out.
- Backup status exposes health only, not credentials.

### Lane B: Extension Client

Owner shape: extension data agent

Tasks:

1. Create `src/lib/go-vault-client.ts`.
2. Add typed result unions for online/offline/auth states.
3. Add tests for URL joining, timeout handling, and malformed responses.
4. Keep all data in component state unless a field is explicitly non-sensitive.

Acceptance:

- Focused Vitest tests pass without network.
- No client code references cipher, password, master key, or token storage.

### Lane C: Passwords Panel UI

Owner shape: extension UI agent

Tasks:

1. Replace the simple status grid with four operation cards.
2. Add loading, stale, and error states.
3. Keep the panel responsive at sidepanel widths.
4. Preserve direct route buttons for the existing `go` webapp screens.

Acceptance:

- The panel fits at 420px width without horizontal overflow.
- A signed-out user gets a clear sign-in action.
- A locked user gets an unlock action.
- An unlocked admin sees backup health.

### Lane D: Security and Privacy Tests

Owner shape: test/security agent

Tasks:

1. Add source-shape tests that reject local vault secret storage.
2. Add API response tests that reject credential-shaped fields.
3. Add extension tests that ensure `chrome.storage.local` never receives status
   payloads containing tokens, passwords, ciphers, or backup credentials.
4. Update `docs/password-strategy.md` with the new bridge boundary.

Acceptance:

- Tests fail if a response includes `password`, `token`, `cipher`, `key`, or
  WebDAV credential fields outside an allowlist.
- Existing legacy password cache purge behavior remains covered.

### Lane E: Release and Smoke

Owner shape: release agent

Tasks:

1. Run `pnpm typecheck`.
2. Run focused Vitest suites for password strategy, storage, rail, and go client.
3. Run `pnpm build`.
4. Deploy `go` if API changes are included.
5. Rebuild and reload the extension.
6. Smoke test signed-out, locked, and unlocked flows.

Acceptance:

- The extension loads from `build/`.
- The `Passwords` tab shows live `go` state.
- No local password cache keys are introduced.

## Task Graph

1. Lane A defines and tests API contracts.
2. Lane B can build against mocked Lane A responses in parallel.
3. Lane C can build against Lane B mocks in parallel.
4. Lane D starts immediately with source-shape tests and expands once contracts land.
5. Lane E waits for A-D and owns final build/deploy/smoke.

## Deferred Work

Explicit fill/copy is a later phase. Before that phase starts, write a separate
decision record for:

- unlock model
- token/session storage
- clipboard behavior
- per-domain matching
- generated password save flow
- manual fill UX

Do not add passive autofill or auto-submit as part of the read-only bridge.
