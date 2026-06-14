# Brave Dev password app

This directory vendors NodeWarden as the foundation for a custom, self-hosted password app.

The important architectural choice is separation:

- `password-app/` owns password-vault runtime, storage, auth, imports, exports, backups, and Bitwarden-compatible sync.
- `worker/` remains the existing sidebar API for captures, search, TTS, media, and agent workflows.
- `src/` remains the browser extension. It may link to this app later, but it should not become the vault of record.

## Upstream

- Project: NodeWarden
- Repository: `https://github.com/shuaiplus/nodewarden`
- Vendored commit: `e9aef72df7929066e06a7b4ca0cda2012bb937ac`
- License: LGPL-3.0, preserved in `LICENSE`

NodeWarden provides a Bitwarden-compatible Cloudflare Workers server, web vault, PWA support, passkeys, D1 storage, R2/KV attachment storage, imports, exports, Sends, and backup tooling.

## Local resource names

Default R2-backed deployment:

- Worker: `go`
- D1 database: `go-db`
- R2 bucket: `go-attachments`
- Workers.dev URL: `https://go.lazee.workers.dev`

KV fallback deployment:

- Worker: `go`
- D1 database: `go-db`
- KV binding: `ATTACHMENTS_KV`

## Secrets

`JWT_SECRET` is required. Do not commit it.

`BOOTSTRAP_INVITE_CODE` is strongly recommended until the first admin account is created. If set, even the first admin registration must provide the invite code, which prevents the public workers.dev URL from being claimed by someone else.

`BOOTSTRAP_ADMIN_EMAIL` restricts the first admin registration to the configured email while the database has no users. The production deployment is currently locked to `aloe@fly.pm`.

Local development can use `.dev.vars`:

```env
JWT_SECRET=replace-with-openssl-rand-hex-32
BOOTSTRAP_INVITE_CODE=replace-with-a-private-bootstrap-code
BOOTSTRAP_ADMIN_EMAIL=aloe@fly.pm
```

Production should use Wrangler secrets:

```bash
cd password-app
npx wrangler secret put JWT_SECRET
npx wrangler secret put BOOTSTRAP_INVITE_CODE
```

Generate a suitable value with:

```bash
openssl rand -hex 32
```

## Commands

Install dependencies:

```bash
cd password-app
npm install
```

Run locally:

```bash
npm run dev
```

Build the web vault:

```bash
npm run build
```

Deploy R2-backed mode:

```bash
npm run deploy
```

Deploy KV-backed mode:

```bash
npm run deploy:kv
```

Sync from upstream later:

```bash
npm run upstream:sync
```

## Extension integration policy

The extension should treat this app as an external vault service.

Allowed future extension behaviors:

- Open the password app.
- Store non-secret endpoint metadata.
- Show connection status.
- Request an explicit copy/fill flow after the user unlocks the vault in the password app.

Not allowed without a separate security review:

- Persisting decrypted passwords in `chrome.storage.local`.
- Passive page-wide password autofill.
- Automatic login form submission.
- Treating the extension as the vault of record.

## Next implementation steps

1. Create Cloudflare D1 and R2 resources for the custom names above.
2. Set `JWT_SECRET`.
3. Set `BOOTSTRAP_INVITE_CODE` before the first public deploy.
4. Deploy `password-app/` to `https://go.lazee.workers.dev` or a dedicated custom domain.
5. Register the first admin with the bootstrap invite code.
6. Rotate or remove `BOOTSTRAP_INVITE_CODE` after first-admin creation if desired.
7. Import from Proton/Bitwarden/NodeWarden export.
8. Paste the deployed URL into Settings -> Password strategy -> Self-hosted password app URL.
9. Add a read-only status check once the deployment URL is known and stable.
