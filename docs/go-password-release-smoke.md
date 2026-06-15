# Go password release smoke

Date: 2026-06-14 PDT / 2026-06-15 UTC
Linear: ALO-711
Worker: `go`
Public URL: `https://go.lazee.workers.dev`
Deployed Worker version: `5b9fb1d0-0c0b-47ba-a853-1376d0b369d2`

## Deployed worker surface

`npm run deploy` from `password-app/` deployed the `go` Worker with:

- D1 binding `DB` -> `go-db`
- R2 binding `ATTACHMENTS` -> `go-attachments`
- Durable Object `NOTIFICATIONS_HUB` -> `GoNotificationsHub`
- Durable Object `BACKUP_TRANSFER_RUNNER` -> `GoBackupTransferRunner`
- service binding `DAV_WEBDAV` -> `dav`
- cron trigger `*/5 * * * *`

The deployed SPA routes return HTTP 200:

- `/vault`
- `/backup`
- `/backup/import-export`
- `/security/devices`
- `/settings`
- `/login`

## Extension bridge routes

`GET /api/extension/status` is public and returned:

```json
{
  "object": "go-extension-status",
  "ok": true,
  "version": "2026.4.1",
  "registrationInviteRequired": true,
  "bridgeVersion": 1,
  "routes": {
    "vault": "/vault",
    "importExport": "/backup/import-export",
    "backups": "/backup",
    "devices": "/security/devices",
    "settings": "/settings",
    "login": "/login"
  },
  "apiRoutes": {
    "status": "/api/extension/status",
    "session": "/api/extension/session",
    "backupStatus": "/api/extension/backup/status",
    "importStatus": "/api/extension/import/status",
    "deviceStatus": "/api/extension/devices/status"
  },
  "storagePolicy": {
    "extensionStoresVaultPasswords": false,
    "decryptedSecretsStoredByExtension": false,
    "passiveAutofillEnabled": false
  }
}
```

Unauthenticated requests to the deferred bridge routes return HTTP 401:

- `/api/extension/session`
- `/api/extension/backup/status`
- `/api/extension/import/status`
- `/api/extension/devices/status`

The known extension origin
`chrome-extension://gkhofjjpnilonbinehpkblmcflbclcoh` receives credentialless
CORS for `/api/extension/status`. An arbitrary extension origin does not receive
`access-control-allow-origin`.

## Extension build evidence

`pnpm build` refreshed the unpacked extension at `build/`.

Manifest checks:

- `manifest_version`: `3`
- `name`: `Brave Dev Extension`
- `side_panel.default_path`: `sidepanel.html`
- `chrome_url_overrides.newtab`: `newtab.html`
- `content/go-vault-session.js` emitted and registered in `build/manifest.json`

The password panel route buttons now use unique accessible names:

- status cards: prefixed with `Next step`, `Open Backups status`, and
  `Open Import / Export status`, followed by the live value and detail
- route tiles: `Open Vault`, `Open Import / Export`, `Open Backups`, `Open Devices`

This avoids Playwright strict-mode ambiguity while keeping the visible UI the
same and preserving the dynamic status context for screen readers.

## Local validation

Commands that passed:

```bash
cd password-app
npm exec wrangler -- whoami
npm run build
npm run deploy

cd ..
pnpm typecheck
pnpm build
pnpm exec vitest run tests/password-vault-section.test.tsx tests/go-vault-session-state.test.ts tests/go-vault-token-session-handoff.test.ts tests/go-vault-client.test.ts tests/go-extension-bridge-contract.test.ts tests/go-extension-bridge-cors.test.ts tests/go-vault-readiness-prototype.test.ts tests/chrome-store-shipping.test.ts tests/storage.test.ts tests/extension-build-path.test.ts
pnpm exec playwright test tests/e2e/passwords-section.spec.ts
pnpm test
```

Observed known non-fatal test noise:

- `pnpm test` logs repeated `ECONNREFUSED ::1:41184` and
  `ECONNREFUSED 127.0.0.1:41184`, but exits 0.
- Final full-suite result: 130 files passed, 1 skipped; 880 tests passed, 3
  skipped.

## Manual recovery

If the extension cannot load, rebuild from the repo root and load the unpacked
extension from `build/`:

```bash
pnpm build
```

If the native terminal, Doppler login, or local MCP bridge reports the native
host is not connected, reinstall the host and reload Brave:

```bash
pnpm install-host
```

If the Vault panel shows `Offline`, `Bridge pending`, or stale go tab state:

1. Open `https://go.lazee.workers.dev`.
2. Sign in or unlock in the go app.
3. Reload the extension sidepanel.
4. Press `Check` in the Vault tab.

If the deployed status route is stale, redeploy from `password-app/`:

```bash
npm run deploy
```

Do not add a bearer-token handoff to the extension as a recovery shortcut.
Authenticated extension bridge calls remain intentionally disabled until a
separate token/session review changes the contract.
