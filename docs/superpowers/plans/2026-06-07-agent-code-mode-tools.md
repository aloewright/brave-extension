# Agent Code Mode + Tool Sources + Self-Learning Memory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the cloud agent (`agent-app` Worker) tool-calling via TanStack AI Code Mode, fed by a unified `ToolSource` registry (Worker-native + remote MCP incl. Hindsight), with honest per-source status in Settings and a self-reflection memory cron.

**Architecture:** A `ToolSource` seam yields TanStack AI `ServerTool`s from each source. The ChatAgent DO builds the registry, wraps it in `createCodeMode`, and runs `chat()` through a custom `envAiAdapter` over `env.AI.run(…, {gateway:{id:"x"}})`. Model-generated code runs in an in-Worker isolate handler (no bindings) reached by the Cloudflare isolate driver. A cron `scheduled` handler consolidates memory into local Vectorize + Hindsight.

**Tech Stack:** Cloudflare Workers, Hono, `agents` SDK (Durable Object), TanStack AI (`@tanstack/ai`, `@tanstack/ai-code-mode`, `@tanstack/ai-isolate-cloudflare`), zod, D1, Vectorize, KV, Workers AI via AI Gateway "x". Tests: plain vitest + node:sqlite (per `cf-worker-test-harness` memory). Extension: Plasmo/React.

**Spec:** `docs/superpowers/specs/2026-06-07-agent-code-mode-tools-design.md`

---

## File Structure

**agent-app (Worker) — create:**
- `src/tools/types.ts` — `ToolSource`, `ToolSourceStatus`, shared tool types.
- `src/tools/registry.ts` — `buildToolRegistry(env, ctx)`, status aggregation.
- `src/tools/worker-native.ts` — `workerNativeSource(env)` (slice 1).
- `src/tools/remote-mcp.ts` — `remoteMcpSource(cfg)` + MCP client + JSON-Schema→zod (slice 2).
- `src/tools/mcp-config.ts` — per-user MCP server config store (AGENT_KV) + Hindsight default.
- `src/ai/env-ai-adapter.ts` — `envAiAdapter(env)` TanStack AI text adapter (A1).
- `src/ai/code-mode.ts` — `buildCodeMode(env, tools)` wiring `createCodeMode` + driver.
- `src/routes/code-exec.ts` — internal sandbox endpoint (B2).
- `src/routes/agent-tools.ts` — `GET /api/agent/tools/status`.
- `src/cron/consolidate.ts` — `consolidateMemories(env)` self-reflection.
- `migrations/0007_tool_trace.sql` — nullable `tool_trace` column on `agent_messages`.

**agent-app — modify:**
- `src/agents/chat-agent.ts` — registry + Code Mode loop in the streaming turn.
- `src/models.ts` — add `supportsTools` to `ModelEntry`; tag catalog; bump `CATALOG_KEY` → `v3`.
- `src/app.ts` — mount `agent-tools` route.
- `src/index.ts` — `export default { fetch, scheduled }`.
- `src/env.ts` — add `CODE_EXEC_TOKEN`, Hindsight creds.
- `wrangler.toml` — unsafe-eval binding, `[triggers] crons`.
- `package.json` — TanStack AI deps.

**extension — modify:**
- `src/lib/agent-api.ts` — `getToolStatus()` client method + types.
- `src/components/SettingsPanel.tsx` — "Agent Tools" subsection.
- `src/sections/settings/SettingsSection.tsx` — fetch + pass tool status; Doppler-load Hindsight creds.
- `src/types.ts` — Hindsight cred settings fields + defaults.

---

## Phase 0 — Dependencies & schema

### Task 0.1: Install TanStack AI Code Mode packages

**Files:**
- Modify: `agent-app/package.json`

- [ ] **Step 1: Add deps**

```bash
cd agent-app && pnpm add @tanstack/ai @tanstack/ai-code-mode @tanstack/ai-isolate-cloudflare zod
```

- [ ] **Step 2: Verify install + capture the adapter type interface**

```bash
cd agent-app && node -e "console.log(require('@tanstack/ai/package.json').version)"
ls node_modules/@tanstack/ai/dist/*.d.ts | head
```
Expected: a version prints; `.d.ts` files exist. Open the adapter type (the
interface a text adapter must implement) and the `ServerTool`/`toolDefinition`
types — these exact signatures are consumed in Tasks 1.1 and 2.x. Record the
adapter method names (e.g. `stream`/`generate`) in a scratch note for Task 1.1.

- [ ] **Step 3: Commit**

```bash
git add agent-app/package.json agent-app/pnpm-lock.yaml
git commit -m "build(agent-app): add TanStack AI Code Mode deps"
```

### Task 0.2: `tool_trace` migration

**Files:**
- Create: `agent-app/migrations/0007_tool_trace.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0007_tool_trace.sql
-- Structured trace of Code Mode tool calls for an assistant message (JSON array),
-- so tool-using turns remain replayable. Nullable; plain-chat turns leave it null.
ALTER TABLE agent_messages ADD COLUMN tool_trace TEXT;
```

- [ ] **Step 2: Apply locally**

Run: `cd agent-app && pnpm d1:migrate:local`
Expected: migration `0007_tool_trace` applied, no error.

- [ ] **Step 3: Commit**

```bash
git add agent-app/migrations/0007_tool_trace.sql
git commit -m "feat(agent-app): add tool_trace column to agent_messages"
```

---

## Phase 1 — The model adapter (A1)

### Task 1.1: `envAiAdapter` — TanStack AI text adapter over `env.AI.run`

**Files:**
- Create: `agent-app/src/ai/env-ai-adapter.ts`
- Test: `agent-app/tests/env-ai-adapter.test.ts`

> Use the exact adapter interface recorded in Task 0.1 Step 2. The code below
> targets the documented streaming text-adapter contract: an object exposing a
> streaming method that yields `{ type: "text-delta", text }` and
> `{ type: "tool-call", toolCallId, toolName, args }` events and a final
> `{ type: "finish" }`. Adjust method/event names to match the installed
> version's types; keep the env.AI translation identical.

- [ ] **Step 1: Write the failing test**

