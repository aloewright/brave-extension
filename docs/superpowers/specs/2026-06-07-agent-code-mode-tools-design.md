# Agent Code Mode + Tool Sources + Self-Learning Memory — Design

**Date:** 2026-06-07
**Status:** Approved (brainstorm), pending implementation plan
**Component:** `agent-app` Worker (`agent.fly.pm`) + extension Settings UI

## Problem

The cloud agent chat (`agent.fly.pm`, the ChatAgent Durable Object) sends plain
text to `env.AI.run` with **no tool calling**. The MCP servers shown in the
extension Settings reflect only the **local** Claude Code / native-host world
(`127.0.0.1:8473`) — they are not connected to, and cannot be reached by, the
cloud agent. We want the cloud agent to:

1. Call tools via **TanStack AI Code Mode** (model writes TypeScript executed in
   a sandbox; tools exposed as `external_*` functions).
2. Draw tools from **four sources** (built incrementally): Worker-native,
   remote MCP servers, browser code-mode ops, local native-host MCP via tunnel.
3. Show honest **per-source connection status** in Settings, from the cloud
   agent's perspective (the green/red dots that today only mean "local Claude").
4. Use **Hindsight** as durable cross-agent memory, fed by a **self-reflection
   cron** that runs a few times a day.

## Decisions (from brainstorm)

- **Mechanism:** TanStack AI Code Mode (`@tanstack/ai`, `@tanstack/ai-code-mode`,
  `@tanstack/ai-isolate-cloudflare`).
- **Scope:** Design the full four-source architecture; **build slices 1 & 2**
  (Worker-native + remote MCP). Browser ops and local-tunnel are follow-on plans
  against the same `ToolSource` seam.
- **A1 — model adapter:** custom thin TanStack AI text adapter over
  `env.AI.run(model, …, { gateway: { id: "x" } })`. The only sanctioned
  Worker-side gateway path (per `~/.claude/CLAUDE.md` "Inside a Worker"); avoids
  the documented error-2019 rejection of Worker `fetch()` to the gateway compat
  endpoint, and the broken `dynamic/*` resolution via `env.AI.run`.
- **B2 — sandbox location:** mount TanStack AI's pre-built Cloudflare isolate
  handler **inside `agent-app`** at an internal route. The eval isolate receives
  **no env bindings**; tools round-trip back to the host via the driver's tool
  callback, so "same Worker" costs a shared CPU boundary, not data access.
- **Memory:** Hindsight wired as a remote-MCP source (slice 2) **plus** a cron
  self-reflection step; local Vectorize stays as fast working memory.

## Key external facts (verified)

- **TanStack AI Code Mode:** `createCodeMode({ driver, tools }) → { tool,
  systemPrompt }`. `chat({ adapter, tools:[tool], systemPrompts:[base,
  systemPrompt], messages })` runs the loop. Model calls a single
  `execute_typescript` tool; the driver runs the code in a sandbox and exposes
  the registry tools as `external_<name>`. Tool callbacks round-trip host↔isolate
  (`maxToolRounds`, default 10). Result shape: `{ success, result?, logs?,
  error? }`. **Requires a function-calling-capable model.**
- **Cloudflare isolate driver:** `createCloudflareIsolateDriver({ workerUrl,
  authorization?, timeout?, maxToolRounds? })` is an HTTP client that POSTs the
  generated code to a Worker endpoint running the pre-built handler, which needs
  an **unsafe-eval binding** in `wrangler.toml`. Must be locked down
  (authorization / Access).
- **Hindsight backend:** GCP Compute Engine VM + **Postgres** (likely pgvector),
  exposed via Cloudflare Tunnel at `https://hindsight.fly.pm/mcp`, behind
  Cloudflare Access (`CF-Access-Client-Id/Secret`) + Bearer. **Not D1** — a
  genuinely separate store from the agent's D1/Vectorize, so mirroring is
  meaningful. Reachable from the Worker via the same header auth the extension
  already uses for `agent.fly.pm`.

## Architecture

