# Cloudflare Agent App — Plan 3: Hindsight self-learning (D1 memories + Vectorize recall)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Give the agent durable, self-learning memory: retain facts/reflections to D1 (`agent_memories`), recall the most relevant ones into context each turn via embedding search over the shared Vectorize index, and reflect on completed turns into new memories.

**Architecture:** A `memory.ts` module: `embed()` (gateway `x`), `retainMemory()` (insert D1 row + upsert vector with `{userId, kind, type:"agent_memory"}` metadata), `recallMemories()` (embed query → Vectorize query filtered to the user → join D1 rows), `reflect()` (summarize recent turns via `collectCompletion` and retain as a `reflection`). `ChatAgent` recalls before generating (prepends a system message) and retains/reflects after. D1 is the system-of-record; Vectorize is the recall index. The `@vectorize-io/hindsight-client` service can replace this behind the same interface later.

**Tech Stack:** Workers AI embeddings via gateway `x`, Vectorize, D1, vitest.

**Builds on:** Plans 1-2. Branch `feat/agent-app-hindsight` off `main`.

**Covers spec §3** (Hindsight/self-learning, D1 memory mirror) + recall-into-context half of §2.

---

## File structure

```
agent-app/
  src/
    memory.ts              # embed, retainMemory, recallMemories, reflect, EMBED_MODEL
    agents/chat-agent.ts   # MODIFY: recall before generate, retain/reflect after
  tests/
    helpers.ts             # MODIFY: add fake VECTORS (upsert/query) + embedding AI stub
    memory.test.ts
```

---

## Task 1: Test harness — fake Vectorize + embedding stub

**Files:** MODIFY `agent-app/tests/helpers.ts`.

- [ ] **Step 1:** In `makeEnv`, replace the `VECTORS: {} as VectorizeIndex` and `AI: { run: vi.fn() }` stubs with working fakes: an in-memory vector store supporting `upsert` and `query` (cosine or trivial recency — for tests, return inserted vectors filtered by metadata), and an `AI.run` that returns a deterministic embedding for the embed model and is overridable. Keep `makeFakeKV` and the D1 shim (incl. the `batch` method) intact.

Replace the relevant section of `makeEnv` with:

```ts
  const vectorsStore = new Map<
    string,
    { values: number[]; metadata: Record<string, unknown> }
  >()
  const vectors = {
    upsert: vi.fn(async (vs: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>) => {
      for (const v of vs) vectorsStore.set(v.id, { values: v.values, metadata: v.metadata ?? {} })
      return { mutationId: "test" }
    }),
    query: vi.fn(async (_vec: number[], opts?: { topK?: number; filter?: Record<string, unknown> }) => {
      const filter = opts?.filter ?? {}
      const matches = Array.from(vectorsStore.entries())
        .filter(([, v]) =>
          Object.entries(filter).every(([k, val]) => v.metadata[k] === val)
        )
        .slice(0, opts?.topK ?? 5)
        .map(([id, v]) => ({ id, score: 1, metadata: v.metadata }))
      return { matches, count: matches.length }
    })
  } as unknown as VectorizeIndex

  const ai = {
    run: vi.fn(async (model: string) => {
      if (String(model).includes("bge")) return { data: [new Array(768).fill(0.01)] }
      throw new Error(`unstubbed AI model: ${model}`)
    })
  } as unknown as Ai
```

Then set `AI: ai,` and `VECTORS: vectors,` in the returned env object (replacing the old stubs). Leave `...overrides` last so tests can still override.

- [ ] **Step 2:** Run `cd agent-app && pnpm test` — all existing tests (chat.test.ts stubs AI itself via overrides; models/sessions unaffected) must still pass. If `chat.test.ts` relied on `AI: { run: vi.fn() }` default it overrides AI anyway, so it's fine. Confirm. `pnpm typecheck` clean.

- [ ] **Step 3: Commit** `agent-app/tests/helpers.ts`, message: `test(agent-app): fake Vectorize + embedding stub in harness`

---

## Task 2: Memory module (retain / recall)

**Files:** Create `agent-app/src/memory.ts`; Test `agent-app/tests/memory.test.ts`.

- [ ] **Step 1: Write the failing test** `agent-app/tests/memory.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { retainMemory, recallMemories } from "../src/memory"

describe("memory", () => {
  it("retains a memory to D1 and recalls it by query", async () => {
    const env = makeEnv()
    await retainMemory(env, { userId: "u1", sessionId: "s1", kind: "fact", content: "user likes TypeScript" })
    const recalled = await recallMemories(env, "u1", "what languages?", 5)
    expect(recalled.length).toBe(1)
    expect(recalled[0]!.content).toBe("user likes TypeScript")
  })

  it("scopes recall to the user", async () => {
    const env = makeEnv()
    await retainMemory(env, { userId: "u1", sessionId: null, kind: "fact", content: "A" })
    await retainMemory(env, { userId: "u2", sessionId: null, kind: "fact", content: "B" })
    const r = await recallMemories(env, "u1", "anything", 5)
    expect(r.every((m) => m.content === "A")).toBe(true)
  })

  it("returns empty when the user has no memories", async () => {
    const env = makeEnv()
    expect(await recallMemories(env, "nobody", "q", 5)).toEqual([])
  })
})
```

