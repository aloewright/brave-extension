# Cloudflare Agent App — Plan 2: Models / AI Gateway (catalog + streaming chat)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the agent real model selection + streamed completions through Cloudflare AI Gateway `x` — Workers AI models reliably (default), explicit non-CF models behind an experimental flag — with per-user model preference, replacing Plan 1's echo.

**Architecture:** A model catalog (capability routes + concrete Workers AI ids + advanced explicit ids) served by `/api/models` and cached in KV. `ChatAgent` builds the message history from D1 and streams a completion via `env.AI.run(modelId, { messages, stream: true }, { gateway: { id: "x" } })`, persisting the final assistant text to D1. A new `/api/sessions/:id/messages/stream` SSE endpoint forwards the DO's stream to clients. Per-user selected model stored in KV.

**Tech Stack:** Cloudflare Workers AI binding + AI Gateway `x`, Server-Sent Events, KV, D1, Hono, vitest.

**Builds on:** Plan 1 (foundation). **Depends on PR #95 merged to main.** Branch off updated `main` as `feat/agent-app-models`.

**Covers spec §4** (models / AI Gateway, hybrid picker) and the streaming half of §2.

---

## Constraint recap (from CLAUDE.md)

Inside a Worker, the only reliable gateway call is `env.AI.run("@cf/<model>", payload, { gateway: { id: "x" } })`. Dynamic routes (`dynamic/text_gen`) and `fetch()`→`/compat` are broken Worker-side. So:
- **Default models** = Workers AI ids via `env.AI.run`. Reliable, no BYOK.
- **Advanced (experimental)** = explicit non-CF model id via `env.AI.gateway("x").run({ provider: "compat", endpoint: "chat/completions", query: { model, messages } })`, gated behind a per-request `advanced` flag, each call carrying a comment pointing at CLAUDE.md. May be unreliable until upstream fix — surfaced to the user as "experimental."

Model ids MUST be verified current at implementation (CLAUDE.md notes several were removed; `@cf/openai/gpt-oss-120b` and `@cf/meta/llama-3.1-8b-instruct-fp8` were current 2026-05-10).

---

## File structure

```
agent-app/
  src/
    models.ts              # catalog definition + getCatalog (KV-cached) + resolve helpers
    chat.ts                # streamCompletion(env, modelId, messages, advanced) -> ReadableStream
    routes/
      models.ts            # GET /api/models, GET/PUT /api/sessions prefs (selected model)
    agents/chat-agent.ts   # MODIFY: replace generateReply with streamed completion + persist
    routes/sessions.ts     # MODIFY: add POST /:id/messages/stream (SSE) + carry model choice
  tests/
    models.test.ts
    chat.test.ts
    models-routes.test.ts
    sessions-stream.test.ts # extends the DO-namespace fake to stream
```

---

## Task 1: Model catalog

**Files:** Create `agent-app/src/models.ts`; Test `agent-app/tests/models.test.ts`.

- [ ] **Step 1: Write the failing test** `agent-app/tests/models.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { getCatalog, resolveModel, DEFAULT_MODEL_ID } from "../src/models"

describe("models catalog", () => {
  it("returns capability routes and concrete CF models", async () => {
    const env = makeEnv()
    const cat = await getCatalog(env)
    expect(cat.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true)
    expect(cat.some((m) => m.kind === "workers-ai")).toBe(true)
    expect(cat.every((m) => typeof m.label === "string")).toBe(true)
  })

  it("marks non-CF entries as advanced/experimental", async () => {
    const env = makeEnv()
    const cat = await getCatalog(env)
    const adv = cat.filter((m) => m.kind === "advanced")
    expect(adv.every((m) => m.experimental === true)).toBe(true)
  })

  it("resolveModel falls back to default for unknown ids", async () => {
    const env = makeEnv()
    expect((await resolveModel(env, "nonsense")).id).toBe(DEFAULT_MODEL_ID)
    const known = await resolveModel(env, DEFAULT_MODEL_ID)
    expect(known.id).toBe(DEFAULT_MODEL_ID)
  })

  it("caches the catalog in KV", async () => {
    const env = makeEnv()
    await getCatalog(env)
    const cached = await env.AGENT_KV.get("models:catalog:v1")
    expect(cached).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run** `cd agent-app && pnpm vitest run tests/models.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `agent-app/src/models.ts`:

