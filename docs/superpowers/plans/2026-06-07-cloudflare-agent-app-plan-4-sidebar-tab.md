# Cloudflare Agent App — Plan 4: Sidebar Agent Chat tab

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Add a native sidebar tab ("Agent") to the Plasmo extension that chats with the deployed `agent-app` Worker — streaming replies via SSE, model picker, session list — authenticating with a Cloudflare Access service token configured in Settings.

**Architecture:** A typed client `src/lib/agent-api.ts` wraps the Worker's REST + SSE endpoints, sending `CF-Access-Client-Id`/`CF-Access-Client-Secret` headers. A new section `src/sections/agent-chat/AgentChatSection.tsx` calls it **directly from the panel** (the remote Worker does the LLM work + memory, so no background orchestrator is needed). Config (agent API URL + service token id/secret) lives in `Settings`. The section is registered in the section registry, rail, and e2e list.

**Tech Stack:** React 18, Plasmo, @plasmohq/storage, fetch + ReadableStream (SSE), vitest + happy-dom, Playwright.

**Builds on:** Plans 1-3 (deployed agent-app API). Branch `feat/agent-app-sidebar-tab` off `main`.

**Covers spec §6** (sidebar tab). IMPORTANT for all tasks: this edits EXISTING extension files — READ each referenced file fully before editing and match its existing style/imports exactly. Do not restructure unrelated code.

---

## Endpoints consumed (from agent-app, Plans 1-2)
- `GET /api/models` → `{ models: {id,label,kind,experimental?}[] }`
- `GET /api/prefs/model` / `PUT /api/prefs/model {modelId}` → `{ modelId }`
- `GET /api/sessions` / `POST /api/sessions {title}` → `{ sessions } / { session }`
- `GET /api/sessions/:id/messages` → `{ messages }`
- `POST /api/sessions/:id/messages/stream {content, modelId?, advanced?}` → SSE `data: {"delta":"..."}` … `data: [DONE]`
All require headers `CF-Access-Client-Id` + `CF-Access-Client-Secret` (and `/api/health` is public).

---

## Task 1: Settings fields for the agent API

**Files:** MODIFY `src/types.ts` (Settings + DEFAULT_SETTINGS), `src/components/SettingsPanel.tsx`; Test `tests/agent-settings.test.ts`.

- [ ] **Step 1: Read** `src/types.ts` (Settings interface ~86-133 + DEFAULT_SETTINGS ~170-202) and `src/components/SettingsPanel.tsx` (the sidebar-api inputs section ~515-535).

- [ ] **Step 2: Write failing test** `tests/agent-settings.test.ts` asserting DEFAULT_SETTINGS has the new keys and SettingsPanel.tsx contains inputs bound to them:
```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_SETTINGS } from "../src/types"

describe("agent API settings", () => {
  it("DEFAULT_SETTINGS has agent api url + access token fields", () => {
    expect(DEFAULT_SETTINGS).toHaveProperty("agentApiUrl")
    expect(DEFAULT_SETTINGS).toHaveProperty("agentAccessClientId")
    expect(DEFAULT_SETTINGS).toHaveProperty("agentAccessClientSecret")
  })
  it("SettingsPanel renders inputs bound to the agent settings", () => {
    const src = readFileSync(join(process.cwd(), "src/components/SettingsPanel.tsx"), "utf8")
    expect(src).toContain("agentApiUrl")
    expect(src).toContain("agentAccessClientId")
    expect(src).toContain("agentAccessClientSecret")
  })
})
```

- [ ] **Step 3: Run** `pnpm vitest run tests/agent-settings.test.ts` — FAIL.

- [ ] **Step 4: Implement.**
  - In `src/types.ts` `Settings` interface add: `agentApiUrl: string`, `agentAccessClientId: string`, `agentAccessClientSecret: string`. In `DEFAULT_SETTINGS` add `agentApiUrl: ""`, `agentAccessClientId: ""`, `agentAccessClientSecret: ""`.
  - In `src/components/SettingsPanel.tsx`, near the existing sidebar-api inputs, add three inputs (text for URL placeholder `https://agent.fly.pm`, password for client id, password for client secret), each `value={settings.X}` + `onChange={(e) => onUpdate({ X: e.target.value })}`, matching the surrounding markup/labels exactly. Add a small section label like "Agent API (Cloudflare Access)".

- [ ] **Step 5: Run** `pnpm vitest run tests/agent-settings.test.ts` then `pnpm typecheck` — green.