```ts
// tests/env-ai-adapter.test.ts
import { describe, expect, it, vi } from "vitest"
import { envAiAdapter } from "../src/ai/env-ai-adapter"

function fakeEnv(sseChunks: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder()
      for (const ch of sseChunks) c.enqueue(enc.encode(ch))
      c.close()
    }
  })
  return {
    AI: { run: vi.fn(async () => stream) }
  } as any
}

describe("envAiAdapter", () => {
  it("routes through env.AI.run with the gateway id and streams text deltas", async () => {
    const env = fakeEnv([
      `data: {"response":"Hel"}\n\n`,
      `data: {"response":"lo"}\n\n`,
      `data: [DONE]\n\n`
    ])
    const adapter = envAiAdapter(env)
    const events: any[] = []
    for await (const ev of adapter.stream({
      model: "@cf/openai/gpt-oss-120b",
      messages: [{ role: "user", content: "hi" }],
      tools: []
    })) {
      events.push(ev)
    }
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-120b",
      expect.objectContaining({ stream: true }),
      { gateway: { id: "x" } }
    )
    const text = events.filter((e) => e.type === "text-delta").map((e) => e.text).join("")
    expect(text).toBe("Hello")
    expect(events.at(-1).type).toBe("finish")
  })

  it("emits tool-call events from OpenAI-style tool_calls deltas", async () => {
    const env = fakeEnv([
      `data: {"choices":[{"delta":{"tool_calls":[{"id":"c1","function":{"name":"execute_typescript","arguments":"{\\"code\\":\\"return 1\\"}"}}]}}]}\n\n`,
      `data: [DONE]\n\n`
    ])
    const adapter = envAiAdapter(env)
    const events: any[] = []
    for await (const ev of adapter.stream({
      model: "@cf/openai/gpt-oss-120b",
      messages: [{ role: "user", content: "run" }],
      tools: [{ name: "execute_typescript" } as any]
    })) {
      events.push(ev)
    }
    const tc = events.find((e) => e.type === "tool-call")
    expect(tc.toolName).toBe("execute_typescript")
    expect(JSON.parse(tc.args).code).toBe("return 1")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/env-ai-adapter.test.ts`
Expected: FAIL — cannot find `../src/ai/env-ai-adapter`.

- [ ] **Step 3: Implement**

```ts
// src/ai/env-ai-adapter.ts
import type { Env } from "../env"
import { AI_GATEWAY_ID } from "../env"

export interface AdapterMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  tool_call_id?: string
}
export interface AdapterToolSchema {
  name: string
  description?: string
  parameters?: unknown // JSON schema
}
export interface AdapterRequest {
  model: string
  messages: AdapterMessage[]
  tools?: AdapterToolSchema[]
}
export type AdapterEvent =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: string }
  | { type: "finish" }

/**
 * Custom TanStack AI text adapter that routes every call through the sanctioned
 * Worker-side gateway path: env.AI.run(model, …, { gateway: { id: "x" } }).
 * See ~/.claude/CLAUDE.md "Inside a Worker" — fetch() to the gateway compat
 * endpoint is rejected (err 2019) and dynamic/* doesn't resolve via env.AI.run,
 * so this is the only working invocation.
 */
export function envAiAdapter(env: Env) {
  return {
    async *stream(req: AdapterRequest): AsyncGenerator<AdapterEvent> {
      const body: Record<string, unknown> = {
        messages: req.messages,
        stream: true
      }
      if (req.tools && req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description ?? "",
            parameters: t.parameters ?? { type: "object", properties: {} }
          }
        }))
      }
      const raw = (await env.AI.run(req.model, body, {
        gateway: { id: AI_GATEWAY_ID }
      })) as unknown as ReadableStream<Uint8Array>

      const reader = raw.getReader()
      const dec = new TextDecoder()
      // accumulate streamed tool-call fragments keyed by index/id
      const toolAcc = new Map<string, { id: string; name: string; args: string }>()
      let buf = ""
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith("data:")) continue
            const data = t.slice(5).trim()
            if (data === "" || data === "[DONE]") continue
            let obj: any
            try {
              obj = JSON.parse(data)
            } catch {
              continue
            }
            // Workers AI text models: { response: "..." }
            const textDelta =
              obj.response ?? obj.choices?.[0]?.delta?.content ?? ""
            if (textDelta) yield { type: "text-delta", text: textDelta }
            // OpenAI-style tool_calls deltas
            const calls = obj.choices?.[0]?.delta?.tool_calls
            if (Array.isArray(calls)) {
              for (const call of calls) {
                const key = String(call.id ?? call.index ?? "0")
                const cur = toolAcc.get(key) ?? { id: call.id ?? key, name: "", args: "" }
                if (call.function?.name) cur.name = call.function.name
                if (call.function?.arguments) cur.args += call.function.arguments
                toolAcc.set(key, cur)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
      for (const c of toolAcc.values()) {
        if (c.name) yield { type: "tool-call", toolCallId: c.id, toolName: c.name, args: c.args }
      }
      yield { type: "finish" }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/env-ai-adapter.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/ai/env-ai-adapter.ts agent-app/tests/env-ai-adapter.test.ts
git commit -m "feat(agent-app): envAiAdapter — TanStack AI text adapter over env.AI"
```

### Task 1.2: Model catalog `supportsTools`

**Files:**
- Modify: `agent-app/src/models.ts`
- Test: `agent-app/tests/models.test.ts`

- [ ] **Step 1: Add failing assertion**

Append to `tests/models.test.ts` inside the `describe("models catalog", …)`:

```ts
  it("tags tool-capable models with supportsTools", async () => {
    const env = makeEnv()
    const cat = await getCatalog(env)
    const oss = cat.find((m) => m.id === "@cf/openai/gpt-oss-120b")
    expect(oss?.supportsTools).toBe(true)
    const img = cat.find((m) => m.kind === "image")
    expect(img?.supportsTools ?? false).toBe(false)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/models.test.ts`
Expected: FAIL — `supportsTools` undefined.

- [ ] **Step 3: Implement**

In `src/models.ts`: add `supportsTools?: boolean` to `ModelEntry`; set
`supportsTools: true` on `@cf/openai/gpt-oss-120b` and `@cf/openai/gpt-oss-20b`
(verified function-calling-capable); leave others unset. Bump `CATALOG_KEY` to
`"models:catalog:v3"`. Update the cache-key test assertion to `v3`.

```ts
export interface ModelEntry {
  id: string
  label: string
  kind: ModelKind
  experimental?: boolean
  supportsTools?: boolean
}
// …
  { id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B (Workers AI)", kind: "workers-ai", supportsTools: true },
  { id: "@cf/openai/gpt-oss-20b", label: "GPT-OSS 20B (Workers AI)", kind: "workers-ai", supportsTools: true },
// …
const CATALOG_KEY = "models:catalog:v3"
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/models.ts agent-app/tests/models.test.ts
git commit -m "feat(agent-app): tag tool-capable models with supportsTools (catalog v3)"
```

---

## Phase 2 — Tool sources

### Task 2.1: `ToolSource` types

**Files:**
- Create: `agent-app/src/tools/types.ts`

- [ ] **Step 1: Write the types**

```ts
// src/tools/types.ts
import type { z } from "zod"

/** A tool exposed to Code Mode as external_<name>. Mirrors TanStack AI ServerTool. */
export interface ServerTool {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  outputSchema?: z.ZodTypeAny
  server: (input: any) => Promise<unknown>
}

export type ToolSourceStatus =
  | { state: "connected"; tools: number }
  | { state: "degraded"; tools: number; reason: string }
  | { state: "needs-auth"; reason: string }
  | { state: "needs-config"; reason: string }
  | { state: "failed"; reason: string }

export interface ToolSource {
  id: string
  listTools(): Promise<ServerTool[]>
  status(): Promise<ToolSourceStatus>
}
```

