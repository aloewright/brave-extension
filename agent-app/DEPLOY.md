# agent-app deploy

## Secrets (Doppler → wrangler)

All secrets live in Doppler. Sync to the Worker:

```bash
doppler run -- sh -c '
  echo "$ACCESS_CLIENT_ID"     | wrangler secret put ACCESS_CLIENT_ID
  echo "$ACCESS_CLIENT_SECRET" | wrangler secret put ACCESS_CLIENT_SECRET
  echo "$ACCESS_AUD"           | wrangler secret put ACCESS_AUD
  echo "$ACCESS_TEAM_DOMAIN"   | wrangler secret put ACCESS_TEAM_DOMAIN
  echo "$CF_ACCOUNT_ID"        | wrangler secret put CF_ACCOUNT_ID
  echo "$CF_AIG_TOKEN"         | wrangler secret put CF_AIG_TOKEN
'
```

## Cloudflare Access

1. Create an Access application for `agent.fly.pm` (self-hosted).
2. Note the application **AUD** → `ACCESS_AUD`.
3. Team domain → `ACCESS_TEAM_DOMAIN` (e.g. `myteam.cloudflareaccess.com`).
4. Create a **service token** for the extension → `ACCESS_CLIENT_ID` /
   `ACCESS_CLIENT_SECRET`. Add an Access policy allowing that service token.
5. Add a policy allowing your own SSO identity (for the web UI, Plan 7).

## KV namespace

```bash
wrangler kv namespace create agent-kv   # paste id into wrangler.toml
```
(Already created during build; id is in wrangler.toml.)

## Migrate + deploy

```bash
pnpm d1:migrate:remote
pnpm deploy
```

## Verify

```bash
curl https://agent.fly.pm/api/health        # { ok: true, ... }
curl -X POST https://agent.fly.pm/api/sessions \
  -H "CF-Access-Client-Id: $ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET" \
  -H 'content-type: application/json' -d '{"title":"smoke"}'
```

## Architecture notes

- `src/index.ts` is the deployed entry (re-exports the `ChatAgent` Durable
  Object, applies `agentsMiddleware()`). `src/app.ts` holds the middleware-free
  `buildApp()` used by unit tests so they stay hermetic (the `agents` /
  `hono-agents` packages load `cloudflare:`-scheme modules that plain vitest
  cannot import).
- D1 (`sidebar`), R2 (`sidebar-blobs`), and Vectorize (`sidebar-search`) are
  shared with the sibling `worker/` (`sidebar-api`) Worker.
- LLM model selection + streaming and Hindsight self-learning land in later
  plans (Plan 2 / Plan 3); Plan 1 echoes assistant replies.