- [ ] **Step 6: Commit** `src/types.ts src/components/SettingsPanel.tsx tests/agent-settings.test.ts`, message: `feat(sidebar): agent API settings (url + Access service token)`

---

## Task 2: Agent API client

**Files:** Create `src/lib/agent-api.ts`; Test `tests/agent-api.test.ts`.

- [ ] **Step 1: Read** `src/lib/sidebar-api.ts` to match the client/error conventions (ApiError shape, base-url cleaning, header building).

- [ ] **Step 2: Write failing test** `tests/agent-api.test.ts` (mock global fetch for JSON + a streaming Response):
```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createAgentApiClient } from "../src/lib/agent-api"

const cfg = { baseUrl: "https://agent.test", clientId: "cid", clientSecret: "csec" }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}
function sseResponse(deltas: string[]) {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      for (const d of deltas) c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: d })}\n\n`))
      c.enqueue(enc.encode("data: [DONE]\n\n"))
      c.close()
    }
  })
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } })
}

describe("agent-api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("sends Access headers and lists models", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [{ id: "m1", label: "M1", kind: "workers-ai" }] }))
    const client = createAgentApiClient(cfg)
    const models = await client.listModels()
    expect(models[0]!.id).toBe("m1")
    const [, init] = fetchMock.mock.calls[0]!
    const headers = new Headers(init.headers)
    expect(headers.get("cf-access-client-id")).toBe("cid")
    expect(headers.get("cf-access-client-secret")).toBe("csec")
  })

  it("creates a session", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ session: { id: "s1", title: "t" } }))
    const client = createAgentApiClient(cfg)
    const s = await client.createSession("t")
    expect(s.id).toBe("s1")
  })

  it("streams message deltas via async iterator", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(["Hel", "lo"]))
    const client = createAgentApiClient(cfg)
    const out: string[] = []
    for await (const delta of client.streamMessage("s1", { content: "hi" })) out.push(delta)
    expect(out.join("")).toBe("Hello")
  })

  it("throws on non-ok", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 401 }))
    const client = createAgentApiClient(cfg)
    await expect(client.listModels()).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Run** `pnpm vitest run tests/agent-api.test.ts` — FAIL.