```ts
import type { Env } from "./env"

export type ModelKind = "workers-ai" | "advanced"

export interface ModelEntry {
  id: string            // the id passed to the gateway (Workers AI id, or explicit compat id)
  label: string         // display name for the picker
  kind: ModelKind
  experimental?: boolean // true for advanced/non-CF entries
}

// Reliable Workers AI models routed through gateway "x" via env.AI.run.
// VERIFY these ids are current before deploy (CLAUDE.md notes ids get removed).
const WORKERS_AI: ModelEntry[] = [
  { id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B (Workers AI)", kind: "workers-ai" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8", label: "Llama 3.1 8B (Workers AI)", kind: "workers-ai" }
]

// Experimental explicit-model entries via gateway compat (may be unreliable
// Worker-side until upstream fix — see CLAUDE.md "Inside a Worker").
const ADVANCED: ModelEntry[] = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini (experimental)", kind: "advanced", experimental: true },
  { id: "anthropic/claude-3-5-haiku", label: "Claude 3.5 Haiku (experimental)", kind: "advanced", experimental: true }
]

export const DEFAULT_MODEL_ID = "@cf/openai/gpt-oss-120b"
const CATALOG_KEY = "models:catalog:v1"

export async function getCatalog(env: Env): Promise<ModelEntry[]> {
  const cached = await env.AGENT_KV.get(CATALOG_KEY)
  if (cached) {
    try {
      return JSON.parse(cached) as ModelEntry[]
    } catch {
      /* fall through to rebuild */
    }
  }
  const catalog = [...WORKERS_AI, ...ADVANCED]
  await env.AGENT_KV.put(CATALOG_KEY, JSON.stringify(catalog))
  return catalog
}

export async function resolveModel(env: Env, id: string | null | undefined): Promise<ModelEntry> {
  const catalog = await getCatalog(env)
  return catalog.find((m) => m.id === id) ?? catalog.find((m) => m.id === DEFAULT_MODEL_ID)!
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/models.test.ts` — expect PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit** `agent-app/src/models.ts agent-app/tests/models.test.ts`, message: `feat(agent-app): model catalog with KV cache`

---

## Task 2: Streaming completion helper

**Files:** Create `agent-app/src/chat.ts`; Test `agent-app/tests/chat.test.ts`.

- [ ] **Step 1: Write the failing test** `agent-app/tests/chat.test.ts`. The test stubs `env.AI.run` to return an async-iterable / ReadableStream and asserts `streamCompletion` yields text deltas and a final string.

```ts
import { describe, expect, it, vi } from "vitest"
import { makeEnv } from "./helpers"
import { collectCompletion } from "../src/chat"

// Helper: a fake Workers-AI streaming response (ReadableStream of SSE-like chunks).
function fakeStream(parts: string[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      for (const p of parts) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: p })}\n\n`))
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"))
      controller.close()
    }
  })
}

describe("streamCompletion", () => {
  it("aggregates Workers-AI stream deltas into final text", async () => {
    const env = makeEnv({
      AI: { run: vi.fn(async () => fakeStream(["Hel", "lo", " world"])) } as any
    })
    const text = await collectCompletion(env, "@cf/openai/gpt-oss-120b", [
      { role: "user", content: "hi" }
    ], false)
    expect(text).toBe("Hello world")
  })

  it("passes the gateway id to env.AI.run for workers-ai models", async () => {
    const run = vi.fn(async () => fakeStream(["ok"]))
    const env = makeEnv({ AI: { run } as any })
    await collectCompletion(env, "@cf/openai/gpt-oss-120b", [{ role: "user", content: "x" }], false)
    expect(run).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-120b",
      expect.objectContaining({ stream: true }),
      expect.objectContaining({ gateway: { id: "x" } })
    )
  })
})
```

- [ ] **Step 2: Run** `pnpm vitest run tests/chat.test.ts` — expect FAIL.

- [ ] **Step 3: Implement** `agent-app/src/chat.ts`:

```ts
import type { Env } from "./env"
import { AI_GATEWAY_ID } from "./env"