- [ ] **Step 2: Typecheck**

Run: `cd agent-app && pnpm tsc --noEmit -p .`
Expected: no errors referencing `types.ts`.

- [ ] **Step 3: Commit**

```bash
git add agent-app/src/tools/types.ts
git commit -m "feat(agent-app): ToolSource seam types"
```

### Task 2.2: `workerNativeSource` (slice 1)

**Files:**
- Create: `agent-app/src/tools/worker-native.ts`
- Test: `agent-app/tests/worker-native-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/worker-native-tools.test.ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { workerNativeSource } from "../src/tools/worker-native"
import { createSession, insertMessage } from "../src/db"

describe("workerNativeSource", () => {
  it("exposes the expected tools and connected status", async () => {
    const env = makeEnv()
    const src = workerNativeSource(env, "user-1")
    const tools = await src.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toContain("searchMemory")
    expect(names).toContain("rememberFact")
    expect(names).toContain("listSessions")
    expect(names).toContain("getMessages")
    const st = await src.status()
    expect(st.state === "connected" || st.state === "degraded").toBe(true)
  })

  it("listSessions returns only the caller's sessions", async () => {
    const env = makeEnv()
    await createSession(env, "user-1", "mine")
    await createSession(env, "user-2", "theirs")
    const src = workerNativeSource(env, "user-1")
    const tool = (await src.listTools()).find((t) => t.name === "listSessions")!
    const out = (await tool.server({})) as { sessions: Array<{ title: string }> }
    expect(out.sessions.every((s) => s.title === "mine")).toBe(true)
  })

  it("getMessages enforces ownership", async () => {
    const env = makeEnv()
    const sess = await createSession(env, "user-2", "theirs")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "hi", model: null })
    const src = workerNativeSource(env, "user-1")
    const tool = (await src.listTools()).find((t) => t.name === "getMessages")!
    await expect(tool.server({ sessionId: sess.id })).rejects.toThrow(/not found|forbidden/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/worker-native-tools.test.ts`
Expected: FAIL — cannot find `worker-native`.

- [ ] **Step 3: Implement**

```ts
// src/tools/worker-native.ts
import { z } from "zod"
import type { Env } from "../env"
import type { ServerTool, ToolSource, ToolSourceStatus } from "./types"
import { listSessions, getSession, listMessages } from "../db"
import { recallMemories, retainMemory } from "../memory"

const MAX_FETCH_BYTES = 256 * 1024

export function workerNativeSource(env: Env, userId: string): ToolSource {
  const tools: ServerTool[] = [
    {
      name: "searchMemory",
      description: "Semantic search over the user's stored memories.",
      inputSchema: z.object({ query: z.string(), k: z.number().int().min(1).max(20).default(5) }),
      server: async ({ query, k }) => ({ memories: await recallMemories(env, userId, query, k ?? 5) })
    },
    {
      name: "rememberFact",
      description: "Persist a durable fact/preference about the user.",
      inputSchema: z.object({ text: z.string().min(1) }),
      server: async ({ text }) => {
        const row = await retainMemory(env, { userId, sessionId: null, kind: "fact", content: text })
        return { id: row.id }
      }
    },
    {
      name: "listSessions",
      description: "List the caller's chat sessions.",
      inputSchema: z.object({}),
      server: async () => ({ sessions: await listSessions(env, userId) })
    },
    {
      name: "getMessages",
      description: "List messages in one of the caller's sessions.",
      inputSchema: z.object({ sessionId: z.string() }),
      server: async ({ sessionId }) => {
        const sess = await getSession(env, userId, sessionId)
        if (!sess) throw new Error("session not found or forbidden")
        return { messages: await listMessages(env, sessionId) }
      }
    },
    {
      name: "webFetch",
      description: "Fetch a public http(s) URL and return text (size-capped).",
      inputSchema: z.object({ url: z.string().url() }),
      server: async ({ url }) => {
        const u = new URL(url)
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s)")
        const res = await fetch(u.toString(), { redirect: "follow" })
        const buf = await res.arrayBuffer()
        const sliced = buf.byteLength > MAX_FETCH_BYTES ? buf.slice(0, MAX_FETCH_BYTES) : buf
        return { status: res.status, body: new TextDecoder().decode(sliced) }
      }
    }
  ]
  return {
    id: "worker-native",
    listTools: async () => tools,
    status: async (): Promise<ToolSourceStatus> => ({ state: "connected", tools: tools.length })
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/worker-native-tools.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/tools/worker-native.ts agent-app/tests/worker-native-tools.test.ts
git commit -m "feat(agent-app): workerNativeSource (slice 1 tools)"
```

### Task 2.3: MCP config store + Hindsight default

**Files:**
- Create: `agent-app/src/tools/mcp-config.ts`
- Test: `agent-app/tests/mcp-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/mcp-config.test.ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { listMcpServers, putMcpServer, hindsightDefault } from "../src/tools/mcp-config"

describe("mcp-config", () => {
  it("returns the Hindsight default when configured via env", async () => {
    const env = makeEnv()
    env.HINDSIGHT_URL = "https://hindsight.fly.pm/mcp"
    env.HINDSIGHT_BEARER = "tok"
    const def = hindsightDefault(env)
    expect(def?.name).toBe("hindsight")
    expect(def?.url).toContain("hindsight.fly.pm")
    expect(def?.headers?.Authorization).toBe("Bearer tok")
  })

  it("round-trips a user server in KV", async () => {
    const env = makeEnv()
    await putMcpServer(env, "user-1", { name: "ex", url: "https://x/mcp", transport: "http" })
    const list = await listMcpServers(env, "user-1")
    expect(list.find((s) => s.name === "ex")).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/mcp-config.test.ts`
Expected: FAIL — cannot find `mcp-config`.

- [ ] **Step 3: Implement**

