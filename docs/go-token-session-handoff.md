# Go token and session handoff design review

Status: decided for ALO-708
Decision: no token handoff in the current extension phase
Scope: authenticated `go` operations initiated by the Brave Dev Extension

## Decision

The extension must not receive, store, refresh, or replay an authenticated `go`
credential in this phase. The selected implementation path is:

- public, credentialless `GET /api/extension/status`
- same-origin browser-session pulse from an already-open `go` tab
- route-opening actions that send the user back to `go` for authenticated work

Authenticated extension behavior is deferred. The extension can show whether a
recent `go` tab appears signed out, locked, or unlocked, but it cannot convert
that presence signal into API access.

## Options reviewed

### No token handoff

Selected for the current phase.

Benefits:

- Keeps `go` as the vault of record.
- Avoids duplicating the webapp session model in extension storage.
- Avoids putting bearer material in an MV3 service worker or sidepanel.
- Lets status, routing, and readiness UX ship without weakening the vault.

Costs:

- Backup, import, device, fill, and copy actions open `go` instead of running
  inside the extension.
- The sidebar can only display sanitized presence and public readiness metadata.

### One-time short-lived capability token

Deferred candidate for a later phase. If this is implemented, the token must be
minted by `go` after an explicit user gesture in an authenticated `go` page. It
must be audience-bound to the exact extension id, route-limited, short lived,
single purpose, and revocable server side.

Minimum future constraints:

- TTL: minutes, not days.
- Scope: one operation family, such as backup status or one explicit fill.
- Refresh: no refresh token in the extension.
- Storage: memory only; never `chrome.storage.local`, `chrome.storage.sync`,
  `chrome.storage.session`, IndexedDB, Cache Storage, or native-host files.
- Revocation: logout, vault lock, device ban, session stamp mismatch, and server
  policy changes invalidate the capability.
- Failure mode: fail closed and open `go` instead of retrying with broader auth.

### Extension-origin bound session check

Deferred. Cloudflare Access and browser cookies do not make a Chrome extension
origin equivalent to the `go` webapp origin. A CORS allowlist can prove the
caller origin, but it does not prove that the caller should receive vault
authority. This option still needs an explicit capability or same-origin
handoff before it can perform authenticated operations.

### Open-go-only route launching

Selected companion behavior. The extension can open trusted `go` routes for
vault, login, unlock, backups, import/export, devices, and settings. `go` owns
all authenticated checks after navigation.

## Storage rules

Allowed extension storage:

- configured password app URL
- selected provider
- public status result and timestamp
- sanitized browser-session pulse:
  `state`, `email`, `role`, `origin`, `route`, `checkedAt`
- non-sensitive UI preferences

Forbidden extension storage:

- access tokens
- refresh tokens
- master password
- WebDAV password
- OAuth secrets
- session cookies or cookie-derived bearer material
- encrypted vault ciphers
- decrypted vault ciphers
- generated passwords by default
- domain password match caches

`chrome.storage.session` is not an exception. It is disallowed for `go`
credentials because MV3 service-worker lifetime, extension debugging, and future
code reuse make "temporary" credential storage easy to misuse.

## Lifetime, revocation, and refresh

The current session pulse is informational only. It expires locally after the
freshness window in `src/lib/go-vault-session-state.ts`, and stale data must be
rendered as not linked.

There is no extension credential lifetime, refresh behavior, or revocation path
because no extension credential exists. Any future capability token must define
all three before code can call authenticated `go` endpoints.

## Cloudflare Access, go sessions, and origins

Cloudflare Access gates the deployed `go` worker and protects the app surface.
The `go` web session remains the authority for vault identity, role, lock state,
and admin capability. The extension id
`chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh` is only a CORS allowlist
input for public bridge reads, not an authentication principal.

Custom `go` domains are allowed for route launching and browser-session pulse
validation when configured by the user. They do not broaden token storage rules.

## Deferred features

The following remain out of scope until a separate security review and user
gesture model exist:

- passive autofill
- auto-submit
- domain password matching
- clipboard writes
- generated password save flow
- direct vault item reads
- direct backup execution
- direct import/export execution
- device/session management from the extension

## Implementation guardrails

- `src/lib/go-vault-client.ts` keeps authenticated bridge calls disabled.
- Extension bridge fetches use `credentials: "omit"`.
- `PasswordVaultSection` returns no bearer for `go` bridge calls.
- `src/lib/go-vault-session-state.ts` sanitizes the browser-session pulse before
  storage.
- `tests/go-vault-token-session-handoff.test.ts` fails if these boundaries drift.