export interface ChatMsg {
  role: "system" | "user" | "assistant"
  content: string
}

/**
 * Stream a completion through AI Gateway "x" and return a ReadableStream of
 * plain text deltas (UTF-8). Workers AI models use env.AI.run directly — the
 * only Worker-side gateway path that works today (see ~/.claude/CLAUDE.md
 * "Inside a Worker"). Advanced (non-CF) ids use the gateway compat run behind
 * the `advanced` flag; this path is experimental until the dynamic-route Worker
 * bug is fixed upstream.
 */
export function streamCompletion(
  env: Env,
  modelId: string,
  messages: ChatMsg[],
  advanced: boolean
): Promise<ReadableStream<Uint8Array>> {
  if (advanced) return streamAdvanced(env, modelId, messages)
  return streamWorkersAi(env, modelId, messages)
}

async function streamWorkersAi(
  env: Env,
  modelId: string,
  messages: ChatMsg[]
): Promise<ReadableStream<Uint8Array>> {
  // CLAUDE.md sanctioned Worker-side gateway call. Swap to dynamic/text_gen
  // when the binding/dynamic-route path is fixed upstream.
  const raw = (await env.AI.run(
    modelId,
    { messages, stream: true },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as ReadableStream
  return toTextDeltaStream(raw)
}

async function streamAdvanced(
  env: Env,
  modelId: string,
  messages: ChatMsg[]
): Promise<ReadableStream<Uint8Array>> {
  // EXPERIMENTAL: explicit non-CF model via gateway compat. Observed to skip
  // fallback nodes for dynamic routes, but a single explicit model has no
  // chain to skip. See ~/.claude/CLAUDE.md "Inside a Worker".
  const gw = (env.AI as unknown as {
    gateway: (id: string) => {
      run: (opts: unknown) => Promise<ReadableStream>
    }
  }).gateway(AI_GATEWAY_ID)
  const raw = await gw.run({
    provider: "compat",
    endpoint: "chat/completions",
    query: { model: modelId, messages, stream: true }
  })
  return toTextDeltaStream(raw)
}

// Parse an SSE byte stream of {response|choices[].delta.content} chunks into a
// stream of plain text deltas.
function toTextDeltaStream(raw: ReadableStream): ReadableStream<Uint8Array> {
  const reader = raw.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buf = ""
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith("data:")) continue
        const data = t.slice(5).trim()
        if (data === "[DONE]" || data === "") continue
        try {
          const obj = JSON.parse(data) as {
            response?: string
            choices?: Array<{ delta?: { content?: string } }>
          }
          const delta = obj.response ?? obj.choices?.[0]?.delta?.content ?? ""
          if (delta) controller.enqueue(encoder.encode(delta))
        } catch {
          /* ignore non-JSON keepalive lines */
        }
      }
    },
    cancel() {
      void reader.cancel()
    }
  })
}