```
ChatAgent DO (agent-app)
  ├─ buildToolRegistry(env, ctx) → ServerTool[]      assembles enabled sources
  │     ├─ workerNativeSource(env)        [slice 1]
  │     ├─ remoteMcpSource(cfg)           [slice 2]  (incl. Hindsight entry)
  │     ├─ browserOpSource(channel)       [later]
  │     └─ localTunnelSource(cfg)         [later]
  ├─ createCodeMode({ driver, tools })   driver = createCloudflareIsolateDriver(
  │                                          { workerUrl: SELF, authorization })
  └─ chat({ adapter: envAiAdapter(env),
            tools:[codeModeTool],
            systemPrompts:[BASE, systemPrompt],
            messages })
```

### The `ToolSource` seam

```ts
interface ToolSource {
  id: string                              // "worker-native" | "mcp:<name>" | …
  listTools(): Promise<ServerTool[]>      // TanStack AI ServerTool (zod + .server())
  status(): Promise<ToolSourceStatus>     // for Settings dots
}

type ToolSourceStatus =
  | { state: "connected"; tools: number }
  | { state: "degraded"; tools: number; reason: string }   // partial (e.g. webSearch key missing)
  | { state: "needs-auth"; reason: string }
  | { state: "needs-config"; reason: string }
  | { state: "failed"; reason: string }
```

Every source emits TanStack AI `ServerTool`s. Code Mode exposes them all as
`external_<name>`; the loop is source-agnostic. New sources = one new file.

### A1 — `envAiAdapter(env)`

A thin shim implementing TanStack AI's text-adapter interface. Translates the
adapter request (messages + `execute_typescript` schema) into
`env.AI.run(modelId, { messages, tools, stream: true }, { gateway: { id: "x" }})`,
and maps streamed deltas + `tool_calls` back to TanStack AI's expected events.

