# Go extension bridge public contract

Status: active public bridge contract
Scope: `go` password app endpoints consumed by the Brave Dev Extension

## Public status endpoint

`GET /api/extension/status` is the only unauthenticated extension bridge route.
It returns reachability and deployment metadata only:

- app version
- JWT safety label and minimum configured length
- invite gate status
- route table for `go` screens
- read-only capability flags
- storage policy flags proving the extension is not the vault of record

It must not return account data, session data, backup destinations, WebDAV or
S3 configuration, import files, vault items, tokens, ciphers, passwords, master
keys, generated values, or decrypted data.

## CORS boundary

The public status route is readable from:

- same-origin `go` webapp requests
- the known local Brave Dev Extension origin:
  `chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh`

For extension-origin requests to `/api/extension/*`, CORS is credentialless.
The extension should continue using `credentials: "omit"` unless a later
token/session design review explicitly changes this model. The current decision
record is [`go-token-session-handoff.md`](./go-token-session-handoff.md), which
defers authenticated extension operations.

Arbitrary extension origins are not granted CORS for `/api/extension/*`.
Existing Bitwarden-compatible public routes such as `/api/version`,
`/api/config`, `/config`, and `/icons/*` keep their existing wildcard behavior.

## Deferred authenticated bridge routes

`/api/extension/session`, `/api/extension/backup/status`, and
`/api/extension/import/status` remain design-review gated from the extension
point of view. The backend may expose sanitized handlers for same-origin app
use, but the browser extension should not call them with cookies or tokens
until the token/session handoff decision record lands.

## Executable checks

- `tests/go-extension-bridge-contract.test.ts` verifies public status and backup
  responses do not expose credential-shaped fields.
- `tests/go-extension-bridge-cors.test.ts` verifies the known-extension CORS
  allowlist and credentialless extension bridge behavior.