/** Drain a streamCompletion result into a single string (used by the DO + tests). */
export async function collectCompletion(
  env: Env,
  modelId: string,
  messages: ChatMsg[],
  advanced: boolean
): Promise<string> {
  const stream = await streamCompletion(env, modelId, messages, advanced)
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/chat.test.ts` — expect PASS. Then `pnpm typecheck`.

- [ ] **Step 5: Commit** `agent-app/src/chat.ts agent-app/tests/chat.test.ts`, message: `feat(agent-app): streamed gateway completion helper (workers-ai + experimental advanced)`

---

## Task 3: Wire streaming into ChatAgent

**Files:** MODIFY `agent-app/src/agents/chat-agent.ts`.

The DO turn now: persist user message → build history from D1 → stream completion → persist assistant text. Keep a non-streaming JSON turn at `/internal/turn` (used by the existing non-stream route + tests) and add a streaming turn at `/internal/turn/stream` returning an SSE `text/event-stream`.

- [ ] **Step 1: Modify `onRequest`** to route by path and accept `{ sessionId, content, modelId?, advanced? }`. Replace `generateReply` with `collectCompletion` for the JSON path and `streamCompletion` for the stream path. Build prior messages via `listMessages(this.env, sessionId)` mapped to `{ role, content }` (cast roles to ChatMsg roles). Persist the assistant message with `model: resolved.id`. For the stream path, tee the stream: forward to the client AND accumulate to persist the final text on completion (use a TransformStream or accumulate in the pull loop, then `insertMessage` in a `ctx.waitUntil`-style finalizer — since DO has `this.ctx`, use `this.ctx.waitUntil`).

Concrete replacement for `agent-app/src/agents/chat-agent.ts`:

```ts
import { Agent } from "agents"
import type { Env } from "../env"
import { insertMessage, listMessages } from "../db"
import { resolveModel } from "../models"
import { streamCompletion, collectCompletion, type ChatMsg } from "../chat"

export interface ChatAgentState {
  sessionId: string | null
  lastTurn: { user: string; assistant: string } | null
}

export class ChatAgent extends Agent<Env, ChatAgentState> {
  initialState: ChatAgentState = { sessionId: null, lastTurn: null }

  async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 })
    if (path !== "/internal/turn" && path !== "/internal/turn/stream") {
      return new Response("Not found", { status: 404 })
    }

    const body = (await request.json()) as {
      sessionId: string
      content: string
      modelId?: string
      advanced?: boolean
    }
    if (!body?.sessionId || !body?.content) {
      return Response.json({ error: "sessionId and content required" }, { status: 400 })
    }

    const model = await resolveModel(this.env, body.modelId)
    const advanced = body.advanced === true && model.kind === "advanced"

    await insertMessage(this.env, {
      sessionId: body.sessionId,
      role: "user",
      content: body.content,
      model: null
    })

    const history = await this.buildHistory(body.sessionId)

    if (path === "/internal/turn") {
      const reply = await collectCompletion(this.env, model.id, history, advanced)
      const assistant = await insertMessage(this.env, {
        sessionId: body.sessionId,
        role: "assistant",
        content: reply,
        model: model.id
      })
      this.setState({ sessionId: body.sessionId, lastTurn: { user: body.content, assistant: reply } })
      return Response.json({ message: assistant })
    }

    // Streaming path: forward deltas as SSE while accumulating for persistence.
    const source = await streamCompletion(this.env, model.id, history, advanced)
    const env = this.env
    const sessionId = body.sessionId
    let acc = ""
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = source.getReader()
        const dec = new TextDecoder()
        const enc = new TextEncoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = dec.decode(value, { stream: true })
          acc += text
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ delta: text })}\n\n`))
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"))
        controller.close()
        await insertMessage(env, {
          sessionId,
          role: "assistant",
          content: acc,
          model: model.id
        })
      }
    })
    return new Response(sse, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      }
    })
  }

  private async buildHistory(sessionId: string): Promise<ChatMsg[]> {
    const rows = await listMessages(this.env, sessionId)
    return rows.map((r) => ({
      role: (r.role === "assistant" ? "assistant" : r.role === "system" ? "system" : "user") as ChatMsg["role"],
      content: r.content
    }))
  }
}
```

- [ ] **Step 2: Verify** `cd agent-app && pnpm test && pnpm typecheck`. The existing `tests/sessions.test.ts` fake DO namespace still posts to `/internal/turn` and returns `{ message }` — but the real DO now calls the LLM. The sessions test uses a FAKE namespace (it never invokes the real DO), so it stays green. Confirm. If the real DO needs `this.ctx`, note that Agent exposes `this.ctx` (DurableObjectState); the code above persists inside the stream `start` instead, so `this.ctx` isn't required.

- [ ] **Step 3: Commit** `agent-app/src/agents/chat-agent.ts`, message: `feat(agent-app): stream real gateway completions in ChatAgent`

---

## Task 4: Models + prefs routes

**Files:** Create `agent-app/src/routes/models.ts`; MODIFY `agent-app/src/app.ts` to mount it; Test `agent-app/tests/models-routes.test.ts`.

