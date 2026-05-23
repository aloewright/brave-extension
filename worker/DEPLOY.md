# Deploying sidebar-api (Phase 1)

These steps need to run on your machine — they touch your Cloudflare
account, which the development sandbox can't reach. Each command must
succeed before continuing.

## 1. Auth

```bash
cd worker
pnpm exec wrangler login
```

This opens a browser; complete the login flow.

```bash
pnpm exec wrangler whoami
```

Confirm the account email matches the one you want to deploy under.

## 2. Provision D1

```bash
pnpm exec wrangler d1 create sidebar
```

Wrangler prints a block like:

```
[[d1_databases]]
binding = "DB"
database_name = "sidebar"
database_id = "abcd1234-..."
```

Open `worker/wrangler.toml` and replace `REPLACE_WITH_D1_ID` with the
printed `database_id`. Save.

## 3. Provision Vectorize

```bash
pnpm exec wrangler vectorize create sidebar-search --dimensions=768 --metric=cosine
```

Expected: `Created index 'sidebar-search'`.

## 4. Apply the migration locally and remotely

```bash
pnpm d1:migrate:local
pnpm d1:migrate:remote
```

Each should print `Executed 1 command` (the `0001_init.sql` migration —
seven tables and their indexes).

## 5. Set the shared-secret token

Generate a token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save the printed value in your password manager — you will paste it
into the extension settings later. Push it as a Worker secret:

```bash
pnpm exec wrangler secret put SIDEBAR_TOKEN
# Paste the value, press Enter.
```

## 6. Deploy

```bash
pnpm deploy
```

Wrangler prints a public URL — something like
`https://sidebar-api.<account>.workers.dev`. Capture it.

## 7. Smoke-test

```bash
TOKEN=<your token>
URL=<your public URL>

# Health route — no auth needed.
curl -fsS "$URL/api/health"

# Auth gate.
curl -s "$URL/api/conversations" -o /dev/null -w "%{http_code}\n"  # → 401
curl -fsS -H "X-Sidebar-Token: $TOKEN" "$URL/api/conversations"     # → { "conversations": [] }

# Create + search round-trip.
curl -fsS -H "X-Sidebar-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/conversations" \
  -d '{"backend":"claude","title":"hello widgets","content_text":"talking about widgets","started_at":1,"message_count":1}'

curl -fsS -H "X-Sidebar-Token: $TOKEN" -H "Content-Type: application/json" \
  "$URL/api/search" \
  -d '{"query":"widgets"}'
```

The last response should contain at least one result with
`"type":"conversation"` and the title `"hello widgets"`.

## 8. Optional — custom domain

Add a route to `worker/wrangler.toml`:

```toml
routes = [
  { pattern = "sidebar.pdx.software/*", zone_name = "pdx.software" }
]
```

Then `pnpm deploy` again. The route requires the zone to be in the
same Cloudflare account.

## 9. Commit the populated wrangler.toml

Only the populated `database_id` should change. Don't commit any token
or secret.

```bash
cd ..
git add worker/wrangler.toml
git commit -m "chore(worker): wire wrangler.toml to provisioned D1"
```

## Troubleshooting

- **AI calls 4xx**: Workers AI requires you to have at least once
  enabled the AI catalog in the Cloudflare dashboard for the account.
- **Vectorize "index not found"**: re-run step 3, confirm the index
  name in `wrangler.toml` matches.
- **D1 "database not found"**: confirm the `database_id` in
  `wrangler.toml` matches the id from step 2.
- **`SIDEBAR_TOKEN` not set**: rerun step 5; the secret persists per
  Worker, not per deploy.