- [ ] **Step 2:** Run `pnpm vitest run tests/memory.test.ts` — FAIL.

- [ ] **Step 3: Implement** `agent-app/src/memory.ts`:

```ts
import type { Env } from "./env"
import { AI_GATEWAY_ID } from "./env"
import { ulid } from "./ulid"

// Embedding model routed through gateway "x" (CLAUDE.md sanctioned env.AI.run).
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"

export interface MemoryRow {
  id: string
  user_id: string
  session_id: string | null
  kind: string
  content: string
  hindsight_ref: string | null
  created_at: number
}

export async function embed(env: Env, text: string): Promise<number[]> {
  const res = (await env.AI.run(
    EMBED_MODEL,
    { text: [text] },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as { data: number[][] }
  return res?.data?.[0] ?? []
}

export async function retainMemory(
  env: Env,
  m: { userId: string; sessionId: string | null; kind: string; content: string }
): Promise<MemoryRow> {
  const row: MemoryRow = {
    id: ulid(),
    user_id: m.userId,
    session_id: m.sessionId,
    kind: m.kind,
    content: m.content,
    hindsight_ref: null,
    created_at: Date.now()
  }
  await env.DB.prepare(
    `INSERT INTO agent_memories (id, user_id, session_id, kind, content, hindsight_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.user_id, row.session_id, row.kind, row.content, row.hindsight_ref, row.created_at)
    .run()

  const values = await embed(env, m.content)
  if (values.length) {
    await env.VECTORS.upsert([
      {
        id: `mem:${row.id}`,
        values,
        metadata: { type: "agent_memory", user_id: m.userId, memId: row.id, kind: m.kind }
      }
    ])
  }
  return row
}