- [ ] **Step 1: Write the failing test** `agent-app/tests/models-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { buildApp } from "../src/app"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret",
  "content-type": "application/json"
}

describe("models routes", () => {
  it("GET /api/models returns the catalog", async () => {
    const res = await buildApp().fetch(
      new Request("http://x/api/models", { headers: SVC }),
      makeEnv()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    expect(body.models.length).toBeGreaterThan(0)
  })

  it("PUT then GET /api/prefs/model round-trips the selection", async () => {
    const env = makeEnv()
    const put = await buildApp().fetch(
      new Request("http://x/api/prefs/model", {
        method: "PUT",
        headers: SVC,
        body: JSON.stringify({ modelId: "@cf/meta/llama-3.1-8b-instruct-fp8" })
      }),
      env
    )
    expect(put.status).toBe(200)
    const get = await buildApp().fetch(
      new Request("http://x/api/prefs/model", { headers: SVC }),
      env
    )
    const body = (await get.json()) as { modelId: string }
    expect(body.modelId).toBe("@cf/meta/llama-3.1-8b-instruct-fp8")
  })

  it("401s without credentials", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/models"), makeEnv())
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Implement** `agent-app/src/routes/models.ts`:

```ts
import { Hono } from "hono"
import type { Env } from "../env"
import { getCatalog, resolveModel, DEFAULT_MODEL_ID } from "../models"

type Vars = { userId: string }
const models = new Hono<{ Bindings: Env; Variables: Vars }>()

models.get("/models", async (c) => {
  return c.json({ models: await getCatalog(c.env) })
})

const prefKey = (userId: string) => `pref:model:${userId}`

models.get("/prefs/model", async (c) => {
  const id = await c.env.AGENT_KV.get(prefKey(c.get("userId")))
  return c.json({ modelId: id ?? DEFAULT_MODEL_ID })
})

models.put("/prefs/model", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { modelId?: string }
  const resolved = await resolveModel(c.env, body.modelId)
  await c.env.AGENT_KV.put(prefKey(c.get("userId")), resolved.id)
  return c.json({ modelId: resolved.id })
})

export default models
```

- [ ] **Step 4: Mount in `agent-app/src/app.ts`** — add `import models from "./routes/models"` and `app.route("/api", models)` (so paths are `/api/models`, `/api/prefs/model`). Place after the existing `app.route("/api/sessions", sessions)`.

- [ ] **Step 5: Run** `pnpm vitest run tests/models-routes.test.ts` then full `pnpm test && pnpm typecheck` — all green.

- [ ] **Step 6: Commit** `agent-app/src/routes/models.ts agent-app/src/app.ts agent-app/tests/models-routes.test.ts`, message: `feat(agent-app): models catalog + model-preference routes`

---

## Task 5: Streaming send-message route (SSE)

**Files:** MODIFY `agent-app/src/routes/sessions.ts`; Test `agent-app/tests/sessions-stream.test.ts`.

- [ ] **Step 1: Write the failing test** `agent-app/tests/sessions-stream.test.ts`. Extend the fake DO namespace from sessions.test.ts so its `fetch` returns an SSE stream for `/internal/turn/stream`. Assert the route streams `data: {"delta":...}` chunks and ends with `[DONE]`.

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { buildApp } from "../src/app"
import { createSession } from "../src/db"
import type { Env } from "../src/env"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret",
  "content-type": "application/json"
}

function withStreamingAgent(env: Env): Env {
  const ns = {
    idFromName: (name: string) => ({ name }),
    get: () => ({
      fetch: async (req: Request) => {
        const { content } = (await req.json()) as { content: string }
        const enc = new TextEncoder()
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: "echo: " + content })}\n\n`))
            c.enqueue(enc.encode("data: [DONE]\n\n"))
            c.close()
          }
        })
        return new Response(body, { headers: { "content-type": "text/event-stream" } })
      }
    })
  }
  return { ...env, CHAT_AGENT: ns as unknown as Env["CHAT_AGENT"] }
}