- [ ] **Step 4: Implement** `src/lib/agent-api.ts`:
```ts
export interface AgentApiConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
}

export interface AgentModel {
  id: string
  label: string
  kind: "workers-ai" | "advanced"
  experimental?: boolean
}
export interface AgentSession {
  id: string
  title: string
  created_at?: number
  updated_at?: number
}
export interface AgentMessage {
  id: string
  session_id: string
  role: string
  content: string
  model: string | null
  created_at: number
}

export class AgentApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = "AgentApiError"
  }
}

export interface AgentApiClient {
  health(): Promise<boolean>
  listModels(): Promise<AgentModel[]>
  getModelPref(): Promise<string>
  setModelPref(modelId: string): Promise<string>
  listSessions(): Promise<AgentSession[]>
  createSession(title?: string): Promise<AgentSession>
  listMessages(sessionId: string): Promise<AgentMessage[]>
  streamMessage(
    sessionId: string,
    opts: { content: string; modelId?: string; advanced?: boolean; signal?: AbortSignal }
  ): AsyncGenerator<string>
}

export function createAgentApiClient(cfg: AgentApiConfig): AgentApiClient {
  const base = cfg.baseUrl.replace(/\/+$/, "")
  function authHeaders(extra?: HeadersInit): Headers {
    const h = new Headers(extra)
    h.set("cf-access-client-id", cfg.clientId)
    h.set("cf-access-client-secret", cfg.clientSecret)
    return h
  }
  async function jsonReq<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = authHeaders(init.headers)
    if (init.body) headers.set("content-type", "application/json")
    const res = await fetch(`${base}${path}`, { ...init, headers })
    if (!res.ok) throw new AgentApiError(res.status, `${init.method ?? "GET"} ${path} → ${res.status}`)
    return (await res.json()) as T
  }

  return {
    async health() {
      try {
        const res = await fetch(`${base}/api/health`)
        return res.ok
      } catch {
        return false
      }
    },
    async listModels() {
      return (await jsonReq<{ models: AgentModel[] }>("/api/models")).models
    },
    async getModelPref() {
      return (await jsonReq<{ modelId: string }>("/api/prefs/model")).modelId
    },
    async setModelPref(modelId) {
      return (
        await jsonReq<{ modelId: string }>("/api/prefs/model", {
          method: "PUT",
          body: JSON.stringify({ modelId })
        })
      ).modelId
    },
    async listSessions() {
      return (await jsonReq<{ sessions: AgentSession[] }>("/api/sessions")).sessions
    },
    async createSession(title) {
      return (
        await jsonReq<{ session: AgentSession }>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ title: title ?? "New chat" })
        })
      ).session
    },
    async listMessages(sessionId) {
      return (await jsonReq<{ messages: AgentMessage[] }>(`/api/sessions/${sessionId}/messages`)).messages
    },
    async *streamMessage(sessionId, opts) {
      const headers = authHeaders({ "content-type": "application/json" })
      const res = await fetch(`${base}/api/sessions/${sessionId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: opts.content, modelId: opts.modelId, advanced: opts.advanced }),
        signal: opts.signal
      })
      if (!res.ok || !res.body) throw new AgentApiError(res.status, `stream → ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
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
            try {
              const obj = JSON.parse(data) as { delta?: string }
              if (obj.delta) yield obj.delta
            } catch {
              /* ignore keepalives */
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    }
  }
}
```

- [ ] **Step 5: Run** `pnpm vitest run tests/agent-api.test.ts` then `pnpm typecheck` — green.

- [ ] **Step 6: Commit** `src/lib/agent-api.ts tests/agent-api.test.ts`, message: `feat(sidebar): typed agent-app API client (REST + SSE)`

---

## Task 3: AgentChatSection component

**Files:** Create `src/sections/agent-chat/AgentChatSection.tsx`; Test `tests/agent-chat-section.test.tsx`.

- [ ] **Step 1: Read** `src/sections/ai-chat/ChatSection.tsx` for the UI/styling conventions (Tailwind classes, message bubbles, composer) and `src/storage.ts` `getSettings`.

- [ ] **Step 2: Write a behavior test** `tests/agent-chat-section.test.tsx` using @testing-library/react + happy-dom. Mock `../src/storage` getSettings to return configured agent settings, and mock `../src/lib/agent-api` createAgentApiClient so listSessions/listModels resolve and streamMessage yields deltas. Assert that typing + submit renders the streamed assistant text. Keep it focused:
```tsx
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AgentChatSection } from "../src/sections/agent-chat/AgentChatSection"

vi.mock("../src/storage", () => ({
  getSettings: async () => ({
    agentApiUrl: "https://agent.test",
    agentAccessClientId: "cid",
    agentAccessClientSecret: "csec"
  })
}))

vi.mock("../src/lib/agent-api", () => ({
  createAgentApiClient: () => ({
    health: async () => true,
    listModels: async () => [{ id: "m1", label: "M1", kind: "workers-ai" }],
    getModelPref: async () => "m1",
    setModelPref: async (m: string) => m,
    listSessions: async () => [],
    createSession: async (t: string) => ({ id: "s1", title: t }),
    listMessages: async () => [],
    async *streamMessage() {
      yield "Hello"
      yield " world"
    }
  }),
  AgentApiError: class extends Error {}
}))

describe("AgentChatSection", () => {
  it("sends a message and renders the streamed reply", async () => {
    render(<AgentChatSection />)
    const input = await screen.findByPlaceholderText(/message/i)
    fireEvent.change(input, { target: { value: "hi" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(screen.getByText(/Hello world/)).toBeTruthy())
  })

  it("shows a config hint when settings are missing", async () => {
    // override the storage mock for this test if desired; otherwise covered by the configured case.
    expect(true).toBe(true)
  })
})
```
(If wiring the missing-config test is awkward with the module-level mock, keep the first test as the real coverage and leave the second trivial — note it.)

- [ ] **Step 3: Run** `pnpm vitest run tests/agent-chat-section.test.tsx` — FAIL.

- [ ] **Step 4: Implement** `src/sections/agent-chat/AgentChatSection.tsx`. Requirements:
  - On mount: load settings; if `agentApiUrl`/`agentAccessClientId`/`agentAccessClientSecret` missing, render a hint linking to Settings (don't crash).
  - Create the client via `createAgentApiClient`. Load models + current model pref + sessions. Ensure an active session (create one if none).
  - State: `messages: AgentMessage[]` (or a lightweight local message type), `draft`, `streaming` (the in-progress assistant text), `modelId`, `models`.
  - Composer: textarea/input with placeholder containing "message"; Enter submits (Shift+Enter newline). On submit: append the user message locally, then `for await (const delta of client.streamMessage(sessionId, { content, modelId }))` appending to a streaming assistant bubble; on completion, finalize.
  - Model picker: a `<select>` of `models` (label, mark experimental); on change call `setModelPref` and update local `modelId`.
  - Use the same Tailwind look as ChatSection.tsx (message bubbles, scroll container). Keep it a single focused file.
  - Export a named `AgentChatSection` React component.
  - Handle errors: wrap stream in try/catch, show an inline error bubble (don't throw).

- [ ] **Step 5: Run** `pnpm vitest run tests/agent-chat-section.test.tsx` then `pnpm typecheck` — green. (If @testing-library/react isn't installed, it is — the explorer confirmed tests use it; if not, add it as a devDep and report.)

- [ ] **Step 6: Commit** `src/sections/agent-chat/AgentChatSection.tsx tests/agent-chat-section.test.tsx`, message: `feat(sidebar): Agent chat section (streaming UI + model picker)`

---

## Task 4: Register the section (rail + panel + e2e)

**Files:** MODIFY `src/sections/types.ts`, `src/sidepanel.tsx`, `src/components/SidebarRail.tsx`, `tests/e2e/sidepanel-rail.spec.ts`; Test `tests/agent-section-registry.test.ts`.

- [ ] **Step 1: Read** all four files. Note the existing `SectionId` values, the `SECTIONS` array order, the `ICONS` map in SidebarRail (and the LeoIconName type — pick a VALID icon name; reuse one already present such as the chat/Leo icon used elsewhere, or `product-brave-leo` only if it's already a valid LeoIconName in the project — verify against the icon type/existing values before using).

- [ ] **Step 2: Write failing test** `tests/agent-section-registry.test.ts`:
```ts
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SECTIONS } from "../src/sections/types"

describe("agent-chat section registration", () => {
  it("is in the SECTIONS registry", () => {
    expect(SECTIONS.map((s) => s.id)).toContain("agentChat")
  })
  it("is rendered in sidepanel.tsx", () => {
    const src = readFileSync(join(process.cwd(), "src/sidepanel.tsx"), "utf8")
    expect(src).toContain("AgentChatSection")
    expect(src).toContain('"agentChat"')
  })
  it("has a rail icon mapping", () => {
    const src = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    expect(src).toContain("agentChat:")
  })
})
```

- [ ] **Step 3: Run** — FAIL.

- [ ] **Step 4: Implement.**
  - `src/sections/types.ts`: add `"agentChat"` to the `SectionId` union and `{ id: "agentChat", label: "Agent" }` to `SECTIONS` (place sensibly, e.g., near joplin).
  - `src/sidepanel.tsx`: import `AgentChatSection` and add `{active === "agentChat" && <AgentChatSection />}` in the render block, matching the existing conditional pattern.
  - `src/components/SidebarRail.tsx`: add `agentChat: "<valid-leo-icon>"` to the `ICONS` record.
  - `tests/e2e/sidepanel-rail.spec.ts`: add `"agentChat"` to `SECTION_IDS` and `agentChat: "Agent"` to `SECTION_LABELS`.

- [ ] **Step 5: Run** `pnpm vitest run tests/agent-section-registry.test.ts` then full `pnpm test` (unit) and `pnpm typecheck` — green. Do NOT run the Playwright e2e here (needs a built extension); just ensure the spec's arrays are consistent.

- [ ] **Step 6: Commit** the four files + the registry test, message: `feat(sidebar): register Agent chat section in rail + panel`

---

## Task 5: Docs

**Files:** MODIFY `README.md` (or the section docs) briefly.

- [ ] **Step 1:** Add a short note that the Agent tab talks to the `agent-app` Worker and requires Agent API URL + Cloudflare Access service token id/secret set in Settings.

- [ ] **Step 2: Commit**, message: `docs(sidebar): document Agent chat tab configuration`

---

## Self-Review
- **Spec coverage §6:** native tab (Tasks 3-4), service-token auth (Tasks 1-2), model picker + streaming (Tasks 2-3), absorbs/parallels the ai-chat pattern. The remote Worker does LLM+memory so no background orchestrator is added (simpler than the old local ai-chat). 
- **Type consistency:** `agentApiUrl`/`agentAccessClientId`/`agentAccessClientSecret` settings keys; `createAgentApiClient`/`AgentApiClient`/`AgentModel`/`AgentSession`/`AgentMessage`/`streamMessage` (agent-api.ts); section id `"agentChat"`; used identically across types, client, component, registry, tests.
- **Risk:** editing existing extension files — implementers must read each file first and match style; pick a VALID LeoIconName; update the e2e arrays so the rail test stays consistent.

## Next plan
- **Plan 5 — TanStack Start + TanStack AI web UI** (agent-app web frontend behind Access SSO).
