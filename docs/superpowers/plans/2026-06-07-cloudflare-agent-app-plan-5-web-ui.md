# Cloudflare Agent App — Plan 5: TanStack web UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** A web chat UI for the `agent-app` Worker — TanStack Router + Query + a streaming chat view + model picker — served by the same Worker via its assets binding, behind Cloudflare Access SSO. Same `/api/*` backend as the sidebar tab.

**Architecture:** A Vite-built SPA in `agent-app/web/` output to `agent-app/dist/web`, served by the Worker through an `[assets]` binding (mirroring the proven `worker/` setup). The Hono app serves `/api/*`; non-API paths fall through to `ASSETS` with SPA fallback. SSO is automatic: Cloudflare Access injects `Cf-Access-Jwt-Assertion` on same-origin requests, which the existing `requireAccess` middleware validates — so the SPA's same-origin `fetch("/api/...")` is authenticated with no client-side token.

> Deviation from "TanStack Start": uses a Vite SPA + `@tanstack/react-router`/`@tanstack/react-query` served via the Worker assets binding, rather than TanStack Start SSR, to keep a single Worker entry and reuse the working `worker/` assets pattern. "TanStack AI" is realized as a small SSE chat hook (swappable for the TanStack AI package later). Documented in DEPLOY.md.

**Tech Stack:** Vite, React 18, @tanstack/react-router, @tanstack/react-query, @vitejs/plugin-react, Cloudflare Workers assets, vitest.

**Builds on:** Plans 1-3 (API). Branch `feat/agent-app-web-ui` off `main`. **Mirror `worker/`'s web build** (`worker/vite.config.web.ts`, `worker/web/`, `worker/tsconfig.web.json`, `worker/wrangler.toml` `[assets]`, `worker/src/index.ts` notFound→ASSETS) — READ those first.

**Covers spec §7** (TanStack web UI).

---

## Task 1: Web build scaffold + deps

**Files:** MODIFY `agent-app/package.json`; Create `agent-app/vite.config.web.ts`, `agent-app/tsconfig.web.json`, `agent-app/web/index.html`, `agent-app/web/src/main.tsx`, `agent-app/web/src/styles.css`.

- [ ] **Step 1: Read** `worker/vite.config.web.ts`, `worker/tsconfig.web.json`, `worker/web/index.html`, `worker/web/src/main.tsx`, `worker/package.json` scripts.

- [ ] **Step 2: Add deps** to `agent-app/package.json` (use latest at install): dependencies `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`; devDependencies `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`. Add scripts: `"dev:web": "vite --config vite.config.web.ts"`, `"build:web": "vite build --config vite.config.web.ts"`, and change `"build"` to `"pnpm build:web && wrangler deploy"`. Add web typecheck: change `"typecheck"` to `"tsc --noEmit -p . && tsc --noEmit -p tsconfig.web.json"`. Run `pnpm install`.

- [ ] **Step 3: Create `agent-app/vite.config.web.ts`** mirroring worker's (root `./web`, outDir `./dist/web`, react plugin, es2022, dev proxy `/api`→`http://127.0.0.1:8787`).

- [ ] **Step 4: Create `agent-app/tsconfig.web.json`** mirroring `worker/tsconfig.web.json` (DOM libs, jsx react-jsx, include `web`).