export async function recallMemories(
  env: Env,
  userId: string,
  query: string,
  topK = 5
): Promise<MemoryRow[]> {
  const qvec = await embed(env, query)
  if (!qvec.length) return []
  const res = await env.VECTORS.query(qvec, {
    topK,
    filter: { type: "agent_memory", user_id: userId },
    returnMetadata: true
  } as VectorizeQueryOptions)
  const ids = (res.matches ?? [])
    .map((mch) => (mch.metadata as { memId?: string } | undefined)?.memId)
    .filter((x): x is string => typeof x === "string")
  if (!ids.length) return []
  const placeholders = ids.map(() => "?").join(",")
  const rows = await env.DB.prepare(
    `SELECT * FROM agent_memories WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .all()
  const byId = new Map((rows.results as unknown as MemoryRow[]).map((r) => [r.id, r]))
  // Preserve the relevance order from the vector query.
  return ids.map((id) => byId.get(id)).filter((r): r is MemoryRow => !!r)
}
```

- [ ] **Step 4:** Run `pnpm vitest run tests/memory.test.ts` — PASS. `pnpm typecheck` clean. (Note: the fake VECTORS ignores `returnMetadata`; real Vectorize needs it to return metadata.)

- [ ] **Step 5: Commit** `agent-app/src/memory.ts agent-app/tests/memory.test.ts`, message: `feat(agent-app): D1+Vectorize memory layer (retain/recall)`

---

## Task 3: Reflect + wire recall/retain into ChatAgent

**Files:** MODIFY `agent-app/src/memory.ts` (add `reflect`); MODIFY `agent-app/src/agents/chat-agent.ts`.

- [ ] **Step 1: Add `reflect` to `memory.ts`:**

```ts
import { collectCompletion, type ChatMsg } from "./chat"
import { DEFAULT_MODEL_ID } from "./models"

/**
 * Summarize the latest exchange into a durable memory. Best-effort: failures
 * are swallowed so a reflection error never breaks a chat turn.
 */
export async function reflect(
  env: Env,
  userId: string,
  sessionId: string,
  recent: ChatMsg[]
): Promise<void> {
  try {
    const transcript = recent.map((m) => `${m.role}: ${m.content}`).join("\n")
    const summary = await collectCompletion(
      env,
      DEFAULT_MODEL_ID,
      [
        {
          role: "system",
          content:
            "Extract one durable fact about the user or task worth remembering for future conversations. Reply with the single fact only, or 'NONE' if nothing is worth retaining."
        },
        { role: "user", content: transcript }
      ],
      false
    )
    const fact = summary.trim()
    if (fact && fact.toUpperCase() !== "NONE") {
      await retainMemory(env, { userId, sessionId, kind: "reflection", content: fact })
    }
  } catch {
    /* reflection is best-effort */
  }
}
```

(Place the new imports at the top of memory.ts alongside the existing ones.)

- [ ] **Step 2: Modify `chat-agent.ts`** to recall before generating and reflect after. Add imports:
```ts
import { recallMemories, reflect } from "../memory"
```
Then in `onRequest`, after building `history` and resolving `model`, prepend recalled memories as a system message. The DO doesn't know the user id directly, so accept an optional `userId` in the body (the route already authenticates and can pass it). Update the body type to include `userId?: string` and the route (Task 4 not needed — update sessions.ts here) to pass it.

Concretely:
- Body type adds `userId?: string`.
- After `const history = await this.buildHistory(...)`, add:
```ts
    const userId = body.userId ?? "unknown"
    const memories = userId !== "unknown" ? await recallMemories(this.env, userId, body.content, 5) : []
    const contextMsgs: ChatMsg[] =
      memories.length > 0
        ? [{
            role: "system",
            content:
              "Relevant memories about this user:\n" +
              memories.map((m) => `- ${m.content}`).join("\n")
          }]
        : []
    const fullHistory = [...contextMsgs, ...history]
```
- Use `fullHistory` instead of `history` in both `collectCompletion` and `streamCompletion` calls.
- After persisting the assistant message on the JSON path, fire reflection (await is fine in DO):
```ts
    if (userId !== "unknown") await reflect(this.env, userId, body.sessionId, [
      { role: "user", content: body.content },
      { role: "assistant", content: reply }
    ])
```
- On the streaming path, after the `insertMessage` persistence inside `start`, add the same reflect call using `acc` as the assistant content (inside the existing try/catch is fine, or its own).

- [ ] **Step 3: Pass `userId` from the routes.** In `agent-app/src/routes/sessions.ts`, both the non-stream and stream handlers add `userId: c.get("userId")` to the JSON body sent to the DO.

- [ ] **Step 4: Update tests.** The existing `sessions.test.ts` / `sessions-stream.test.ts` use fake DO namespaces that ignore extra body fields → still pass. Add no new behavior test for the DO (needs Miniflare); memory.test.ts covers retain/recall and Task 3 below adds a reflect test.

Add to `tests/memory.test.ts`:
```ts
import { reflect } from "../src/memory"

it("reflect retains a fact from a transcript", async () => {
  const env = makeEnv()
  // Stub the chat completion via AI.run: embeddings return bge vector; the
  // LLM call (gpt-oss) returns a fact string as a non-stream? collectCompletion
  // uses streamCompletion → env.AI.run with stream:true returning a ReadableStream.
  const enc = new TextEncoder()
  ;(env.AI.run as any).mockImplementation(async (model: string, payload: any) => {
    if (String(model).includes("bge")) return { data: [new Array(768).fill(0.01)] }
    // streaming completion
    return new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ response: "user prefers dark mode" })}\n\n`))
        c.enqueue(enc.encode("data: [DONE]\n\n"))
        c.close()
      }
    })
  })
  await reflect(env, "u1", "s1", [
    { role: "user", content: "I always use dark mode" },
    { role: "assistant", content: "noted" }
  ])
  const r = await recallMemories(env, "u1", "appearance", 5)
  expect(r.some((m) => m.kind === "reflection")).toBe(true)
})
```

- [ ] **Step 5:** Run `pnpm test && pnpm typecheck` — all green. `pnpm wrangler deploy --dry-run` — DO resolves.

- [ ] **Step 6: Commit** `agent-app/src/memory.ts agent-app/src/agents/chat-agent.ts agent-app/src/routes/sessions.ts agent-app/tests/memory.test.ts`, message: `feat(agent-app): recall memories into context + reflect after turns`

---

## Task 4: Docs

**Files:** MODIFY `agent-app/DEPLOY.md`.

- [ ] **Step 1:** Add a "Self-learning (memory)" section: memories live in D1 `agent_memories` + the shared Vectorize index (metadata `type:"agent_memory"`, `user_id`); recall uses `@cf/baai/bge-base-en-v1.5` embeddings via gateway `x`; reflection runs best-effort after each turn; note the `@vectorize-io/hindsight-client` service can replace this layer later behind the same `memory.ts` interface.

- [ ] **Step 2: Commit** `agent-app/DEPLOY.md`, message: `docs(agent-app): document self-learning memory layer`

---

## Self-Review

- **Spec coverage:** §3 Hindsight/self-learning + D1 memory mirror → Tasks 2,3 (retain/recall/reflect, D1 system-of-record + Vectorize recall). Recall-into-context (§2) → Task 3.
- **Deviation (rationale):** Uses D1+Vectorize directly rather than the `@vectorize-io/hindsight-client` service, to stay Worker-reliable and fully testable without an external service dependency; same interface allows a later swap. Documented in plan + DEPLOY.md.
- **Type consistency:** `MemoryRow`, `embed`/`retainMemory`/`recallMemories`/`reflect`/`EMBED_MODEL` (memory.ts), `ChatMsg` reused from chat.ts, `userId` body field threaded route→DO. Vectorize metadata keys (`type`,`user_id`,`memId`,`kind`) consistent between upsert and query filter.

## Next plans
- **Plan 4 — Sidebar `agent` tab.**
- **Plan 5 — TanStack Start + TanStack AI web UI.**
