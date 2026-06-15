# Go Token/Session Handoff Design Review

Date: 2026-06-15
Status: Decision recorded — authenticated extension behavior deferred
Scope: Determines whether the extension may ever receive a go credential and under what restrictions
Parent: [ALO-705](https://linear.app/aloey/issue/ALO-705/ai-dev-sidebar-complete-custom-go-password-manager-integration)
Related PR: [#132](https://github.com/aloewright/brave-extension/pull/132) (go-extension-bridge-cors)

## Summary

**Decision: Option A (No Token Handoff) is selected for the current phase.**

The extension does not receive, store, or transmit any go credential. Authenticated operations open go routes in the browser. The credentialless public status endpoint is the only go API the extension calls today. Options B and C are documented as the candidate path if a future phase unlocks authenticated extension behavior after a separate approval.

## Problem Statement

The current safe architecture relies on browser-session presence only. The go webapp intentionally keeps bearer tokens in JavaScript memory and strips them from persisted browser storage. The extension communicates with go only via the unauthenticated `/api/extension/status` endpoint with `credentials: "omit"`.

Authenticated operations — backup status, import readiness, device management, fill/copy, direct vault operations — require the extension to prove identity to go. This review evaluates whether that handoff is safe, what constraints it requires, and whether any form of it should ship.

## Options

### Option A — No Token Handoff (Selected)

The extension holds no go credential of any kind. The public status endpoint answers reachability and capability flags. All authenticated workflows (lock, unlock, backup, import, device management) open the go webapp URL. The extension observes session state only via the browser-session content-script pulse already designed in the swarm plan.

**Storage rules:** nothing additional beyond `passwordAppUrl`, provider selection, and last-check timestamp.

**Lifetime / revocation:** not applicable.

**Failure mode:** if the user's go session is stale, the extension shows "sign in" or "unlock" and opens the relevant go route. No silent credential failure.

**Cloudflare Access / custom domain:** the extension only needs the configured `passwordAppUrl` to be reachable. Access policies are irrelevant because no credentialed request is made.

**Verdict:** safe to ship today. All four status lanes in the swarm plan (reachability, session, backup health, import readiness) can be surfaced from the public endpoint plus the content-script session pulse without credentials.

---

### Option B — One-Time Short-Lived Capability Token

go issues a short-lived HMAC token scoped to a specific extension-safe read operation (e.g., backup health). The extension exchanges it for a sanitized JSON response. The token is never persisted.

**Issuance flow:**
1. User explicitly triggers a refresh action in the extension panel.
2. Extension opens a go route that issues a capability token bound to: `(extension_origin, operation, exp: now+30s)`.
3. The go route sends the token to the extension via `postMessage` or a `chrome.runtime.sendMessage` redirect.
4. The extension immediately uses the token for one HTTP request and discards it.

**Storage rules:**
- `chrome.storage.session`: permitted only for the token's TTL (≤30s). Cleared immediately after use or on lock.
- `chrome.storage.local`: forbidden.
- `chrome.storage.sync`: forbidden.
- Memory only after the one HTTP call. Never survives service worker restart.

**Lifetime:** 30 seconds, single-use. Server-side: HMAC validates expiry without a token store; optionally add a nonce cache to prevent replay within TTL.

**Revocation:** implicit via TTL. go session invalidation does not revoke issued tokens before expiry, which is a 30-second window. Accept this window for read-only operations only. Write operations must not use this model.

**Refresh behavior:** no automatic refresh. Each panel refresh requires a new explicit user action.

**Failure modes:**
- Token expires before use: extension shows a transient error and retries with a new explicit action.
- User logs out of go between issuance and use: go returns 401; extension shows "sign in."
- Token replay: if nonce cache is not implemented, a 30s replay window exists for read-only endpoints. Acceptable risk for read-only; unacceptable for write.

**Cloudflare Access:** if the go deployment is behind Cloudflare Access, the capability token must be issued by go's own code (not CF) so that CF's JWT validation is separate from the capability check. The extension origin is not a CF Access audience; Access must be bypassed for the extension-safe endpoints or the extension must call an Access-exempt subdomain.

**Extension id / custom domain interaction:** the token must be bound to the exact extension origin (`chrome-extension://gkhofjjpnilonbinehpkblmcflcoh`). If the extension id ever changes (e.g., unpacked vs. packed), the token binding breaks. Custom domain matters only if `passwordAppUrl` differs from the go origin that issued the token; CORS must match.

**Verdict:** viable for read-only authenticated status operations. Not recommended for write operations. Adds issuance surface and message-passing complexity. Defer until a specific read-only operation cannot be served by the public endpoint.

---

### Option C — Extension-Origin Bound Session Check

CORS on go's authenticated extension bridge endpoints is configured to accept `credentials: "include"` only from the known extension origin. The extension sends the go session cookie (set by the browser during a normal go login) as the credential. No token is passed; the session cookie is the credential.

**How it works:**
1. User logs into go in the browser normally.
2. go sets its session cookie with `SameSite=None; Secure; HttpOnly`.
3. Extension calls `fetch(url, { credentials: "include" })` from the service worker.
4. go's CORS policy allows `Origin: chrome-extension://gkhofjjpnilonbinehpkblcoh` for `/api/extension/session` and `/api/extension/backup/status`.
5. go validates its session cookie and returns sanitized status.

**Storage rules:**
- Extension never stores the session cookie — the browser cookie jar holds it.
- Extension never stores the response beyond component render lifetime.
- `chrome.storage.session`: may cache sanitized status fields (state, email, role) for up to the polling interval. Must exclude tokens, ciphers, passwords, and backup credentials.
- `chrome.storage.local`: forbidden for session-derived data.

**Lifetime:** tied to the go session cookie lifetime. go controls session expiry. Extension sees 401 when the cookie expires.

**Revocation:** go session invalidation (logout) immediately invalidates all extension calls. No extension-side revocation needed.

**Refresh behavior:** extension polls on a configurable interval (default: 60s). On 401, transitions to "sign in" state and stops polling.

**Failure modes:**
- Cookie is `SameSite=Strict` or `SameSite=Lax`: cross-origin extension `fetch` will not send it. The call succeeds but responds as unauthenticated. Extension must fall back to Option A behavior.
- Extension id changes: CORS allowlist must be updated server-side and redeployed.
- go deployed behind Cloudflare Access: CF Access intercepts the request before go's CORS handler runs. CF does not understand the extension origin as a valid audience; the request is blocked at CF with a 403. Requires an Access bypass rule for the extension-safe subdomain or path prefix.
- CORS misconfiguration (wildcard origin with `credentials: "include"`): browsers block this by spec. A deploy mistake that sets `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` will cause browser-side failure, not a silent credential leak.

**Cloudflare Access:** if go.lazee.workers.dev is protected by Cloudflare Access, the extension is not a valid Access application. Options:
  1. Add an Access bypass rule for `/api/extension/*` gated on a `Cf-Access-Client-Id`/`Cf-Access-Client-Secret` service token embedded in the extension (not recommended; leaks the service token to every user).
  2. Deploy extension-safe routes on a separate Worker binding or subdomain that is not behind Access.
  3. Use Option B (capability token) as the authentication mechanism and have go's Worker validate it after CF Access completes.

**Extension id / custom domain:** the CORS allowlist on the server must be kept in sync with the extension's Chrome store id. The current local dev id is `chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh`. The published extension will have a different stable id. The server must hold the correct production id before Option C is activated.

**Verdict:** the correct long-term model for read-only authenticated status (session, backup health, import readiness). Do not activate until: (1) the Cloudflare Access interaction is resolved, (2) the production extension id is known and set in the CORS allowlist, (3) go's session cookie is confirmed `SameSite=None; Secure`, and (4) the `chrome.storage.session` caching rules are tested in CI.

---

### Option D — Open-Go-Only Route Launching

The extension opens go URLs for all authenticated operations. No credential leaves the browser's native session model. Fill, copy, backup, import, device management, and unlock all open the go webapp, which handles its own session.

This is the current behavior. It is already safe and is not a "handoff" in any meaningful sense. It is recorded here as an explicit option to confirm: if all four status endpoints in the swarm plan can serve the extension's UI needs without credentials, Option D remains the permanent answer for write operations regardless of what is chosen for read-only status.

**Verdict:** default for all write and mutation operations indefinitely. Not superseded by Options B or C.

## Storage Decision Matrix

| Storage location | Status quo (Option A) | Capability token (Option B) | Session cookie (Option C) |
|---|---|---|---|
| `chrome.storage.local` | `passwordAppUrl`, provider, timestamp | same — no new entries | same — no new entries |
| `chrome.storage.session` | not used | token during ≤30s TTL only | sanitized status cache (state, email, role, backupHealthy) |
| `chrome.storage.sync` | forbidden | forbidden | forbidden |
| Memory / component state | UI-derived display only | token during one fetch | session-derived display values, cleared on lock |
| Tokens | never | single-use capability, discarded | never (cookie is browser-managed) |
| Ciphers / passwords / master key | never | never | never |

## Deferred Features

The following features require a separate decision record before any code ships:

| Feature | Blocker |
|---|---|
| Passive autofill | Requires per-domain matching and content-script credential scope review |
| Auto-submit | Requires deliberate safety review; default must remain disabled |
| Domain password matching | Requires definition of what the extension may cache per domain and for how long |
| Clipboard writes from extension | Requires user-visible confirmation flow; background clipboard writes are forbidden |
| Generated password save flow | Requires an explicit extension→go write path; Option B capability token must cover write, or go must be opened for the save action |
| Fill/copy UI | Requires Option C or B to be activated and fully tested |
| Device management from extension | Requires write capability; open go route is the safe default |
| Backup trigger from extension | Requires write capability; open go route is the safe default |
| Import from extension | Requires write capability; open go route is the safe default |

No code implementing any of the above may merge before the relevant decision record is written and reviewed.

## Activation Checklist for Option C (Future)

Before `credentials: "include"` is used for any extension request:

- [ ] Production Chrome extension id is confirmed and set in go's CORS allowlist
- [ ] go session cookie is confirmed `SameSite=None; Secure; HttpOnly`
- [ ] Cloudflare Access interaction is resolved (bypass rule or separate Worker route)
- [ ] `chrome.storage.session` cache shape is reviewed and tested in CI
- [ ] `assertNoSecretsInSessionCache` guard exists in tests (mirrors `assertNoSecretsInReadiness`)
- [ ] Polling interval and 401-fallback behavior are covered by integration tests
- [ ] A separate deploy step documents the CORS allowlist update and how to rotate it if the extension id changes

## Activation Checklist for Option B (Future, Alternative)

Before issuing capability tokens:

- [ ] go's capability token issuance route is isolated from vault operations
- [ ] Token is HMAC-signed with a rotating key; secret is not in the extension
- [ ] Nonce cache is implemented if replay prevention is required
- [ ] `chrome.storage.session` TTL cleanup is tested (token cleared on expiry and on use)
- [ ] Write operations are explicitly blocked from using the capability token model

## Non-Negotiables (All Options)

These rules apply regardless of which option is activated:

1. The extension never stores a master password, vault key, WebDAV password, or S3 secret.
2. The extension never stores decrypted cipher payloads.
3. The extension never stores an access token or refresh token in `chrome.storage.local`.
4. Auto-submit remains off unless a separate safety review approves it.
5. Passive autofill (background domain matching) remains off.
6. All write operations go through the go webapp, not the extension.
7. The extension's go client continues to pass a `x-extension-version` header and the service worker origin header so go can distinguish extension requests from webapp requests.
