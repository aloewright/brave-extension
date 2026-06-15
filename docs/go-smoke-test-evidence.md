# Go password bridge — smoke test evidence

Status: verified 2026-06-15  
Branch: fly-dev/run_d14ac7e09bc24bcfbcfa6ae461d9a425  
Related: ALO-705, ALO-708

## Extension build

```
node scripts/build-extension.mjs
```

Vite/Rolldown succeeded. Key build artifacts:

| Artifact | Size |
|---|---|
| `build/static/background/index.js` | 114 kB |
| `build/content/go-vault-session.js` | 1.48 kB |
| `build/assets/sidepanel.*.js` | 726 kB |

## manifest.json content script verification

`build/manifest.json` includes the `go-vault-session` content script at position 2:

```json
{
  "matches": ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"],
  "js": ["content/go-vault-session.js"],
  "run_at": "document_idle",
  "all_frames": false
}
```

This matches `https://go.lazee.workers.dev` (default) and any custom `passwordAppUrl`
including localhost.

## Go-vault test suite — all pass

```
pnpm test tests/go-extension-bridge-contract.test.ts \
          tests/go-extension-bridge-cors.test.ts \
          tests/go-vault-client.test.ts \
          tests/go-vault-session-state.test.ts \
          tests/go-vault-token-session-handoff.test.ts \
          tests/go-vault-readiness-prototype.test.ts
```

Result: **6 test files, 40 tests — all pass.**

The `go-vault-token-session-handoff.test.ts` required adding `// @vitest-environment node`
at the top (it reads source files with `node:fs`; happy-dom environment doesn't expose
Node builtins).

## Storage key safety

Verified that none of the go-vault extension source files contain:

- `chrome.storage.session` usage — not present ✅
- `accessToken` / `refreshToken` patterns — not present ✅
- storage keys matching `passwords.go.*.(token|secret|credential|bearer|jwt)` — not present ✅

The only `chrome.storage.local` interaction is `passwords.go.sessionStatus.v1`,
which stores the sanitized browser-session pulse: `state`, `email`, `role`,
`origin`, `route`, `checkedAt`. No vault passwords, no tokens, no ciphers.

## Status flow smoke coverage (unit-verified)

The `go-vault-readiness-prototype.test.ts` exercises the following states:

| State | Coverage |
|---|---|
| Offline / unreachable | ✅ |
| Reachable but bridge not deployed | ✅ (configure action) |
| Signed out (`not_linked` API + `signed_out` browser session) | ✅ |
| Locked browser session | ✅ |
| Unlocked browser session | ✅ |
| Stale pulse (expired) | ✅ |
| Unlocked + admin with healthy backup | ✅ |
| Unlocked + admin with unhealthy backup | ✅ |
| Non-admin (no backup health) | ✅ |
| Import available / unavailable | ✅ |

## Default and custom URL scenarios (unit-verified)

`go-vault-client.test.ts` verifies:

- Default `https://go.lazee.workers.dev/api/extension/status` reachable without credentials.
- Authenticated bridge calls (`/api/extension/session`, `/backup/status`, `/import/status`)
  return empty stubs while `GO_VAULT_AUTHENTICATED_EXTENSION_BRIDGE_ENABLED = false`.
- Falls back to legacy `checkPasswordAppStatus` when `/api/extension/status` is absent
  (pre-bridge Worker deployments).

## CORS and credential safety

`go-extension-bridge-cors.test.ts` verifies:

- Extension origin `chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh` is allowed on
  `/api/extension/status` without `credentials: "include"`.
- Arbitrary extension origins do not receive CORS for `/api/extension/*`.
- Same-origin webapp requests remain credential-capable.
- Existing public routes (`/api/version`, `/api/config`, `/icons/*`) keep wildcard CORS.

## Bridge contract safety

`go-extension-bridge-contract.test.ts` verifies that no credential-shaped fields or
values leak through the public status, backup status, import status, or device status
responses.

## Known noisy test failures (pre-existing, unrelated to go bridge)

| File | Failure reason |
|---|---|
| `tests/password-vault-section.test.tsx` (7 tests) | `act()` not supported in React 18 production build. Test environment imports production React. Pre-existing. |
| ~48 other test files | `node:fs`/`node:path` imports in `happy-dom` environment. Pre-existing infrastructure gap. Same fix (`// @vitest-environment node`) applies but is out of scope here. |

These failures are unrelated to the go password bridge and were present before this work.

## Deployed routes

| Route | URL |
|---|---|
| Default go worker | `https://go.lazee.workers.dev` |
| Public extension status | `https://go.lazee.workers.dev/api/extension/status` |
| Vault (route-open only) | `https://go.lazee.workers.dev/vault` |
| Login (route-open only) | `https://go.lazee.workers.dev/login` |
| Backups (route-open only) | `https://go.lazee.workers.dev/backup` |
| Import/Export (route-open only) | `https://go.lazee.workers.dev/backup/import-export` |
| Devices (route-open only) | `https://go.lazee.workers.dev/security/devices` |
| Settings (route-open only) | `https://go.lazee.workers.dev/settings` |

## Manual recovery steps

### Extension not detecting go status

1. Open `chrome://extensions`, find Brave Dev Extension, click Reload.
2. Open the sidepanel and navigate to Passwords.
3. If status shows "offline": confirm `https://go.lazee.workers.dev/api/extension/status`
   returns 200 via `curl -s https://go.lazee.workers.dev/api/extension/status | jq .ok`.
4. If using a custom URL: open Settings → Passwords → reset `passwordAppUrl` to the
   correct origin, save, and re-check.

### Session pulse not updating (stale state shown)

The browser-session content script (`go-vault-session.js`) only fires when a `go` tab
is open and emits a `go-vault:browser-session:v1` message. To refresh:

1. Open a `go` tab at the configured URL.
2. Sign in or unlock if prompted.
3. Wait up to 10 minutes for the freshness window, or reload the extension.
4. If the panel still shows stale: open DevTools in the sidepanel, check
   `chrome.storage.local.get('passwords.go.sessionStatus.v1')` for the stored pulse.

### JWT unsafe warning shown

The go Worker's `JWT_SECRET` is missing, set to the dev default, or too short.

1. In Cloudflare Workers dashboard, open the `go` Worker → Settings → Variables.
2. Set `JWT_SECRET` to a random string of at least 32 characters.
3. Redeploy. The warning clears on the next `GET /api/extension/status` check.

### Revert to previous extension build

The extension is loaded unpacked. To revert:

1. `git checkout <previous-sha> -- build/` (if the build artifact is tracked), or
2. Re-run `node scripts/build-extension.mjs` on the target commit.
3. In `chrome://extensions`, click Reload on the unpacked extension.