- **Model gating:** Code Mode turns need function calling. Add `supportsTools:
  boolean` to the model catalog (`models.ts`); verify per-id at build. If the
  selected model lacks tool support, the chat **falls back to plain completion**
  (today's behavior) and emits a one-line notice. No silent breakage.

### B2 — in-Worker sandbox

- Internal route `POST /internal/code-exec` mounts the TanStack AI Cloudflare
  isolate handler. **Not** under the public `/api/*` Access surface.
- Reached only by the driver with a shared secret `CODE_EXEC_TOKEN`
  (Doppler → `wrangler secret put`). Driver `authorization: Bearer <token>`.
- Eval isolate gets **no bindings**; all data access is via `external_*` tool
  callbacks mediated by the host `ToolSource.server()` impls.
- `wrangler.toml` gains the unsafe-eval binding the handler requires, with a
  comment pointing at this spec.

## Slice 1 — Worker-native tools

`workerNativeSource(env)` → zod-typed `ServerTool`s over existing bindings:

| Tool | Backing | Notes |
|---|---|---|
| `searchMemory({query, k})` | Vectorize + `memory.ts` | reuse `recallMemories` |
| `rememberFact({text})` | Vectorize + `memory.ts` | `retainMemory`; cron also calls |
| `listSessions()` | D1 | ownership-scoped to caller userId |
| `getMessages({sessionId})` | D1 | ownership-checked |
| `webFetch({url})` | `fetch` | scheme/host allowlist + response size cap |
| `webSearch({query})` | gateway `dynamic/*` or a search MCP | `degraded` if unconfigured |

`webSearch` unconfigured → its source reports `degraded`, never fails the whole
registry.

## Slice 2 — Remote MCP servers (incl. Hindsight)

`remoteMcpSource(cfg)`: the Worker is an **MCP client** to HTTP/SSE MCP servers.

- Config store `agent_mcp_servers` (per-user; AGENT_KV or D1):
  `{ name, url, transport: "http"|"sse", headers?: Record<string,string> }`.
  Auth headers Doppler-loaded where applicable.
- On registry build: MCP `initialize` + `tools/list`; convert each tool's
  JSON-Schema → zod stub; `.server()` proxies `tools/call`.
- `status()`: `connected` (handshake ok, N tools) / `failed` / `needs-auth`.
- **Hindsight** ships as a default entry: `url=https://hindsight.fly.pm/mcp`,
  headers `{ Authorization: Bearer …, CF-Access-Client-Id, CF-Access-Client-Secret }`
  (all Doppler). Exposes `hindsight_recall` / `hindsight_retain` /
  `hindsight_reflect` (exact tool names resolved from `tools/list` at build).

### Settings UI — the green-dot fix

- New endpoint `GET /api/agent/tools/status` returns each source's live
  `status()` from the **cloud agent's** perspective.
- New **"Agent Tools"** subsection in `SettingsPanel.tsx` renders those statuses
  with the existing dot component (`bg-success`/`bg-error`/`bg-warning`/`bg-fg/30`).
- The existing MCP subsection (local native host) stays; both are **explicitly
  labeled** so it's unambiguous which world each reflects. This directly
  resolves "the dots don't tell me if MCPs connect to the agent chat."

## Memory: Hindsight mirror + self-reflection cron

- **Per-turn (unchanged):** local Vectorize implicit recall + `reflect`.
- **Hindsight mirror:** when a memory is pushed to Hindsight, store the returned
  id in `agent_memories.hindsight_ref` (D1 row ↔ Postgres memory).
- **Cron (`scheduled` handler, `0 */6 * * *` — every 6h):**
  `consolidateMemories(env)`:
  1. Find users with new turns since their AGENT_KV watermark.
  2. Pull recent unreflected messages/memories from D1.
  3. Run a distillation completion (`env.AI.run`, gateway "x") → durable facts,
     preferences, open threads (the "remember" step).
  4. `retainMemory` locally **and** mirror to Hindsight (set `hindsight_ref`).
  5. Optionally call Hindsight `reflect` to update mental models.
  6. Advance the per-user watermark.
  - Idempotent (watermark-gated), bounded (cap users + messages per tick; **log
    what was skipped** — no silent truncation), logged as `cron.consolidate.*`.
- Wiring: `index.ts` `export default { fetch: app.fetch, scheduled }`;
  `wrangler.toml` `[triggers] crons = ["0 */6 * * *"]`.

## Data flow (one Code Mode turn)

1. Client → `POST /api/sessions/:id/messages/stream`.
2. Route → ChatAgent DO `/internal/turn/stream`.
3. DO persists user message; builds D1 history + memory context.
4. DO `buildToolRegistry` → `createCodeMode` → `chat({ adapter: envAiAdapter })`.
5. Model emits text (streamed straight to client as `{delta}`) and/or an
   `execute_typescript` call.
6. Driver POSTs code to `/internal/code-exec`; isolate runs it; `external_*`
   calls round-trip to host `ServerTool.server()`; result returns to the model.
7. UI receives lightweight `{event:"tool", name, status}` SSE frames during tool
   runs (client SSE parser ignores unknown frames — backward compatible).
8. Final assistant text **persisted before `[DONE]`** (existing fix); tool-call
   trace persisted to a new nullable `agent_messages.tool_trace` JSON column.
9. Background `reflect` via `ctx.waitUntil` (existing).

## Error handling

- Non-tool model selected → plain-completion fallback + notice (no failure).
- A `ToolSource` that fails `listTools()`/`status()` is **excluded** from the
  registry but reported in `/api/agent/tools/status`; the turn proceeds with the
  remaining tools.
- `webSearch`/Hindsight unconfigured → `degraded`/`needs-config`, not fatal.
- Sandbox exec error → returned to the model as `CodeModeToolResult.error`; the
  model can retry/adjust within `maxToolRounds`; exhausted rounds → graceful
  assistant message + logged.
- Cron failures are per-user isolated and logged; one user's failure doesn't
  abort the tick.

## Testing

- **Unit (vitest, plain — per repo harness):**
  - `envAiAdapter`: maps messages/tools/deltas/tool_calls correctly (mock
    `env.AI.run`).
  - `workerNativeSource`: each tool's `.server()` against the node:sqlite D1
    adapter + a Vectorize stub; ownership scoping.
  - `remoteMcpSource`: JSON-Schema→zod conversion; `tools/call` proxy; `status()`
    states (mock MCP server).
  - `buildToolRegistry`: source enable/disable, failed-source exclusion.
  - `consolidateMemories`: watermark gating, bounds/skip logging, idempotency.
- **Integration:** a Code Mode turn end-to-end against a mock isolate endpoint
  asserting `external_*` round-trips and trace persistence.
- **Model verification:** at build, confirm `supportsTools` ids actually accept a
  `tools` arg via `env.AI.run` (smoke).

## Out of scope (this plan)

Browser code-mode ops source and local-native-host-via-tunnel source — designed
into the `ToolSource` seam, implemented in follow-on plans. Existing local MCP /
native-host Settings behavior is unchanged.
