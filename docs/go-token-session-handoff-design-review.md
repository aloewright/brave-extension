# Go Token / Session Handoff Design Review

Date: 2026-06-15
Status: **Decision recorded — Option A selected. All others deferred or rejected.**
Scope: Whether the extension may ever receive an authenticated go credential, and under what restrictions.
Parent: [ALO-705](https://linear.app/aloey/issue/ALO-705/ai-dev-sidebar-complete-custom-go-password-manager-integration)
References: PR #132, `docs/go-extension-bridge-public-contract.md`, `docs/password-next-phase-swarm-plan.md`, `docs/password-strategy.md`

---

## Background

The `go` webapp keeps bearer tokens in memory and explicitly strips them from persisted browser storage. The current extension bridge is credentialless: `GET /api/extension/status` is unauthenticated, and all authenticated routes (`/api/extension/session`, `/api/extension/backup/status`, `/api/extension/import/status`) are blocked behind this decision record.

The question this document answers: **may the extension ever receive or forward a go credential, and if so, how?**

---

## Options Considered

### Option A — No Token Handoff (Selected)

The extension never receives, requests, or stores any go credential. Authenticated state is derived from two read-only signals:

1. **Browser session pulse** — a content script scoped to `https://go.lazee.workers.dev/*` listens for same-origin `postMessage` app-phase events and forwards only `{ state, origin, timestamp }` to the background. No token is forwarded.
2. **Cookie-authenticated extension bridge routes** — if and when they ship, they rely on the browser's existing go session cookie rather than a separate token. The extension never sees, reads, or stores the cookie value; the browser handles it transparently.

**Storage rule:** nothing is written to `chrome.storage.session`, `chrome.storage.local`, or any other persistent store except the sanitized session state shape (`GoVaultBrowserSessionStatus`), which contains no secrets.

**Lifetime:** the session pulse reflects real-time in-page state; it expires naturally when the go tab closes or the webapp logs out.

**Revocation:** no extension-held token means no revocation surface. The go session expires on the go side; the extension reads the next pulse.

**Refresh:** not applicable. The extension does not hold a token to refresh.

**Failure mode:** if the go tab is closed or the content-script message does not arrive, the extension falls back to the last cached `GoVaultBrowserSessionStatus`. The UI shows a stale indicator and prompts the user to open go.

**Cloudflare Access interaction:** Cloudflare Access sits in front of go's admin routes. The extension makes no requests to those routes. If the user's browser is Access-authenticated, the Access JWT is already in the browser session; the extension does not need to read or replicate it.

**Extension-origin / custom-domain interaction:** `chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh` is the only extension origin granted CORS on `/api/extension/*`, and only for credentialless requests. If the production go domain changes (e.g. from `go.lazee.workers.dev` to a custom domain), the content-script host list and the CORS allowlist on the backend must both be updated before any new bridge calls ship.

**Decision:** this is the current architecture. No code change required to select this option.

---

### Option B — One-Time Short-Lived Capability Token (Rejected)

Go would mint a short-lived, single-use token (e.g. a 60-second HMAC-signed capability JWT) when the user clicks an action button in the extension. The extension would receive the token via the content-script channel, make one authenticated call, then discard it.

**Why rejected:**

- The content-script message channel is not encrypted at rest. A token in that channel is readable by any script that can inject into the go tab or intercept the background message.
- Even a 60-second token creates a revocation surface: if the extension service worker is suspended mid-flight, the token may persist in memory across the suspension boundary.
- The go backend would need a new token minting route and a revocation/expiry index, adding backend complexity with no clear user-visible benefit over opening go directly.
- Chrome's MV3 service worker lifecycle makes "use once and discard" semantically fragile; the worker may restart between receipt and use.

**If reconsidered:** the token must be bound to the specific extension origin and the specific action verb, must expire in ≤ 60 seconds, must be single-use with server-side revocation, and must never be written to `chrome.storage.*` at any point.

---

### Option C — Extension-Origin Bound Session Check (Deferred, not rejected)

The extension calls authenticated go endpoints using the browser's existing session cookie (`credentials: "include"`). No token is forwarded; the browser's cookie jar authenticates the request transparently.

**Why deferred, not rejected:**

- This is the most natural model for a browser extension calling a same-user web app.
- It avoids all token storage concerns.
- It is architecturally sound if go's CORS policy is tightened to allow `credentials: "include"` only for the known extension origin.

**Preconditions before this can ship:**

1. CORS is updated on the go backend to set `Access-Control-Allow-Credentials: true` only for `chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh`.
2. `Access-Control-Allow-Origin` is set to the exact extension origin (not `*`) for any credentialed route.
3. The backend validates that the cookie belongs to the authenticated user and not a session-fixation payload.
4. The extension's calls use `credentials: "include"` only for the authenticated extension bridge routes, not for the public status route.
5. Cloudflare Access is confirmed to pass the session cookie through to the go worker correctly, without stripping it or requiring a separate Access JWT exchange.
6. A separate decision record is written covering which endpoints are in scope, what data they return, and how the extension handles a 401 or Access challenge redirect.

**Storage rule under Option C:** the cookie is browser-managed. The extension stores only the sanitized response shape, same as Option A.

**Extension-origin / custom-domain interaction:** if the go domain changes, `credentials: "include"` requests will fail CORS until the backend allowlist and the extension's fetch URLs are updated together. Domain changes require a coordinated deploy.

---

### Option D — Open-Go-Only Route Launching (Already shipped; no decision needed)

The extension opens go routes in a tab rather than calling authenticated go APIs. This is the current behavior for all action buttons (sign in, unlock, open vault, run backup, import/export, account devices). It requires no credential and no CORS policy.

This option remains the correct model for **write operations** regardless of which read model is selected. The extension must not attempt to perform backup, unlock, import, or device operations itself; it opens the appropriate go route and lets the user act in the go webapp.

---

## Storage Decision Matrix

| Storage location | Allowed contents | Prohibited contents |
|---|---|---|
| `chrome.storage.local` | `passwordAppUrl`, provider selection, last status check timestamp, non-sensitive UI preferences | Master password, WebDAV password, access token, refresh token, encrypted or decrypted cipher payloads, generated passwords, per-site password match caches |
| `chrome.storage.session` | `GoVaultBrowserSessionStatus` (`state`, `origin`, `timestamp`) | Any token, credential, cipher, password, or secret of any kind |
| `chrome.storage.sync` | None currently | All of the above |
| Extension service worker memory | Sanitized status/readiness state only | Any token or credential that would survive a service worker restart |

**Ruling on `chrome.storage.session`:** the sanitized session status (`GoVaultBrowserSessionStatus`) **may** be written to `chrome.storage.session` because it contains no secrets. Any token, credential, or vault payload is **never** stored there.

---

## Cloudflare Access Interaction

Cloudflare Access protects admin-tier go routes. The extension does not call those routes today. If Option C is adopted:

- Access issues a CF_Authorization cookie after the user authenticates via their identity provider in a browser tab. The extension does not trigger or participate in that flow.
- For credentialed extension bridge requests, the go worker must confirm the session is Access-authenticated before returning sensitive data. The extension should handle a 302 redirect to `access.cloudflare.com` as a signed-out failure state, not a credential-retrieval opportunity.
- The extension must not attempt to replicate or forward the CF_Authorization cookie value. If the Access token is absent, the extension shows the user a "sign in via go" action (Option D).

---

## Go Web Session and Extension ID Interaction

- The go session cookie is scoped to `go.lazee.workers.dev` (or the configured custom domain). The extension holds no copy of it.
- The extension origin `chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh` is the only origin granted non-wildcard CORS on `/api/extension/*`. This ID is the local dev extension ID. A packed production extension will have a different ID; the CORS allowlist and content-script host permissions must be updated before any credentialed calls can ship for a packed extension.
- If the extension is reinstalled or the extension ID changes for any reason, all credentialed route calls will fail CORS. The public status route will continue to work (credentialless). The user experience degrades gracefully to Option D behavior.

---

## Deferred Features

The following features are explicitly deferred until a separate decision record is written for each:

| Feature | Deferral reason |
|---|---|
| Passive autofill | Requires domain-matching logic, content-script injection into arbitrary pages, and a clear unlock model. High attack surface. |
| Auto-submit | Explicitly off by default per `docs/password-strategy.md`. Requires an additional safety review and explicit user opt-in mechanism. |
| Domain password matching | Requires per-site index in extension storage. Must not store decrypted passwords as match values. Separate design required. |
| Clipboard writes from background | Clipboard access in MV3 background is restricted. User-gesture requirement and cleanup timing (clear after N seconds) need explicit UX design. |
| Generated password save flow | Generated passwords must not persist in extension storage by default. The save flow requires user confirmation and a direct go API write, not local storage. |
| Explicit fill / copy | Requires unlock model, token or session decision for authenticated go reads, DOM injection safety review, and MV3 clipboard rules. This document is the prerequisite; the fill/copy design record comes after Option C ships. |
| Extension-managed unlock | Unlock must always open the go webapp. The extension must not hold or derive the vault master key. |
| Import / export via extension | Extension may open the go import/export route. It must not buffer import file contents or export payloads in extension storage. |
| Device management via extension | Extension opens the go devices route. No extension-side device credential storage. |
| Backup trigger via extension | Extension opens the go backup route. It does not issue backup API calls. |

---

## Implementation Gate

No code may ship authenticated extension behavior until:

1. This document is merged and linked from `docs/password-strategy.md` and `docs/password-next-phase-swarm-plan.md`.
2. Option C is selected via a follow-up decision record that adds the CORS preconditions listed above, or the project explicitly commits to Option A indefinitely.
3. The backend is updated with a verified CORS policy and a sanitized response audit for any new authenticated route.
4. `tests/go-extension-bridge-contract.test.ts` is updated to cover any new authenticated response shapes and confirm that credential-shaped fields are absent.

Until those conditions are met, the extension continues with Option A (credentialless bridge) and Option D (open-go-only route launching) for all user actions.