- [ ] **Step 5: Create `agent-app/web/index.html`** (mirror worker's — root div + module script to `/src/main.tsx`, title "Agent").

- [ ] **Step 6: Create `agent-app/web/src/styles.css`** (minimal; can mirror worker's or a small reset).

- [ ] **Step 7: Create `agent-app/web/src/main.tsx`** that mounts the app (created in Task 2) with a `QueryClientProvider` and the TanStack Router `RouterProvider`. (If Task 2 not yet present, main.tsx can be finalized in Task 2; create a placeholder that imports `./App`.)

- [ ] **Step 8:** Run `pnpm build:web` — must produce `agent-app/dist/web/index.html` + assets. `pnpm typecheck` clean (web tsconfig may need the app from Task 2 — if so, defer the strict web typecheck assertion to Task 2 and just ensure `tsc -p .` is clean here). Ensure `agent-app/dist` is gitignored (add to `.gitignore` if needed; mirror worker which doesn't commit dist).

- [ ] **Step 9: Commit** the config + scaffold files + package.json + lockfile, message: `feat(agent-app): web build scaffold (Vite + TanStack)`

---

## Task 2: Agent web client + chat route

**Files:** Create `agent-app/web/src/api.ts`, `agent-app/web/src/App.tsx`, `agent-app/web/src/routes.tsx` (or inline), `agent-app/web/src/ChatPage.tsx`; Test `agent-app/tests/web-api.test.ts`.

- [ ] **Step 1: Write failing test** `agent-app/tests/web-api.test.ts` for the SSE parser in the web client (mock fetch like the extension's agent-api test). Test that `streamMessage` yields deltas and `[DONE]` ends it, and that requests are same-origin (no Access headers needed — the cookie/edge injects the JWT). Use vitest (node env is fine for fetch-mock + ReadableStream).

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { createWebAgentClient } from "../web/src/api"

function sse(deltas: string[]) {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(c) {
        for (const d of deltas) c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: d })}\n\n`))
        c.enqueue(enc.encode("data: [DONE]\n\n"))
        c.close()
      }
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } }
  )
}

describe("web agent client", () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

  it("lists models from same-origin /api", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ id: "m1", label: "M1", kind: "workers-ai" }] }), { status: 200 })
    )
    const models = await createWebAgentClient().listModels()
    expect(models[0]!.id).toBe("m1")
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/models")
  })

  it("streams deltas", async () => {
    fetchMock.mockResolvedValueOnce(sse(["Hel", "lo"]))
    const out: string[] = []
    for await (const d of createWebAgentClient().streamMessage("s1", { content: "hi" })) out.push(d)
    expect(out.join("")).toBe("Hello")
  })
})
```

- [ ] **Step 2: Run** `pnpm vitest run tests/web-api.test.ts` — FAIL.

- [ ] **Step 3: Implement** `agent-app/web/src/api.ts` — a same-origin client (`createWebAgentClient()`): `listModels`, `getModelPref`, `setModelPref`, `listSessions`, `createSession`, `listMessages`, and async-generator `streamMessage(sessionId,{content,modelId?,advanced?,signal?})`. All fetch relative `/api/...` (same-origin; Access JWT injected by the edge). Reuse the SSE parsing approach from `agent-app/src/chat.ts`/the extension client (buffer/split/[DONE]/JSON delta, releaseLock in finally). Export the model/session/message types.

- [ ] **Step 4: Implement** `agent-app/web/src/ChatPage.tsx` — a React component using `@tanstack/react-query` to load models + sessions (ensure a session) and local state for the streaming turn; a composer (Enter to send), a model `<select>`, message bubbles, streaming via `client.streamMessage` with an AbortController on unmount. Keep it focused.

- [ ] **Step 5: Implement** `agent-app/web/src/App.tsx` + router: a `@tanstack/react-router` with a single index route rendering `ChatPage`, wrapped (in main.tsx) by `QueryClientProvider`. Finalize `main.tsx` to render `<RouterProvider router={router} />` inside `<QueryClientProvider>`.

- [ ] **Step 6: Run** `pnpm vitest run tests/web-api.test.ts`, `pnpm build:web` (SPA builds), `pnpm typecheck` (both tsconfigs) — all green.

- [ ] **Step 7: Commit** the web src files + test, message: `feat(agent-app): TanStack chat web UI (streaming + model picker)`

---

## Task 3: Serve the SPA from the Worker

**Files:** MODIFY `agent-app/wrangler.toml`, `agent-app/src/env.ts`, `agent-app/src/index.ts`, `agent-app/src/app.ts`.

- [ ] **Step 1: Read** `worker/wrangler.toml` `[assets]` block and `worker/src/index.ts` notFound→ASSETS handling.

- [ ] **Step 2:** `agent-app/wrangler.toml` — add:
```toml
[assets]
directory = "./dist/web"
binding = "ASSETS"
not_found_handling = "single-page-application"
```

- [ ] **Step 3:** `agent-app/src/env.ts` — add `ASSETS?: Fetcher` to `Env`.

- [ ] **Step 4:** Change the notFound handler so non-`/api/*` paths fall through to the SPA. Since `buildApp()` (in `src/app.ts`) is also used by tests (no ASSETS), keep the notFound in `src/index.ts` (the deployed entry, which already owns notFound) and make it:
```ts
app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: { code: "not_found", message: "no such route" } }, 404)
  }
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw)
  return c.json({ error: { code: "not_found", message: "no such route" } }, 404)
})
```
(Leave `src/app.ts` without a notFound — it already has none after Plan 1's refactor; the route tests don't depend on it. Verify.)

- [ ] **Step 5: Verify.** `pnpm build:web` (so dist/web exists), then `pnpm wrangler deploy --dry-run` — succeeds, shows the `ASSETS` binding + `CHAT_AGENT` DO. `pnpm test && pnpm typecheck` — all green (server tests unaffected; ASSETS is optional in Env).

- [ ] **Step 6: Commit** `agent-app/wrangler.toml agent-app/src/env.ts agent-app/src/index.ts`, message: `feat(agent-app): serve TanStack SPA via Worker assets binding`

---

## Task 4: Docs

**Files:** MODIFY `agent-app/DEPLOY.md`.

- [ ] **Step 1:** Add a "Web UI" section: `pnpm build:web` before `pnpm deploy` (or `pnpm build` does both); the SPA is served at the root behind Access SSO (no client token — the edge injects the Access JWT validated by `requireAccess`); local dev = `pnpm dev` (Worker) + `pnpm dev:web` (Vite, proxies `/api`). Note the SSR deviation (Vite SPA + TanStack Router/Query instead of TanStack Start; TanStack AI swappable later).

- [ ] **Step 2: Commit** `agent-app/DEPLOY.md`, message: `docs(agent-app): document web UI build + SSO`

---

## Self-Review
- **Spec coverage §7:** TanStack-based web chat UI behind Access SSO, same `/api/*` backend, served by the Worker. SSR→SPA deviation documented with rationale.
- **Type consistency:** `createWebAgentClient` + `streamMessage` (web/src/api.ts), `ASSETS` binding (env + wrangler + index), reuses the established `/api/*` contract + SSE delta shape from Plans 1-2.
- **Risk:** new Vite build inside agent-app — mirror `worker/`'s proven setup; keep `dist/web` gitignored; SSO relies on the edge injecting `Cf-Access-Jwt-Assertion` (already validated by requireAccess from Plan 1).

## Done
This completes the planned build (Plans 1-5). Remaining real-world step: deploy (Access app + service token, Doppler secrets, `pnpm d1:migrate:remote`, `pnpm build && pnpm deploy`).
