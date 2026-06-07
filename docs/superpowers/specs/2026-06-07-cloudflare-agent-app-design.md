# Cloudflare Agent App + Sidebar AI Chat Tab — Design

**Date:** 2026-06-07
**Status:** Approved (design); pending implementation plan
**Author:** aloe + Claude

## Goal

Build a new Cloudflare-hosted AI agent application and surface its chat in the
AI Dev Sidebar extension as a native tab. The app provides a multi-model chat
agent with self-learning memory, gated by Cloudflare Access, with all model
calls routed through the Cloudflare AI Gateway (`x`) so no per-user API keys are
required.

Named technologies (all in scope): TanStack Start, TanStack AI, Vite, Hono,
Cloudflare Access, D1 / R2 / KV / Vectorize, Hindsight (self-learning), the
Cloudflare Agents SDK + Session API, and the Cloudflare AI Gateway (`x`).
Doppler for secret management.

## Decisions (from brainstorming)

- **App relationship:** New Worker app, but it **shares bindings** with the
  existing `worker/` `sidebar-api` — same `sidebar` D1, `sidebar-blobs` R2, and
  `sidebar-search` Vectorize. Data is shared; deployment is separate.
- **Model picker:** **Hybrid** — default to capability-based dynamic routes
  conceptually, but reliably implemented today via Workers AI models; an
  "advanced" mode allows an explicit model id. See §4 for the gateway
  constraint that shapes this.
- **Access auth:** **Both** — a Cloudflare Access **service token** for the
  extension's machine-to-machine calls, and **SSO / Access JWT** for the
  TanStack web UI opened directly in a browser.
- **Sidebar integration:** A **native React tab** in the extension that calls
  the agent Worker's API directly with the service token, **absorbing** the
  existing `src/sections/ai-chat` section. No iframe.
- **Memory split:** **DO sessions + D1 Hindsight** — the Agents SDK Durable
  Object holds live per-session conversation state (Session API); long-term
  self-learning uses Hindsight (retain/recall/reflect), with D1 as the durable
  ledger and queryable memory mirror.
- **Memory backend:** **Approach A** — Hindsight-as-a-service is the recall
  brain; D1 holds the session/message ledger plus a memory index/mirror so
  everything is also queryable in D1.

## §1 Topology

New directory `agent-app/` in this repo (sibling to `worker/`), deployed as its
own Cloudflare Worker on a new subdomain (target: `agent.fly.pm`).

A single Worker `fetch` entry routes:
- `/api/*` → **Hono** app (auth, chat, models, uploads)
- everything else → **TanStack Start** SSR handler (web UI)

`agent-app/wrangler.toml` declares the **same** bindings as `worker/` for the
shared resources, plus new ones:
- `DB` → D1 `sidebar` (shared)
- `BLOBS` → R2 `sidebar-blobs` (shared)
- `VECTORS` → Vectorize `sidebar-search` (shared)
- `AI` → Workers AI binding (gateway `x`)
- `AGENT_KV` → **new** KV namespace `agent-kv`
- `CHAT_AGENT` → **new** Durable Object binding (Agents SDK)

## §2 Agent runtime

A Cloudflare **Agents SDK** `Agent` Durable Object class `ChatAgent`.

- Live per-conversation state (message history, in-flight turn) lives in the DO
  via the **Session API**; requests routed with `routeAgentRequest`.
- Per turn: **recall** relevant memories → assemble context → **stream** model
  output → **persist** the turn to D1 → **retain/reflect** into Hindsight (+ D1
  mirror).
- D1 is the durable ledger; the DO is the hot session.

## §3 Storage roles

- **D1** (`sidebar`, new migrations): `agent_sessions`, `agent_messages`,
  `agent_memories` (queryable mirror/index of Hindsight entries).
- **Vectorize** (`sidebar-search`): embeddings for chat file/RAG attachments.
- **R2** (`sidebar-blobs`): uploaded files/images in chat.
- **KV** (`agent-kv`): model catalog cache, per-user selected model/route prefs.
- **Hindsight** (via `@vectorize-io/hindsight-client`): recall/retain/reflect
  brain; D1 `agent_memories` mirrors entries so they are also in D1.

## §4 Models / AI Gateway (constraint-driven)

Per the user's CLAUDE.md, all three Worker-side gateway paths are currently
broken: `env.AI.run("dynamic/...")` 404s, `env.AI.gateway().run` skips fallback
nodes, and `fetch()` to `/compat` from inside a Worker is rejected (CF error
2019). The **only reliable Worker-side call today** is:

```ts
// Worker-side gateway call. See ~/.claude/CLAUDE.md "Inside a Worker" —
// dynamic routes are broken on all three paths; this direct-model form is
// the sanctioned exception. Swap back to dynamic/text_gen when fixed upstream.
env.AI.run("@cf/<model>", { messages, max_tokens }, { gateway: { id: "x" } })
```

Therefore:
- **Default / reliable picker entries** = Workers AI models
  (`@cf/openai/gpt-oss-120b`, `@cf/meta/llama-3.1-8b-instruct-fp8`, …) via
  `env.AI.run` through gateway `x`. No BYOK; fully working.
- **Hybrid "advanced" entries** = explicit non-CF model ids (e.g. GPT-4o,
  Claude) attempted via `env.AI.gateway(id).run` compat with an explicit model
  id, behind a feature flag, each call carrying a code comment pointing at the
  CLAUDE.md section. These flip to true dynamic routes when the upstream Worker
  gateway path is fixed.

So "any model without BYOK" works **fully for Workers AI models now**, and
best-effort/experimental for external providers until the gateway Worker path is
fixed. Model ids must be verified current at implementation time (the CLAUDE.md
notes several CF model ids were removed).

`/api/models` returns the catalog (capability routes + concrete CF model ids +
advanced explicit-model entries), cached in KV.

## §5 Auth (Cloudflare Access) + Doppler

Cloudflare Access sits in front of `agent.fly.pm`. A Hono middleware accepts
**either**:
- a **service token** (`CF-Access-Client-Id` / `CF-Access-Client-Secret`) — used
  by the extension; or
- a verified **Access SSO JWT** (`Cf-Access-Jwt-Assertion`) — used by the web
  UI, validated against the team's Access public certs (JWKS) and audience.

All secrets live in **Doppler**, synced to the Worker via `wrangler secret put`:
`CF_ACCOUNT_ID`, `CF_AIG_TOKEN`, Access service-token id/secret, Access AUD +
team domain, Hindsight API key. The extension's service-token pair is injected
at build time from Doppler.

## §6 Sidebar tab

Absorb the existing `src/sections/ai-chat` section into a new `agent` section
using the existing **background-orchestrator + `chrome.runtime` broadcast**
pattern (consistent with the current chat implementation).

- The background orchestrator calls `agent.fly.pm/api/chat` with the service
  token and streams SSE turns, re-broadcasting `turn-update` / `turn-done`
  events to the panel.
- UI reuses the existing chat view patterns plus a **model picker** (§4).
- Registered in the rail/tab config alongside the other sections; the old
  `ai-chat` entry is replaced.

## §7 Web UI

A TanStack Start chat route using **TanStack AI** for streaming chat and the
model picker, behind Access SSO. Shares the same `/api/chat` backend as the
extension.

## §8 Testing & build

- Unit/integration: plain **vitest** with the `node:sqlite` D1 adapter (per the
  repo's known vitest-pool-workers limitation — cannot init wrapped bindings).
- E2E: **Playwright** for the sidebar tab.
- Deploy: Doppler-wrapped `wrangler deploy`, documented in
  `agent-app/DEPLOY.md`.

## Build phases (for the implementation plan)

1. Scaffold `agent-app/` (TanStack Start + Vite + Hono + wrangler; shared
   bindings + new KV + DO).
2. Cloudflare Access + Doppler secrets + Hono auth middleware (service token +
   SSO JWT).
3. Agents SDK `ChatAgent` DO + Session API + D1 migrations
   (sessions/messages/memories).
4. AI Gateway model layer (catalog, `env.AI.run` CF models default, hybrid
   advanced path, `/api/models`, `/api/chat` streaming).
5. Hindsight self-learning (retain/recall/reflect + D1 mirror).
6. Sidebar native `agent` tab (absorb `ai-chat`, orchestrator, service-token
   streaming, model picker).
7. TanStack AI web UI (chat route, model picker, SSO).
8. Tests + `DEPLOY.md`.

Given the size, the implementation plan may split these phases into more than
one plan/spec cycle.

## Out of scope (YAGNI)

- Multi-tenant / multi-user beyond the single Access identity.
- Billing, usage dashboards.
- Replacing the existing `worker/` `sidebar-api` — it stays as-is; the agent app
  only shares its storage bindings.
