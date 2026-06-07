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

## Models

Plan 2 adds model selection + streamed completions through Cloudflare AI
Gateway `x`.

### Endpoints

- `GET /api/models` — returns the model catalog (`{ models: [...] }`). Each
  entry has `id`, `label`, `kind` (`workers-ai` | `advanced`), and
  `experimental?`.
- `GET /api/prefs/model` — the caller's selected model id (defaults to
  `DEFAULT_MODEL_ID` when unset).
- `PUT /api/prefs/model` — set the caller's selected model (`{ modelId }`);
  unknown ids fall back to the default. Stored in KV under
  `pref:model:<userId>`.
- `POST /api/sessions/:id/messages/stream` — streamed send. Returns
  `text/event-stream` with `data: {"delta":"..."}` chunks ending in
  `data: [DONE]`. Body: `{ content, modelId?, advanced? }`. `modelId` defaults
  to the user's KV preference. The non-stream `POST /api/sessions/:id/messages`
  also honors `modelId`/`advanced`.

### Reliability

- **Workers AI** models (`kind: "workers-ai"`) are the reliable default — they
  run via `env.AI.run("@cf/<model>", payload, { gateway: { id: "x" } })`, the
  only Worker-side gateway path that works today (see
  `~/.claude/CLAUDE.md` → "Inside a Worker").
- **Advanced** models (`kind: "advanced"`, `experimental: true`) call explicit
  non-CF model ids via the gateway compat run, gated behind the per-request
  `advanced` flag. This path may be unreliable until the upstream dynamic-route
  Worker bug is fixed — surface it to users as experimental.

### Before deploy

- **Verify Workers AI model ids are current.** CLAUDE.md notes ids get removed
  (e.g. `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and
  `@cf/meta/llama-3.1-8b-instruct-fast` were removed). `@cf/openai/gpt-oss-120b`
  and `@cf/meta/llama-3.1-8b-instruct-fp8` were current as of 2026-05-10.
  Update `src/models.ts` and bump the `models:catalog:v1` KV cache key if the
  catalog changes (the catalog is KV-cached).

### Smoke test

```bash
curl https://agent.fly.pm/api/models \
  -H "CF-Access-Client-Id: $ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET"
# { "models": [ { "id": "@cf/openai/gpt-oss-120b", "label": "...", "kind": "workers-ai" }, ... ] }
```

## Self-learning (memory)

The agent has a durable, self-learning memory layer (`src/memory.ts`).

- **Storage.** Memories are the system-of-record in D1 table `agent_memories`
  (`id`, `user_id`, `session_id`, `kind`, `content`, `hindsight_ref`,
  `created_at`) and are mirrored into the shared Vectorize index
  (`sidebar-search`) with metadata `type: "agent_memory"` and `user_id` so
  recall can be scoped per user.
- **Embeddings.** Both retain and recall embed text with
  `@cf/baai/bge-base-en-v1.5` routed through AI Gateway `x`
  (`env.AI.run(..., { gateway: { id: "x" } })`, the CLAUDE.md-sanctioned
  Worker-side pattern).
- **Recall.** On each turn the `ChatAgent` embeds the user message, queries
  Vectorize filtered to the caller's `user_id`, joins the matching D1 rows, and
  prepends them as a system message ("Relevant memories about this user:")
  before generating. The `user_id` is threaded from the authenticated route
  (`sessions.ts`) into the DO body; when absent (`"unknown"`) recall is skipped.
- **Reflection.** After each turn the agent runs `reflect()` best-effort: it
  summarizes the latest exchange via `collectCompletion` and, unless the model
  replies `NONE`, retains the extracted fact as a `reflection` memory. Failures
  are swallowed so a reflection error never breaks a chat turn.
- **Future swap.** This D1+Vectorize implementation can be replaced by the
  `@vectorize-io/hindsight-client` service later behind the same `memory.ts`
  interface (`embed`/`retainMemory`/`recallMemories`/`reflect`).

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