describe("streaming send-message", () => {
  it("streams SSE deltas from the DO", async () => {
    const env = withStreamingAgent(makeEnv())
    const session = await createSession(env, "svc-client-id", "chat")
    const res = await buildApp().fetch(
      new Request(`http://x/api/sessions/${session.id}/messages/stream`, {
        method: "POST",
        headers: SVC,
        body: JSON.stringify({ content: "ping" })
      }),
      env
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const text = await res.text()
    expect(text).toContain('"delta":"echo: ping"')
    expect(text).toContain("[DONE]")
  })
})
```

Note: `createSession` is imported from db and the session userId must match the SVC client id (`svc-client-id`) so the ownership check passes.

- [ ] **Step 2: Run** — expect FAIL.

- [ ] **Step 3: Add the route** to `agent-app/src/routes/sessions.ts` (after the existing non-stream `POST /:id/messages`). It mirrors the non-stream handler but posts to `/internal/turn/stream`, passes `modelId`/`advanced` from the body (defaulting modelId to the user's KV pref), and returns the DO's streamed response with SSE headers:

```ts
// Streamed send: forwards SSE deltas from the ChatAgent DO.
sessions.post("/:id/messages/stream", async (c) => {
  const sess = await getSession(c.env, c.get("userId"), c.req.param("id"))
  if (!sess) return c.json({ error: { code: "not_found", message: "no such session" } }, 404)
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: string
    modelId?: string
    advanced?: boolean
  }
  if (!body.content?.trim()) {
    return c.json({ error: { code: "bad_request", message: "content required" } }, 400)
  }
  const modelId =
    body.modelId ?? (await c.env.AGENT_KV.get(`pref:model:${c.get("userId")}`)) ?? undefined

  const id = c.env.CHAT_AGENT.idFromName(sess.id)
  const stub = c.env.CHAT_AGENT.get(id)
  const res = await stub.fetch(
    new Request("https://agent/internal/turn/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId: sess.id,
        content: body.content,
        modelId,
        advanced: body.advanced === true
      })
    })
  )
  return new Response(res.body, {
    status: res.status,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache"
    }
  })
})
```

Also update the existing non-stream `POST /:id/messages` to forward `modelId`/`advanced` (default modelId from KV pref) in its body to the DO, so both paths honor model selection. (Add the same `modelId`/`advanced` fields to its JSON.stringify body.)

- [ ] **Step 4: Run** `pnpm vitest run tests/sessions-stream.test.ts` then full `pnpm test && pnpm typecheck` — all green.

- [ ] **Step 5: Commit** `agent-app/src/routes/sessions.ts agent-app/tests/sessions-stream.test.ts`, message: `feat(agent-app): SSE streaming send-message route with model selection`

---

## Task 6: Update DEPLOY.md + smoke notes

**Files:** MODIFY `agent-app/DEPLOY.md`.

- [ ] **Step 1:** Add a "Models" section documenting: `GET /api/models`, `PUT /api/prefs/model`, the streaming endpoint `POST /api/sessions/:id/messages/stream`, that Workers AI models are reliable while `advanced` entries are experimental (CLAUDE.md gateway-in-Worker limitation), and a reminder to verify Workers AI model ids are current before deploy. Add a curl smoke test for `/api/models`.

- [ ] **Step 2: Commit** `agent-app/DEPLOY.md`, message: `docs(agent-app): document models + streaming endpoints`

---

## Self-Review (completed during authoring)

- **Spec coverage:** §4 hybrid model picker → Tasks 1,4 (catalog + routes, workers-ai default + advanced experimental); streaming completions (§2) → Tasks 2,3,5. Per-user model pref → Task 4.
- **Placeholder scan:** Model ids are concrete but carry an explicit "verify current before deploy" note (genuine external dependency, not a placeholder).
- **Type consistency:** `ModelEntry`/`ModelKind`/`getCatalog`/`resolveModel`/`DEFAULT_MODEL_ID` (models.ts), `ChatMsg`/`streamCompletion`/`collectCompletion` (chat.ts), `/internal/turn` + `/internal/turn/stream` DO paths, `pref:model:<userId>` KV key, and the `{ sessionId, content, modelId?, advanced? }` DO body are used identically across models.ts, chat.ts, chat-agent.ts, routes, and tests.

## Next plans

- **Plan 3 — Hindsight self-learning** (retain/recall/reflect + `agent_memories` mirror, recall-into-context in `buildHistory`).
- **Plan 4 — Sidebar `agent` tab.**
- **Plan 5 — TanStack Start + TanStack AI web UI.**