```ts
// src/tools/mcp-config.ts
import type { Env } from "../env"

export interface McpServerCfg {
  name: string
  url: string
  transport: "http" | "sse"
  headers?: Record<string, string>
}

const key = (userId: string) => `mcp:servers:${userId}`

export function hindsightDefault(env: Env): McpServerCfg | null {
  if (!env.HINDSIGHT_URL) return null
  const headers: Record<string, string> = {}
  if (env.HINDSIGHT_BEARER) headers.Authorization = `Bearer ${env.HINDSIGHT_BEARER}`
  if (env.HINDSIGHT_ACCESS_CLIENT_ID) headers["CF-Access-Client-Id"] = env.HINDSIGHT_ACCESS_CLIENT_ID
  if (env.HINDSIGHT_ACCESS_CLIENT_SECRET) headers["CF-Access-Client-Secret"] = env.HINDSIGHT_ACCESS_CLIENT_SECRET
  return { name: "hindsight", url: env.HINDSIGHT_URL, transport: "http", headers }
}

export async function listMcpServers(env: Env, userId: string): Promise<McpServerCfg[]> {
  const raw = await env.AGENT_KV.get(key(userId))
  const user = raw ? (JSON.parse(raw) as McpServerCfg[]) : []
  const def = hindsightDefault(env)
  // user entries override a same-named default
  const names = new Set(user.map((s) => s.name))
  return def && !names.has(def.name) ? [def, ...user] : user
}

export async function putMcpServer(env: Env, userId: string, cfg: McpServerCfg): Promise<void> {
  const raw = await env.AGENT_KV.get(key(userId))
  const user = raw ? (JSON.parse(raw) as McpServerCfg[]) : []
  const next = [...user.filter((s) => s.name !== cfg.name), cfg]
  await env.AGENT_KV.put(key(userId), JSON.stringify(next))
}

export async function removeMcpServer(env: Env, userId: string, name: string): Promise<void> {
  const raw = await env.AGENT_KV.get(key(userId))
  const user = raw ? (JSON.parse(raw) as McpServerCfg[]) : []
  await env.AGENT_KV.put(key(userId), JSON.stringify(user.filter((s) => s.name !== name)))
}
```

Also extend `src/env.ts` `Env` with: `HINDSIGHT_URL?`, `HINDSIGHT_BEARER?`,
`HINDSIGHT_ACCESS_CLIENT_ID?`, `HINDSIGHT_ACCESS_CLIENT_SECRET?`,
`CODE_EXEC_TOKEN?` (all `string`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/mcp-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/tools/mcp-config.ts agent-app/src/env.ts agent-app/tests/mcp-config.test.ts
git commit -m "feat(agent-app): MCP server config store + Hindsight default"
```

### Task 2.4: `remoteMcpSource` — MCP client + JSON-Schema→zod (slice 2)

**Files:**
- Create: `agent-app/src/tools/remote-mcp.ts`
- Test: `agent-app/tests/remote-mcp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/remote-mcp.test.ts
import { describe, expect, it, vi } from "vitest"
import { remoteMcpSource } from "../src/tools/remote-mcp"

// Minimal MCP JSON-RPC fake over fetch.
function mcpFetch(tools: any[], onCall?: (name: string, args: any) => any) {
  return vi.fn(async (_url: string, init: any) => {
    const req = JSON.parse(init.body)
    const reply = (result: any) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), {
        headers: { "content-type": "application/json" }
      })
    if (req.method === "initialize") return reply({ capabilities: {} })
    if (req.method === "tools/list") return reply({ tools })
    if (req.method === "tools/call")
      return reply({ content: [{ type: "text", text: JSON.stringify(onCall?.(req.params.name, req.params.arguments) ?? {}) }] })
    return reply({})
  })
}

describe("remoteMcpSource", () => {
  it("lists tools and reports connected status", async () => {
    const f = mcpFetch([
      { name: "echo", description: "echo", inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } }
    ])
    const src = remoteMcpSource({ name: "ex", url: "https://x/mcp", transport: "http" }, f as any)
    const tools = await src.listTools()
    expect(tools[0].name).toBe("ex__echo")
    expect((await src.status()).state).toBe("connected")
  })

  it("proxies tools/call through .server()", async () => {
    const f = mcpFetch(
      [{ name: "echo", description: "", inputSchema: { type: "object", properties: { msg: { type: "string" } } } }],
      (_n, args) => ({ said: args.msg })
    )
    const src = remoteMcpSource({ name: "ex", url: "https://x/mcp", transport: "http" }, f as any)
    const tool = (await src.listTools())[0]
    const out = (await tool.server({ msg: "hi" })) as any
    expect(out.said).toBe("hi")
  })

  it("reports needs-auth on 401", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 }))
    const src = remoteMcpSource({ name: "ex", url: "https://x/mcp", transport: "http" }, f as any)
    expect((await src.status()).state).toBe("needs-auth")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/remote-mcp.test.ts`
Expected: FAIL — cannot find `remote-mcp`.

- [ ] **Step 3: Implement**

```ts
// src/tools/remote-mcp.ts
import { z } from "zod"
import type { ServerTool, ToolSource, ToolSourceStatus } from "./types"
import type { McpServerCfg } from "./mcp-config"

type FetchFn = typeof fetch

interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  required?: string[]
}

/** Best-effort JSON-Schema → zod for MCP tool inputSchemas (object-shaped). */
export function jsonSchemaToZod(s: JsonSchema | undefined): z.ZodTypeAny {
  if (!s || !s.type) return z.any()
  switch (s.type) {
    case "string":
      return z.string()
    case "number":
    case "integer":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z.array(jsonSchemaToZod(s.items))
    case "object": {
      const shape: Record<string, z.ZodTypeAny> = {}
      const req = new Set(s.required ?? [])
      for (const [k, v] of Object.entries(s.properties ?? {})) {
        const zt = jsonSchemaToZod(v)
        shape[k] = req.has(k) ? zt : zt.optional()
      }
      return z.object(shape)
    }
    default:
      return z.any()
  }
}

