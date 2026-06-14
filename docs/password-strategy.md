# Password strategy

## Current decision

Use the self-hosted `go` app at `https://go.lazee.workers.dev` as the active password manager.

The Brave Dev Extension should not be the vault of record. It may expose a password tab for launch/status controls, but it must not inject passive password autofill, auto-submit login forms, or store decrypted vault passwords in extension storage.

## What changed

- The Passwords sidebar surface is a thin `go` launcher/status panel.
- The passive password autofill content script is removed.
- The background `PASSWORDS_MATCH_LOGINS` endpoint is removed.
- Legacy password storage keys are purged on service-worker load, startup, and install.

## Runtime boundary

The extension may keep non-sensitive password-manager metadata in the future, but the current policy is:

- Vault passwords: do not store.
- Decrypted secrets: memory only, after explicit unlock.
- Autofill: explicit user action only.
- Auto-submit: disabled by default.
- Provider of record: self-hosted `go`.

The code boundary lives in `src/lib/password-strategy.ts`.

Settings exposes this as a visible Password strategy card:

- Provider of record defaults to self-hosted `go`.
- Extension vault storage is shown as disabled.
- Passive autofill is shown as disabled.
- The self-hosted password app URL defaults to `https://go.lazee.workers.dev` and can be changed for launch/status integration.
- Legacy Nodewarden/password cache keys can be purged manually.

## Future extension fill/copy shape

If extension fill/copy comes back, it should connect to `go` as a real self-hosted service, not as a plaintext browser-extension cache.

Recommended architecture:

1. Keep `go` as the vault of record.
2. Store encrypted vault items server-side.
3. Require an explicit unlock in the extension.
4. Query only domain-relevant metadata before unlock.
5. Decrypt individual secrets only after unlock and only for the requested fill/copy action.
6. Keep decrypted values out of `chrome.storage.local`.
7. Keep auto-submit off unless there is a separate, deliberate safety review.

## Migration checklist

Before adding secret fill/copy UI:

1. Confirm the self-hosted backend is deployed and owned by this workspace.
2. Confirm encrypted-at-rest storage and an unlock/session model.
3. Add import/export from Proton or the prior Nodewarden instance.
4. Add a one-time purge for any obsolete local cache keys.
5. Build a thin extension client that cannot become the source of truth.
6. Add manual test notes for lock, unlock, copy, fill, logout, and extension reload.