export function remoteMcpSource(cfg: McpServerCfg, fetchFn: FetchFn = fetch): ToolSource {
  let nextId = 1
  async function rpc(method: string, params?: unknown): Promise<any> {
    const res = await fetchFn(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(cfg.headers ?? {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params })
    })
    if (res.status === 401 || res.status === 403) {
      const e = new Error("needs-auth") as Error & { authError?: boolean }
      e.authError = true
      throw e
    }
    if (!res.ok) throw new Error(`mcp ${method} → ${res.status}`)
    const json = (await res.json()) as { result?: any; error?: { message: string } }
    if (json.error) throw new Error(json.error.message)
    return json.result
  }

  async function fetchTools(): Promise<ServerTool[]> {
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {} })
    const { tools } = (await rpc("tools/list")) as { tools: Array<{ name: string; description?: string; inputSchema?: JsonSchema }> }
    return tools.map((t) => ({
      name: `${cfg.name}__${t.name}`,
      description: t.description ?? "",
      inputSchema: jsonSchemaToZod(t.inputSchema),
      server: async (input: unknown) => {
        const r = (await rpc("tools/call", { name: t.name, arguments: input })) as {
          content?: Array<{ type: string; text?: string }>
        }
        const text = r.content?.find((c) => c.type === "text")?.text
        if (text == null) return r
        try {
          return JSON.parse(text)
        } catch {
          return { text }
        }
      }
    }))
  }

  return {
    id: `mcp:${cfg.name}`,
    listTools: fetchTools,
    status: async (): Promise<ToolSourceStatus> => {
      try {
        const tools = await fetchTools()
        return { state: "connected", tools: tools.length }
      } catch (e: any) {
        if (e?.authError) return { state: "needs-auth", reason: `${cfg.name}: 401/403` }
        return { state: "failed", reason: `${cfg.name}: ${e?.message ?? "error"}` }
      }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/remote-mcp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/tools/remote-mcp.ts agent-app/tests/remote-mcp.test.ts
git commit -m "feat(agent-app): remoteMcpSource — MCP client + JSON-Schema→zod (slice 2)"
```

### Task 2.5: `buildToolRegistry`

**Files:**
- Create: `agent-app/src/tools/registry.ts`
- Test: `agent-app/tests/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/registry.test.ts
import { describe, expect, it } from "vitest"
import type { ToolSource } from "../src/tools/types"
import { buildToolRegistry, aggregateStatus } from "../src/tools/registry"

const ok = (id: string, names: string[]): ToolSource => ({
  id,
  listTools: async () => names.map((n) => ({ name: n, description: "", inputSchema: {} as any, server: async () => ({}) })),
  status: async () => ({ state: "connected", tools: names.length })
})
const broken = (id: string): ToolSource => ({
  id,
  listTools: async () => { throw new Error("boom") },
  status: async () => ({ state: "failed", reason: "boom" })
})

describe("registry", () => {
  it("merges tools from healthy sources and excludes broken ones", async () => {
    const { tools } = await buildToolRegistry([ok("a", ["x"]), broken("b"), ok("c", ["y"])])
    expect(tools.map((t) => t.name).sort()).toEqual(["x", "y"])
  })

  it("aggregateStatus reports per-source", async () => {
    const st = await aggregateStatus([ok("a", ["x"]), broken("b")])
    expect(st.find((s) => s.id === "a")?.status.state).toBe("connected")
    expect(st.find((s) => s.id === "b")?.status.state).toBe("failed")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/registry.test.ts`
Expected: FAIL — cannot find `registry`.

- [ ] **Step 3: Implement**

```ts
// src/tools/registry.ts
import type { ServerTool, ToolSource, ToolSourceStatus } from "./types"
import { log } from "../log"

export async function buildToolRegistry(sources: ToolSource[]): Promise<{ tools: ServerTool[] }> {
  const tools: ServerTool[] = []
  for (const src of sources) {
    try {
      tools.push(...(await src.listTools()))
    } catch (e) {
      log.warn("registry.source_excluded", {
        source: src.id,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return { tools }
}

export async function aggregateStatus(
  sources: ToolSource[]
): Promise<Array<{ id: string; status: ToolSourceStatus }>> {
  return Promise.all(
    sources.map(async (s) => {
      try {
        return { id: s.id, status: await s.status() }
      } catch (e) {
        return { id: s.id, status: { state: "failed", reason: e instanceof Error ? e.message : "error" } as ToolSourceStatus }
      }
    })
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/tools/registry.ts agent-app/tests/registry.test.ts
git commit -m "feat(agent-app): buildToolRegistry + aggregateStatus"
```

---

## Phase 3 — Sandbox endpoint (B2) + Code Mode wiring

### Task 3.1: Internal code-exec route

**Files:**
- Create: `agent-app/src/routes/code-exec.ts`
- Test: `agent-app/tests/code-exec.test.ts`
- Modify: `agent-app/src/index.ts` (mount before SPA fallthrough)

> The TanStack AI Cloudflare isolate package exports a request handler for the
> execution endpoint. In Task 0.1 Step 2 you recorded its export name and the
> unsafe-eval binding it needs. This task wraps that handler with the
> `CODE_EXEC_TOKEN` bearer guard and mounts it at `/internal/code-exec`.

- [ ] **Step 1: Write the failing test (auth guard)**

```ts
// tests/code-exec.test.ts
import { describe, expect, it } from "vitest"
import { codeExecGuard } from "../src/routes/code-exec"

describe("code-exec guard", () => {
  it("rejects missing/incorrect bearer", () => {
    expect(codeExecGuard("Bearer secret", "secret")).toBe(true)
    expect(codeExecGuard("Bearer nope", "secret")).toBe(false)
    expect(codeExecGuard(undefined, "secret")).toBe(false)
    expect(codeExecGuard("Bearer secret", "")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/code-exec.test.ts`
Expected: FAIL — cannot find `code-exec`.

- [ ] **Step 3: Implement guard + handler wrapper**

```ts
// src/routes/code-exec.ts
import type { Env } from "../env"
// The isolate execution handler exported by @tanstack/ai-isolate-cloudflare.
// Export name recorded in Task 0.1 Step 2; import it here.
import { handleIsolateRequest } from "@tanstack/ai-isolate-cloudflare"

/** Constant-ish bearer check. Returns true only when token is set and matches. */
export function codeExecGuard(authHeader: string | undefined, token: string): boolean {
  if (!token) return false
  if (!authHeader?.startsWith("Bearer ")) return false
  return authHeader.slice(7) === token
}

/** Mounted at POST /internal/code-exec; runs model-generated code in an isolate. */
export async function codeExecRoute(request: Request, env: Env): Promise<Response> {
  if (!codeExecGuard(request.headers.get("authorization") ?? undefined, env.CODE_EXEC_TOKEN ?? "")) {
    return new Response("unauthorized", { status: 401 })
  }
  // The eval isolate receives NO env bindings — tool calls round-trip to the host
  // via the driver's callback protocol handled inside handleIsolateRequest.
  return handleIsolateRequest(request)
}
```

In `src/index.ts`, before the SPA fallthrough in `notFound`/routing, add:

```ts
import { codeExecRoute } from "./routes/code-exec"
// inside the exported fetch handler, earliest:
app.post("/internal/code-exec", (c) => codeExecRoute(c.req.raw, c.env))
```

> If `handleIsolateRequest`'s exact name differs, substitute the recorded export.
> If it requires the tool registry to be passed (host-side callbacks), thread the
> registry built in Task 3.2 through a module-level setter; document inline.

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/code-exec.test.ts`
Expected: PASS.

- [ ] **Step 5: Add wrangler unsafe-eval binding + secret + commit**

In `agent-app/wrangler.toml` add the unsafe-eval binding required by the isolate
handler (name recorded in Task 0.1), with a comment:

```toml
# Required by @tanstack/ai-isolate-cloudflare to execute model-generated code in
# an isolate. The isolate gets NO other bindings; tool calls round-trip to the
# host. Endpoint is /internal/code-exec, guarded by CODE_EXEC_TOKEN. See
# docs/superpowers/specs/2026-06-07-agent-code-mode-tools-design.md
[[unsafe.bindings]]
name = "LOADER"
type = "worker-loader"
```

```bash
# Set the shared secret (value from Doppler):
cd agent-app && echo "$CODE_EXEC_TOKEN" | npx wrangler secret put CODE_EXEC_TOKEN
git add agent-app/src/routes/code-exec.ts agent-app/tests/code-exec.test.ts agent-app/src/index.ts agent-app/wrangler.toml
git commit -m "feat(agent-app): internal code-exec sandbox endpoint (B2) + unsafe-eval binding"
```

### Task 3.2: `buildCodeMode` — wire registry + driver + adapter

**Files:**
- Create: `agent-app/src/ai/code-mode.ts`
- Test: `agent-app/tests/code-mode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/code-mode.test.ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { toCodeModeTools } from "../src/ai/code-mode"

describe("toCodeModeTools", () => {
  it("maps ServerTools to TanStack toolDefinition+server shape", () => {
    const defs = toCodeModeTools([
      { name: "echo", description: "e", inputSchema: z.object({ m: z.string() }), server: async (i: any) => ({ m: i.m }) }
    ])
    expect(defs[0].name).toBe("echo")
    expect(typeof defs[0].server).toBe("function")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/code-mode.test.ts`
Expected: FAIL — cannot find `code-mode`.

- [ ] **Step 3: Implement**

```ts
// src/ai/code-mode.ts
import { toolDefinition } from "@tanstack/ai"
import { createCodeMode } from "@tanstack/ai-code-mode"
import { createCloudflareIsolateDriver } from "@tanstack/ai-isolate-cloudflare"
import type { Env } from "../env"
import type { ServerTool } from "../tools/types"

/** Convert our ServerTool[] into TanStack AI server tools for createCodeMode. */
export function toCodeModeTools(tools: ServerTool[]) {
  return tools.map((t) =>
    toolDefinition({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as any,
      outputSchema: (t.outputSchema as any) ?? undefined
    }).server(async (input: any) => t.server(input))
  )
}

export function buildCodeMode(env: Env, selfUrl: string, tools: ServerTool[]) {
  const driver = createCloudflareIsolateDriver({
    workerUrl: `${selfUrl}/internal/code-exec`,
    authorization: `Bearer ${env.CODE_EXEC_TOKEN ?? ""}`,
    timeout: 30_000,
    maxToolRounds: 10
  })
  return createCodeMode({ driver, tools: toCodeModeTools(tools), timeout: 30_000 })
}
```

> Confirm `toolDefinition(...).server(...)` shape against the recorded types; if
> `createCodeMode` accepts raw `{name,description,inputSchema,server}` objects,
> simplify `toCodeModeTools` accordingly.

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/code-mode.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/ai/code-mode.ts agent-app/tests/code-mode.test.ts
git commit -m "feat(agent-app): buildCodeMode wiring (driver + registry tools)"
```

---

## Phase 4 — ChatAgent integration

### Task 4.1: Use Code Mode in the streaming turn (with fallback)

**Files:**
- Modify: `agent-app/src/agents/chat-agent.ts`
- Test: `agent-app/tests/chat-agent-codemode.test.ts`

- [ ] **Step 1: Write the failing test (fallback decision)**

```ts
// tests/chat-agent-codemode.test.ts
import { describe, expect, it } from "vitest"
import { shouldUseCodeMode } from "../src/agents/chat-agent"

describe("shouldUseCodeMode", () => {
  it("true only when model supportsTools and tools exist", () => {
    expect(shouldUseCodeMode({ supportsTools: true } as any, 3)).toBe(true)
    expect(shouldUseCodeMode({ supportsTools: false } as any, 3)).toBe(false)
    expect(shouldUseCodeMode({ supportsTools: true } as any, 0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/chat-agent-codemode.test.ts`
Expected: FAIL — `shouldUseCodeMode` not exported.

- [ ] **Step 3: Implement**

In `src/agents/chat-agent.ts`:

```ts
import type { ModelEntry } from "../models"

/** Code Mode only runs on tool-capable models with at least one tool. */
export function shouldUseCodeMode(model: ModelEntry, toolCount: number): boolean {
  return model.supportsTools === true && toolCount > 0
}
```

Then in the streaming branch, before `streamCompletion`: build the registry from
`workerNativeSource(env, userId)` + `remoteMcpSource` for each
`listMcpServers(env, userId)`; compute `tools`. If `shouldUseCodeMode(model,
tools.length)`, run the TanStack AI `chat()` loop with `envAiAdapter(env)` and the
`buildCodeMode(env, selfUrl, tools)` tool + systemPrompt, forwarding text events
to the existing SSE `{delta}` frames and emitting `{event:"tool",name,status}`
frames around tool rounds; accumulate `acc` and a `trace[]`. Otherwise fall back
to the existing `streamCompletion` path and emit one SSE notice frame
`{event:"notice",text:"Selected model has no tool support; using plain chat."}`.
Persist `acc` (existing pre-`[DONE]` order) and, when present, `tool_trace =
JSON.stringify(trace)` via an extended `insertMessage` (add optional `toolTrace`
param writing the new column). `selfUrl` = `new URL(request.url).origin`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/chat-agent-codemode.test.ts`
Expected: PASS.

- [ ] **Step 5: Full agent-app suite + commit**

Run: `cd agent-app && pnpm vitest run && pnpm tsc --noEmit -p .`
Expected: all pass, no type errors.

```bash
git add agent-app/src/agents/chat-agent.ts agent-app/src/db.ts agent-app/tests/chat-agent-codemode.test.ts
git commit -m "feat(agent-app): Code Mode loop in ChatAgent with plain-chat fallback + tool_trace"
```

---

## Phase 5 — Status endpoint + Settings UI

### Task 5.1: `GET /api/agent/tools/status`

**Files:**
- Create: `agent-app/src/routes/agent-tools.ts`
- Modify: `agent-app/src/app.ts`
- Test: `agent-app/tests/agent-tools-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/agent-tools-route.test.ts
import { describe, expect, it } from "vitest"
import { buildApp } from "../src/app"
import { makeEnv } from "./helpers"

describe("GET /api/agent/tools/status", () => {
  it("returns per-source status array for the caller", async () => {
    const env = makeEnv() // makeEnv sets a test Access service token / userId path
    const app = buildApp()
    const res = await app.request("/api/agent/tools/status", {
      headers: { "cf-access-client-id": "svc-client-id", "cf-access-client-secret": "svc-client-secret" }
    }, env)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { sources: Array<{ id: string; status: { state: string } }> }
    expect(json.sources.some((s) => s.id === "worker-native")).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/agent-tools-route.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```ts
// src/routes/agent-tools.ts
import { Hono } from "hono"
import type { Env } from "../env"
import { workerNativeSource } from "../tools/worker-native"
import { remoteMcpSource } from "../tools/remote-mcp"
import { listMcpServers } from "../tools/mcp-config"
import { aggregateStatus } from "../tools/registry"

type Vars = { userId: string }
const agentTools = new Hono<{ Bindings: Env; Variables: Vars }>()

agentTools.get("/tools/status", async (c) => {
  const userId = c.get("userId")
  const servers = await listMcpServers(c.env, userId)
  const sources = [
    workerNativeSource(c.env, userId),
    ...servers.map((s) => remoteMcpSource(s))
  ]
  return c.json({ sources: await aggregateStatus(sources) })
})

export default agentTools
```

In `src/app.ts`: `import agentTools from "./routes/agent-tools"` and
`app.route("/api/agent", agentTools)` (after `requireAccess`).

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/agent-tools-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/routes/agent-tools.ts agent-app/src/app.ts agent-app/tests/agent-tools-route.test.ts
git commit -m "feat(agent-app): GET /api/agent/tools/status"
```

### Task 5.2: Extension — `getToolStatus()` client + Settings subsection

**Files:**
- Modify: `src/lib/agent-api.ts`
- Modify: `src/components/SettingsPanel.tsx`
- Modify: `src/sections/settings/SettingsSection.tsx`
- Modify: `src/types.ts`
- Test: `tests/agent-tool-status.test.ts`

- [ ] **Step 1: Write the failing test (client shape)**

```ts
// tests/agent-tool-status.test.ts
import { describe, expect, it, vi } from "vitest"
import { createAgentApiClient } from "../src/lib/agent-api"

describe("getToolStatus", () => {
  it("GETs /api/agent/tools/status with access headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sources: [{ id: "worker-native", status: { state: "connected", tools: 5 } }] }), {
        headers: { "content-type": "application/json" }
      })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = createAgentApiClient({ baseUrl: "https://agent.fly.pm", clientId: "id", clientSecret: "sec" })
    const sources = await client.getToolStatus()
    expect(sources[0].id).toBe("worker-native")
    expect(fetchMock.mock.calls[0][0]).toContain("/api/agent/tools/status")
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/agent-tool-status.test.ts`
Expected: FAIL — `getToolStatus` not on client.

- [ ] **Step 3: Implement client method**

In `src/lib/agent-api.ts`: add types and method.

```ts
export interface ToolSourceState {
  id: string
  status:
    | { state: "connected"; tools: number }
    | { state: "degraded"; tools: number; reason: string }
    | { state: "needs-auth"; reason: string }
    | { state: "needs-config"; reason: string }
    | { state: "failed"; reason: string }
}
// add to AgentApiClient interface:
//   getToolStatus(): Promise<ToolSourceState[]>
// in the returned object:
    async getToolStatus() {
      return (await jsonReq<{ sources: ToolSourceState[] }>("/api/agent/tools/status")).sources
    },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/agent-tool-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Render the "Agent Tools" subsection**

In `SettingsPanel.tsx` add a new labeled subsection **"Agent Tools (cloud agent)"**
that maps a passed `agentToolStatus: ToolSourceState[]` prop to dot rows, reusing
the existing dot classes:

```tsx
const dot = (state: string) =>
  state === "connected" ? "bg-success" :
  state === "failed" ? "bg-error" :
  state === "needs-auth" || state === "needs-config" || state === "degraded" ? "bg-warning" :
  "bg-fg/30"
// …render each: <span className={`w-1.5 h-1.5 rounded-full ${dot(s.status.state)}`} /> {s.id} — {s.status.state}
```

Label the existing local-MCP subsection **"MCP Servers (local Claude Code)"** so
the two worlds are unambiguous. In `SettingsSection.tsx`, after the agent client
is configured, call `client.getToolStatus()` and pass results down; refresh on a
manual ↻ button. Add Hindsight cred fields to `src/types.ts`
(`hindsightUrl`, `hindsightBearer`, `hindsightAccessClientId`,
`hindsightAccessClientSecret`, all default `""`) and include their Doppler secret
names (`HINDSIGHT_URL`, `HINDSIGHT_BEARER`, `HINDSIGHT_ACCESS_CLIENT_ID`,
`HINDSIGHT_ACCESS_CLIENT_SECRET`) in the SettingsSection Doppler auto-load lists
(mirrors the agent-cred wiring already in place).

- [ ] **Step 6: Build + commit**

Run: `pnpm vitest run && npm run build`
Expected: tests pass; Plasmo build succeeds.

```bash
git add src/lib/agent-api.ts src/components/SettingsPanel.tsx src/sections/settings/SettingsSection.tsx src/types.ts tests/agent-tool-status.test.ts
git commit -m "feat(extension): Agent Tools status subsection + Hindsight cred settings"
```

---

## Phase 6 — Self-reflection cron

### Task 6.1: `consolidateMemories`

**Files:**
- Create: `agent-app/src/cron/consolidate.ts`
- Test: `agent-app/tests/consolidate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/consolidate.test.ts
import { describe, expect, it, vi } from "vitest"
import { makeEnv } from "./helpers"
import { createSession, insertMessage } from "../src/db"
import { consolidateMemories } from "../src/cron/consolidate"

describe("consolidateMemories", () => {
  it("is watermark-gated and idempotent", async () => {
    const env = makeEnv()
    // stub the distillation completion to a fixed fact
    vi.spyOn(env.AI, "run").mockResolvedValue({ response: "User likes dark mode." } as any)
    const sess = await createSession(env, "user-1", "s")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "I prefer dark mode", model: null })

    const first = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    expect(first.usersProcessed).toBe(1)

    // second run with no new messages → skipped by watermark
    const second = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    expect(second.usersProcessed).toBe(0)
  })

  it("logs and continues when one user fails", async () => {
    const env = makeEnv()
    const sess = await createSession(env, "user-2", "s")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "hi", model: null })
    vi.spyOn(env.AI, "run").mockRejectedValue(new Error("model down"))
    const res = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    expect(res.usersProcessed).toBe(0)
    expect(res.usersFailed).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd agent-app && pnpm vitest run tests/consolidate.test.ts`
Expected: FAIL — cannot find `consolidate`.

- [ ] **Step 3: Implement**

```ts
// src/cron/consolidate.ts
import type { Env } from "../env"
import { collectCompletion } from "../chat"
import { retainMemory } from "../memory"
import { DEFAULT_MODEL_ID } from "../models"
import { log, since } from "../log"

interface Opts { maxUsers: number; maxMessagesPerUser: number }
interface Result { usersProcessed: number; usersFailed: number; skipped: number }

const wmKey = (userId: string) => `consolidate:wm:${userId}`

async function activeUsers(env: Env, limit: number): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM agent_sessions ORDER BY updated_at DESC LIMIT ?`
  ).bind(limit).all()
  return ((res.results ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
}

async function newMessagesSince(env: Env, userId: string, since: number, cap: number) {
  const res = await env.DB.prepare(
    `SELECT m.role, m.content, m.created_at
       FROM agent_messages m JOIN agent_sessions s ON s.id = m.session_id
      WHERE s.user_id = ? AND m.created_at > ?
      ORDER BY m.created_at ASC LIMIT ?`
  ).bind(userId, since, cap).all()
  return (res.results ?? []) as Array<{ role: string; content: string; created_at: number }>
}

export async function consolidateMemories(env: Env, opts: Opts): Promise<Result> {
  const startedAt = Date.now()
  const users = await activeUsers(env, opts.maxUsers)
  let usersProcessed = 0, usersFailed = 0, skipped = 0
  for (const userId of users) {
    try {
      const wmRaw = await env.AGENT_KV.get(wmKey(userId))
      const wm = wmRaw ? Number(wmRaw) : 0
      const msgs = await newMessagesSince(env, userId, wm, opts.maxMessagesPerUser)
      if (msgs.length === 0) { skipped++; continue }
      const transcript = msgs.map((m) => `${m.role}: ${m.content}`).join("\n")
      const distilled = await collectCompletion(
        env, DEFAULT_MODEL_ID,
        [
          { role: "system", content: "Extract durable facts, preferences, and open threads about the user as terse bullet points. If nothing durable, reply NONE." },
          { role: "user", content: transcript }
        ],
        false
      )
      if (distilled.trim() && distilled.trim().toUpperCase() !== "NONE") {
        await retainMemory(env, { userId, sessionId: null, kind: "reflection", content: distilled.trim() })
        // Hindsight mirror is best-effort and handled by the per-turn MCP path /
        // a future direct retain; watermark still advances.
      }
      const newWm = msgs[msgs.length - 1].created_at
      await env.AGENT_KV.put(wmKey(userId), String(newWm))
      usersProcessed++
    } catch (e) {
      usersFailed++
      log.error("cron.consolidate.user_failed", { userId, error: e instanceof Error ? e.message : String(e) })
    }
  }
  log.info("cron.consolidate.done", { usersProcessed, usersFailed, skipped, total: users.length, ms: since(startedAt) })
  if (users.length >= opts.maxUsers) log.warn("cron.consolidate.capped", { cap: opts.maxUsers })
  return { usersProcessed, usersFailed, skipped }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd agent-app && pnpm vitest run tests/consolidate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add agent-app/src/cron/consolidate.ts agent-app/tests/consolidate.test.ts
git commit -m "feat(agent-app): self-reflection memory consolidation (watermark-gated)"
```

### Task 6.2: Wire `scheduled` handler + cron trigger

**Files:**
- Modify: `agent-app/src/index.ts`
- Modify: `agent-app/wrangler.toml`

- [ ] **Step 1: Export scheduled handler**

In `src/index.ts`, change the default export to include `scheduled`:

```ts
import { consolidateMemories } from "./cron/consolidate"
// …
export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(consolidateMemories(env, { maxUsers: 100, maxMessagesPerUser: 200 }))
  }
}
```

(Keep the existing `export { ChatAgent }` and `buildApp` re-exports.)

- [ ] **Step 2: Add cron trigger**

In `wrangler.toml`:

```toml
[triggers]
crons = ["0 */6 * * *"]
```

- [ ] **Step 3: Typecheck + full suite**

Run: `cd agent-app && pnpm tsc --noEmit -p . && pnpm vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add agent-app/src/index.ts agent-app/wrangler.toml
git commit -m "feat(agent-app): scheduled handler + 6h consolidation cron"
```

---

## Phase 7 — Deploy & verify

### Task 7.1: Deploy and smoke-test

- [ ] **Step 1: Set secrets** (values from Doppler)

```bash
cd agent-app
for s in CODE_EXEC_TOKEN HINDSIGHT_URL HINDSIGHT_BEARER HINDSIGHT_ACCESS_CLIENT_ID HINDSIGHT_ACCESS_CLIENT_SECRET; do
  echo "set $s"; doppler secrets get "$s" --plain | npx wrangler secret put "$s"
done
```

- [ ] **Step 2: Migrate remote D1 + deploy**

```bash
cd agent-app && pnpm d1:migrate:remote && pnpm build:web && npx wrangler deploy
```
Expected: deploy succeeds; new Version ID printed.

- [ ] **Step 3: Smoke-test tool status (with service token from Doppler)**

```bash
curl -s https://agent.fly.pm/api/agent/tools/status \
  -H "cf-access-client-id: $(doppler secrets get AGENT_ACCESS_CLIENT_ID --plain)" \
  -H "cf-access-client-secret: $(doppler secrets get AGENT_ACCESS_CLIENT_SECRET --plain)" | python3 -m json.tool
```
Expected: JSON with `worker-native` `connected` and a `mcp:hindsight` entry
(`connected` if creds valid, else `needs-auth`/`failed`).

- [ ] **Step 4: Smoke-test a Code Mode turn**

Create a session, send "search my memory for preferences and summarize" with a
`supportsTools` model selected; confirm an SSE `{event:"tool",...}` frame appears
and a non-empty reply persists. Watch logs: `npx wrangler tail` → expect
`ai.call.*`, tool round logs, `turn.done`.

- [ ] **Step 5: Reload extension + visual check**

Reload at `chrome://extensions`; open Settings → "Agent Tools (cloud agent)"
shows green for worker-native and Hindsight. Send an agent chat message that uses
a tool; confirm the tool-run indicator renders.

- [ ] **Step 6: Update memory + open PR**

Update `MEMORY.md` `cloudflare-agent-app-status` with the Code Mode + tool-source
+ cron milestone. Open a PR from `feat/agent-code-mode-tools`.

---

## Self-Review

**Spec coverage:** ToolSource seam (2.1) ✓; A1 adapter (1.1) ✓; B2 sandbox (3.1) ✓;
Code Mode wiring (3.2, 4.1) ✓; model gating/fallback (1.2, 4.1) ✓; slice 1 tools
(2.2) ✓; slice 2 MCP + Hindsight (2.3, 2.4) ✓; status endpoint + Settings dots
(5.1, 5.2) ✓; tool_trace persistence (0.2, 4.1) ✓; self-reflection cron (6.1, 6.2) ✓;
observability via existing `log` (used throughout) ✓; deploy/verify (7.1) ✓.

**Open implementation-time confirmations (actions, not placeholders):** exact
TanStack AI adapter event/method names, the isolate handler export name, and the
unsafe-eval binding name — all captured as concrete discovery steps in Task 0.1
Step 2 and referenced where consumed.

**Type consistency:** `ServerTool`, `ToolSource`, `ToolSourceStatus` defined in
2.1 and consumed identically in 2.2/2.4/2.5/3.2/5.1; `ToolSourceState` (client)
mirrors the server `{id,status}` shape from `aggregateStatus`; `supportsTools`
introduced in 1.2 and consumed in 4.1; `CODE_EXEC_TOKEN`/Hindsight env fields
introduced in 2.3/3.1 and consumed in 3.1/3.2/2.3.
