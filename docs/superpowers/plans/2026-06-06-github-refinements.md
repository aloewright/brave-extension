# GitHub Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `github.com` content script that injects opt-in, Refined-GitHub-style enhancements (read + write actions), controlled by a new **GitHub** sidebar section with a master switch and per-category toggles.

**Architecture:** A thin local framework (`page-detect`, `observe`, safe `dom` factory, `api`, `registry`, `runtime`) replaces Refined GitHub's coupled dependency tree. Each feature is an idempotent `init(signal)` registered with metadata. A content script reads per-feature toggles from `chrome.storage.local` (persisted via the existing `Settings` path) and runs matching features, re-running on SPA navigation and live storage changes. The GitHub PAT for API-backed features is fetched from Doppler by the sidebar UI and cached in `chrome.storage.session` (never persisted to disk, never in `Settings`).

**Tech Stack:** TypeScript, Plasmo MV3, React 18, Tailwind, Vitest + happy-dom. No new runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-06-github-refinements-design.md`

**Selector caveat:** GitHub's React UI changes selectors frequently. Unit tests cover framework logic and feature behavior against fixture DOM. Selector-dependent features additionally require a **live verification step** (load `pnpm dev`, open the relevant GitHub page) — this is called out per feature and is not optional.

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/contents/github.ts` | Plasmo content script entry; matches `https://github.com/*`, boots `runtime`. |
| `src/lib/github/page-detect.ts` | URL/pathname predicates (`isPR`, `isIssue`, `isRepoRoot`, …). Pure functions. |
| `src/lib/github/observe.ts` | `observe(selector, cb, {signal})` via `MutationObserver`; `elementReady`. |
| `src/lib/github/dom.ts` | Safe element factory `el()`; `injectStyle()`. No `innerHTML`/`eval`. |
| `src/lib/github/repo.ts` | Parse `owner`/`name`/`branch`/`filePath` from `location`. Pure. |
| `src/lib/github/token.ts` | Read/cache GitHub PAT from `chrome.storage.session`. |
| `src/lib/github/api.ts` | GitHub REST (`v3`) + GraphQL (`v4`) client; GitHub-only origins. |
| `src/lib/github/registry.ts` | `FeatureMeta` type, `FEATURES` array, `isFeatureOn()`. |
| `src/lib/github/runtime.ts` | Boot/teardown features; SPA-nav + storage-change handling. |
| `src/lib/github/features/*.ts` | One file per feature, each `export default` a `FeatureMeta`. |
| `src/sections/github/GitHubSection.tsx` | Sidebar UI: master switch + per-category toggles + token status. |
| `src/sections/github/github-token-ui.ts` | Doppler fetch + session-cache helper used by the section. |
| `src/types.ts` (modify) | Add `GitHubFeatureSettings`, extend `Settings` + `DEFAULT_SETTINGS`. |
| `src/sections/types.ts` (modify) | Add `"github"` to `SectionId` + `SECTIONS`. |
| `src/components/SidebarRail.tsx` (modify) | Add `github` icon to `ICONS`. |
| `src/sidepanel.tsx` (modify) | Import + render `GitHubSection` when active. |

---

## Phase 0 — Storage shape

### Task 0.1: Extend Settings with `github`

**Files:**
- Modify: `src/types.ts` (the `Settings` interface near line 79, `DEFAULT_SETTINGS` near line 162)
- Test: `tests/github/settings-shape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/settings-shape.test.ts
import { describe, it, expect } from "vitest"
import { DEFAULT_SETTINGS } from "../../src/types"

describe("github settings", () => {
  it("defaults to enabled master switch and empty overrides", () => {
    expect(DEFAULT_SETTINGS.github).toEqual({ enabled: true, features: {} })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/settings-shape.test.ts`
Expected: FAIL — `github` is undefined on `DEFAULT_SETTINGS`.

- [ ] **Step 3: Add the type and default**

In `src/types.ts`, add above the `Settings` interface:

```ts
export interface GitHubFeatureSettings {
  /** Master switch. When false, the content script runs nothing. */
  enabled: boolean
  /** Per-feature on/off overrides keyed by feature id. Absent ⇒ registry default. */
  features: Record<string, boolean>
}
```

Add `github: GitHubFeatureSettings` to the `Settings` interface, and to `DEFAULT_SETTINGS` add:

```ts
  github: { enabled: true, features: {} },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/settings-shape.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/github/settings-shape.test.ts
git commit -m "feat(github): add GitHubFeatureSettings to Settings"
```

---

## Phase 1 — Framework primitives

### Task 1.1: `page-detect` predicates

**Files:**
- Create: `src/lib/github/page-detect.ts`
- Test: `tests/github/page-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/page-detect.test.ts
import { describe, it, expect } from "vitest"
import * as pd from "../../src/lib/github/page-detect"

const u = (s: string) => new URL(s)

describe("page-detect", () => {
  it("isRepoRoot", () => {
    expect(pd.isRepoRoot(u("https://github.com/o/r"))).toBe(true)
    expect(pd.isRepoRoot(u("https://github.com/o/r/pull/1"))).toBe(false)
  })
  it("isPR / isPRFiles", () => {
    expect(pd.isPR(u("https://github.com/o/r/pull/12"))).toBe(true)
    expect(pd.isPRFiles(u("https://github.com/o/r/pull/12/files"))).toBe(true)
    expect(pd.isPRFiles(u("https://github.com/o/r/pull/12"))).toBe(false)
  })
  it("isIssue", () => {
    expect(pd.isIssue(u("https://github.com/o/r/issues/3"))).toBe(true)
    expect(pd.isIssue(u("https://github.com/o/r/issues"))).toBe(false)
  })
  it("isCommit / isProfile / isDashboard / isNotFound", () => {
    expect(pd.isCommit(u("https://github.com/o/r/commit/abc"))).toBe(true)
    expect(pd.isProfile(u("https://github.com/octocat"))).toBe(true)
    expect(pd.isProfile(u("https://github.com/o/r"))).toBe(false)
    expect(pd.isDashboard(u("https://github.com/"))).toBe(true)
    expect(pd.isNewRepo(u("https://github.com/new"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/page-detect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/page-detect.ts
// Minimal local port of github-url-detection. Pure URL/pathname predicates.

const RESERVED = new Set([
  "new", "settings", "notifications", "marketplace", "explore", "issues",
  "pulls", "search", "sponsors", "orgs", "login", "join", "about", "topics",
  "trending", "codespaces", "dashboard"
])

const parts = (url: URL) => url.pathname.split("/").filter(Boolean)

export const isDashboard = (url: URL) => parts(url).length === 0
export const isNewRepo = (url: URL) => url.pathname === "/new"

export function isRepoRoot(url: URL): boolean {
  const p = parts(url)
  return p.length === 2 && !RESERVED.has(p[0])
}

export function isRepo(url: URL): boolean {
  const p = parts(url)
  return p.length >= 2 && !RESERVED.has(p[0])
}

export const isPR = (url: URL) => /^\/[^/]+\/[^/]+\/pull\/\d+/.test(url.pathname)
export const isPRFiles = (url: URL) => /^\/[^/]+\/[^/]+\/pull\/\d+\/files\/?$/.test(url.pathname)
export const isPRConversation = (url: URL) => /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
export const isIssue = (url: URL) => /^\/[^/]+\/[^/]+\/issues\/\d+/.test(url.pathname)
export const isCommit = (url: URL) => /^\/[^/]+\/[^/]+\/commit\/[0-9a-f]+/i.test(url.pathname)
export const isRepoSettings = (url: URL) => /^\/[^/]+\/[^/]+\/settings\/?$/.test(url.pathname)

export function isProfile(url: URL): boolean {
  const p = parts(url)
  return p.length === 1 && !RESERVED.has(p[0])
}

/** A single-file view: blob/<ref>/<path>. */
export const isSingleFile = (url: URL) => /^\/[^/]+\/[^/]+\/blob\//.test(url.pathname)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/page-detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/page-detect.ts tests/github/page-detect.test.ts
git commit -m "feat(github): page-detect URL predicates"
```

---

### Task 1.2: safe `dom` factory + style injection

**Files:**
- Create: `src/lib/github/dom.ts`
- Test: `tests/github/dom.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/dom.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { el, injectStyle } from "../../src/lib/github/dom"

beforeEach(() => { document.head.innerHTML = ""; document.body.innerHTML = "" })

describe("dom factory", () => {
  it("creates elements with props, dataset, and text children", () => {
    const node = el("button", { className: "x", title: "t", dataset: { id: "7" } }, "Hi")
    expect(node.tagName).toBe("BUTTON")
    expect(node.className).toBe("x")
    expect(node.title).toBe("t")
    expect(node.dataset.id).toBe("7")
    expect(node.textContent).toBe("Hi")
  })
  it("appends element children and sets onclick", () => {
    let clicked = false
    const child = el("span", {}, "c")
    const node = el("div", { onclick: () => { clicked = true } }, child)
    expect(node.querySelector("span")?.textContent).toBe("c")
    node.click()
    expect(clicked).toBe(true)
  })
  it("never uses innerHTML — text is escaped", () => {
    const node = el("div", {}, "<img src=x onerror=alert(1)>")
    expect(node.querySelector("img")).toBeNull()
    expect(node.textContent).toContain("<img")
  })
  it("injectStyle adds a single keyed <style>", () => {
    injectStyle("k1", ".a{color:red}")
    injectStyle("k1", ".a{color:red}")
    expect(document.querySelectorAll('style[data-rgh="k1"]').length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/dom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/dom.ts
// Safe DOM construction. No innerHTML, no eval. Replaces dom-chef for our needs.

type Props = {
  className?: string
  title?: string
  href?: string
  type?: string
  ariaLabel?: string
  dataset?: Record<string, string>
  onclick?: (event: MouseEvent) => void
}

type Child = Node | string | null | undefined | false

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.className) node.className = props.className
  if (props.title) node.title = props.title
  if (props.type) node.setAttribute("type", props.type)
  if (props.ariaLabel) node.setAttribute("aria-label", props.ariaLabel)
  if (props.href && "href" in node) (node as unknown as HTMLAnchorElement).href = props.href
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v
  if (props.onclick) node.addEventListener("click", props.onclick as EventListener)
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

/** Idempotently inject a keyed <style>. Returns the element. */
export function injectStyle(key: string, css: string): HTMLStyleElement {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-rgh="${key}"]`)
  if (existing) return existing
  const style = document.createElement("style")
  style.dataset.rgh = key
  style.textContent = css
  document.head.append(style)
  return style
}

export function removeStyle(key: string): void {
  document.querySelector(`style[data-rgh="${key}"]`)?.remove()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/dom.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/dom.ts tests/github/dom.test.ts
git commit -m "feat(github): safe dom factory and style injection"
```

---

### Task 1.3: `observe` (MutationObserver) + `elementReady`

**Files:**
- Create: `src/lib/github/observe.ts`
- Test: `tests/github/observe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/observe.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import { observe, elementReady } from "../../src/lib/github/observe"

beforeEach(() => { document.body.innerHTML = "" })

describe("observe", () => {
  it("calls back for existing and future matches once each", async () => {
    document.body.append(Object.assign(document.createElement("div"), { className: "t" }))
    const seen: Element[] = []
    const ctrl = new AbortController()
    observe(".t", (node) => seen.push(node), { signal: ctrl.signal })
    await Promise.resolve()
    const later = Object.assign(document.createElement("div"), { className: "t" })
    document.body.append(later)
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.length).toBe(2)
    // Idempotent: a processed node is not re-reported
    document.body.append(document.createElement("span"))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.length).toBe(2)
    ctrl.abort()
  })

  it("stops after abort", async () => {
    const seen: Element[] = []
    const ctrl = new AbortController()
    observe(".t", (n) => seen.push(n), { signal: ctrl.signal })
    ctrl.abort()
    document.body.append(Object.assign(document.createElement("div"), { className: "t" }))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.length).toBe(0)
  })

  it("elementReady resolves when present", async () => {
    setTimeout(() => {
      document.body.append(Object.assign(document.createElement("div"), { id: "late" }))
    }, 5)
    const found = await elementReady("#late", { timeout: 200 })
    expect(found?.id).toBe("late")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/observe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/observe.ts
const PROCESSED = new WeakSet<Element>()

interface ObserveOptions { signal: AbortSignal }

/**
 * Run `cb` for every element matching `selector` that currently exists or
 * appears later, exactly once per element. Stops on signal abort.
 */
export function observe(
  selector: string,
  cb: (element: Element) => void,
  { signal }: ObserveOptions
): void {
  const seen = new WeakSet<Element>()
  const run = (root: ParentNode) => {
    for (const node of root.querySelectorAll(selector)) {
      if (seen.has(node)) continue
      seen.add(node)
      cb(node)
    }
  }
  run(document)
  const mo = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue
        const element = added as Element
        if (element.matches(selector) && !seen.has(element)) {
          seen.add(element)
          cb(element)
        }
        run(element)
      }
    }
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })
  signal.addEventListener("abort", () => mo.disconnect(), { once: true })
}

export { PROCESSED }

export function elementReady(
  selector: string,
  { timeout = 10_000 }: { timeout?: number } = {}
): Promise<Element | null> {
  const existing = document.querySelector(selector)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (found) { mo.disconnect(); resolve(found) }
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(() => { mo.disconnect(); resolve(document.querySelector(selector)) }, timeout)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/observe.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/observe.ts tests/github/observe.test.ts
git commit -m "feat(github): MutationObserver observe + elementReady"
```

---

### Task 1.4: `repo` location parser

**Files:**
- Create: `src/lib/github/repo.ts`
- Test: `tests/github/repo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/repo.test.ts
import { describe, it, expect } from "vitest"
import { parseRepo } from "../../src/lib/github/repo"

describe("parseRepo", () => {
  it("parses owner/name", () => {
    expect(parseRepo(new URL("https://github.com/o/r/pull/1")))
      .toMatchObject({ owner: "o", name: "r", nameWithOwner: "o/r" })
  })
  it("parses branch + filePath from a blob url", () => {
    expect(parseRepo(new URL("https://github.com/o/r/blob/main/src/a.ts")))
      .toMatchObject({ owner: "o", name: "r", branch: "main", filePath: "src/a.ts" })
  })
  it("returns null off-repo", () => {
    expect(parseRepo(new URL("https://github.com/settings"))).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/repo.ts
import { isRepo } from "./page-detect"

export interface RepoInfo {
  owner: string
  name: string
  nameWithOwner: string
  branch?: string
  filePath?: string
}

export function parseRepo(url: URL): RepoInfo | null {
  if (!isRepo(url)) return null
  const p = url.pathname.split("/").filter(Boolean)
  const [owner, name, kind, ref, ...rest] = p
  const info: RepoInfo = { owner, name, nameWithOwner: `${owner}/${name}` }
  if ((kind === "blob" || kind === "tree") && ref) {
    info.branch = ref
    if (rest.length) info.filePath = rest.join("/")
  }
  return info
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/repo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/repo.ts tests/github/repo.test.ts
git commit -m "feat(github): repo location parser"
```

---

## Phase 2 — Token + API client

### Task 2.1: `token` session cache

**Files:**
- Create: `src/lib/github/token.ts`
- Test: `tests/github/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/token.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { getToken, setToken, GH_TOKEN_KEY } from "../../src/lib/github/token"

const store: Record<string, unknown> = {}
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k]
  ;(globalThis as any).chrome = {
    storage: {
      session: {
        get: vi.fn(async (k: string) => ({ [k]: store[k] })),
        set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) })
      }
    }
  }
})

describe("github token", () => {
  it("returns empty string when unset", async () => {
    expect(await getToken()).toBe("")
  })
  it("round-trips through chrome.storage.session", async () => {
    await setToken("ghp_x")
    expect(store[GH_TOKEN_KEY]).toBe("ghp_x")
    expect(await getToken()).toBe("ghp_x")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/token.ts
// GitHub PAT lives only in chrome.storage.session (cleared on browser close,
// never written to disk, never part of persisted Settings).
export const GH_TOKEN_KEY = "github.pat"

let memo: string | null = null

export async function getToken(): Promise<string> {
  if (memo !== null) return memo
  const res = await chrome.storage.session.get(GH_TOKEN_KEY)
  memo = typeof res[GH_TOKEN_KEY] === "string" ? (res[GH_TOKEN_KEY] as string) : ""
  return memo
}

export async function setToken(value: string): Promise<void> {
  memo = value
  await chrome.storage.session.set({ [GH_TOKEN_KEY]: value })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/token.ts tests/github/token.test.ts
git commit -m "feat(github): session-only PAT cache"
```

---

### Task 2.2: `api` client (GitHub-only)

**Files:**
- Create: `src/lib/github/api.ts`
- Test: `tests/github/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/api.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { v3, v4, GitHubApiError } from "../../src/lib/github/api"
import * as token from "../../src/lib/github/token"

beforeEach(() => {
  vi.spyOn(token, "getToken").mockResolvedValue("ghp_test")
})

describe("github api", () => {
  it("v3 calls api.github.com with auth header and parses json", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }))
    ;(globalThis as any).fetch = fetchMock
    const out = await v3("/repos/o/r")
    expect(out).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.github.com/repos/o/r")
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer ghp_test"
    })
  })

  it("v3 throws GitHubApiError on non-2xx", async () => {
    ;(globalThis as any).fetch = vi.fn(async () => new Response("nope", { status: 404 }))
    await expect(v3("/x")).rejects.toBeInstanceOf(GitHubApiError)
  })

  it("v4 posts a graphql query", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { viewer: { login: "me" } } }), { status: 200 }))
    ;(globalThis as any).fetch = fetchMock
    const out = await v4("query{viewer{login}}")
    expect(out).toEqual({ viewer: { login: "me" } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.github.com/graphql")
    expect((init as RequestInit).method).toBe("POST")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/api.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/api.ts
// GitHub-only REST + GraphQL client. No other origins are ever contacted.
import { getToken } from "./token"

const REST = "https://api.github.com"
const GRAPHQL = "https://api.github.com/graphql"

export class GitHubApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`GitHub API ${status}`)
    this.name = "GitHubApiError"
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function v3<T = unknown>(
  path: string,
  init: RequestInit & { responseFormat?: "json" | "text" } = {}
): Promise<T> {
  const { responseFormat = "json", headers, ...rest } = init
  const res = await fetch(`${REST}${path}`, {
    ...rest,
    headers: { ...(await authHeaders()), ...(headers as Record<string, string>) }
  })
  const text = await res.text()
  if (!res.ok) throw new GitHubApiError(res.status, text)
  return (responseFormat === "text" ? text : text ? JSON.parse(text) : undefined) as T
}

export async function v4<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  })
  const text = await res.text()
  if (!res.ok) throw new GitHubApiError(res.status, text)
  const parsed = JSON.parse(text)
  if (parsed.errors) throw new GitHubApiError(res.status, JSON.stringify(parsed.errors))
  return parsed.data as T
}

export async function hasToken(): Promise<boolean> {
  return (await getToken()).length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/api.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/api.ts tests/github/api.test.ts
git commit -m "feat(github): GitHub-only REST+GraphQL api client"
```

---

## Phase 3 — Registry + runtime

### Task 3.1: `FeatureMeta` + `isFeatureOn`

**Files:**
- Create: `src/lib/github/registry.ts`
- Test: `tests/github/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/registry.test.ts
import { describe, it, expect } from "vitest"
import { isFeatureOn, type FeatureMeta } from "../../src/lib/github/registry"

const meta = (id: string, defaultEnabled: boolean): FeatureMeta => ({
  id, name: id, description: "", category: "global", defaultEnabled,
  pageTest: () => true, init: () => {}
})

describe("isFeatureOn", () => {
  const reg = { a: meta("a", true), b: meta("b", false) }
  it("master off ⇒ everything off", () => {
    expect(isFeatureOn("a", { enabled: false, features: {} }, reg)).toBe(false)
  })
  it("falls back to defaultEnabled when no override", () => {
    expect(isFeatureOn("a", { enabled: true, features: {} }, reg)).toBe(true)
    expect(isFeatureOn("b", { enabled: true, features: {} }, reg)).toBe(false)
  })
  it("override wins over default", () => {
    expect(isFeatureOn("b", { enabled: true, features: { b: true } }, reg)).toBe(true)
    expect(isFeatureOn("a", { enabled: true, features: { a: false } }, reg)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (registry shell; features added in Phase 5)**

```ts
// src/lib/github/registry.ts
import type { GitHubFeatureSettings } from "../../types"

export type FeatureCategory =
  | "global" | "repository" | "pull-requests" | "issues" | "profiles" | "write-actions"

export interface FeatureMeta {
  id: string
  name: string
  description: string
  category: FeatureCategory
  defaultEnabled: boolean
  needsToken?: boolean
  isWrite?: boolean
  writeScopes?: string[]
  confirm?: string
  pageTest: (url: URL) => boolean
  init: (signal: AbortSignal) => void | Promise<void>
}

// Populated in Phase 5 as features are ported. Keep alphabetised by id.
export const FEATURES: FeatureMeta[] = []

export function featureMap(list: FeatureMeta[] = FEATURES): Record<string, FeatureMeta> {
  return Object.fromEntries(list.map((f) => [f.id, f]))
}

export function isFeatureOn(
  id: string,
  settings: GitHubFeatureSettings,
  registry: Record<string, FeatureMeta> = featureMap()
): boolean {
  if (!settings.enabled) return false
  return settings.features[id] ?? registry[id]?.defaultEnabled ?? false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/registry.ts tests/github/registry.test.ts
git commit -m "feat(github): feature registry and isFeatureOn"
```

---

### Task 3.2: `runtime` — boot, SPA-nav, live storage updates

**Files:**
- Create: `src/lib/github/runtime.ts`
- Test: `tests/github/runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/runtime.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRuntime } from "../../src/lib/github/runtime"
import type { FeatureMeta } from "../../src/lib/github/registry"

function meta(id: string, over: Partial<FeatureMeta> = {}): FeatureMeta {
  return {
    id, name: id, description: "", category: "global", defaultEnabled: true,
    pageTest: () => true, init: vi.fn(), ...over
  }
}

describe("runtime", () => {
  it("inits only enabled, page-matching features", async () => {
    const a = meta("a")
    const b = meta("b", { pageTest: () => false })
    const c = meta("c", { defaultEnabled: false })
    const rt = createRuntime([a, b, c], () => new URL("https://github.com/o/r"))
    await rt.start({ enabled: true, features: {} })
    expect(a.init).toHaveBeenCalledTimes(1)
    expect(b.init).not.toHaveBeenCalled()
    expect(c.init).not.toHaveBeenCalled()
    rt.stop()
  })

  it("master off inits nothing", async () => {
    const a = meta("a")
    const rt = createRuntime([a], () => new URL("https://github.com/o/r"))
    await rt.start({ enabled: false, features: {} })
    expect(a.init).not.toHaveBeenCalled()
    rt.stop()
  })

  it("re-running with new settings aborts removed features and inits added", async () => {
    const aborted: string[] = []
    const a = meta("a", { defaultEnabled: false, init: (s) => { s.addEventListener("abort", () => aborted.push("a")) } })
    const rt = createRuntime([a], () => new URL("https://github.com/o/r"))
    await rt.start({ enabled: true, features: { a: true } })
    expect(aborted).toEqual([])
    await rt.apply({ enabled: true, features: { a: false } })
    expect(aborted).toEqual(["a"])
    rt.stop()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/runtime.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/runtime.ts
import type { GitHubFeatureSettings } from "../../types"
import { featureMap, isFeatureOn, type FeatureMeta } from "./registry"

export interface Runtime {
  start: (settings: GitHubFeatureSettings) => Promise<void>
  apply: (settings: GitHubFeatureSettings) => Promise<void>
  stop: () => void
}

export function createRuntime(
  features: FeatureMeta[],
  getUrl: () => URL = () => new URL(location.href)
): Runtime {
  const registry = featureMap(features)
  const active = new Map<string, AbortController>()
  let current: GitHubFeatureSettings = { enabled: false, features: {} }

  const desired = (settings: GitHubFeatureSettings): Set<string> => {
    const url = getUrl()
    const out = new Set<string>()
    for (const feature of features) {
      if (isFeatureOn(feature.id, settings, registry) && feature.pageTest(url)) out.add(feature.id)
    }
    return out
  }

  const reconcile = async (settings: GitHubFeatureSettings) => {
    current = settings
    const want = desired(settings)
    for (const [id, ctrl] of active) {
      if (!want.has(id)) { ctrl.abort(); active.delete(id) }
    }
    for (const id of want) {
      if (active.has(id)) continue
      const ctrl = new AbortController()
      active.set(id, ctrl)
      try { await registry[id].init(ctrl.signal) } catch (e) { console.debug("[gh]", id, e) }
    }
  }

  const onNav = () => { void reconcile(current) }

  return {
    start: async (settings) => {
      window.addEventListener("popstate", onNav)
      // GitHub uses pushState for SPA nav; patch to emit an event we listen to.
      patchHistory()
      window.addEventListener("rgh:navigate", onNav)
      await reconcile(settings)
    },
    apply: (settings) => reconcile(settings),
    stop: () => {
      window.removeEventListener("popstate", onNav)
      window.removeEventListener("rgh:navigate", onNav)
      for (const [, ctrl] of active) ctrl.abort()
      active.clear()
    }
  }
}

let patched = false
function patchHistory(): void {
  if (patched) return
  patched = true
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method]
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args)
      window.dispatchEvent(new Event("rgh:navigate"))
      return result
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/github/runtime.ts tests/github/runtime.test.ts
git commit -m "feat(github): runtime reconcile with SPA-nav + live updates"
```

---

### Task 3.3: content script entry

**Files:**
- Create: `src/contents/github.ts`
- Manual verification only (Plasmo content scripts aren't unit-tested here).

- [ ] **Step 1: Implement**

```ts
// src/contents/github.ts
import type { PlasmoCSConfig } from "plasmo"
import type { GitHubFeatureSettings } from "../types"
import { FEATURES } from "../lib/github/registry"
import { createRuntime } from "../lib/github/runtime"

export const config: PlasmoCSConfig = {
  matches: ["https://github.com/*"],
  run_at: "document_idle",
  all_frames: false
}

const SETTINGS_KEY = "ai-dev-settings"
const DEFAULT_GH: GitHubFeatureSettings = { enabled: true, features: {} }

async function readGitHubSettings(): Promise<GitHubFeatureSettings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY)
  const settings = (res[SETTINGS_KEY] || {}) as { github?: GitHubFeatureSettings }
  return settings.github ?? DEFAULT_GH
}

async function main(): Promise<void> {
  const runtime = createRuntime(FEATURES)
  await runtime.start(await readGitHubSettings())
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return
    const next = (changes[SETTINGS_KEY].newValue || {}) as { github?: GitHubFeatureSettings }
    void runtime.apply(next.github ?? DEFAULT_GH)
  })
}

void main()
```

- [ ] **Step 2: Live verification**

Run: `pnpm dev`, load the unpacked build in Brave, open any `github.com` page.
Expected: no console errors from the content script; `chrome.storage.local` key `ai-dev-settings.github` is read. (Features are added in Phase 5; nothing visible yet is fine.)

- [ ] **Step 3: Commit**

```bash
git add src/contents/github.ts
git commit -m "feat(github): content script entry boots runtime"
```

---

## Phase 4 — Sidebar section + token UI

### Task 4.1: register the `github` section id

**Files:**
- Modify: `src/sections/types.ts` (`SectionId` union ~line 1, `SECTIONS` ~line 28)
- Modify: `src/components/SidebarRail.tsx` (`ICONS` map ~line 19)
- Test: `tests/github/section-registration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/section-registration.test.ts
import { describe, it, expect } from "vitest"
import { SECTIONS } from "../../src/sections/types"

describe("github section registration", () => {
  it("includes a github section", () => {
    expect(SECTIONS.some((s) => s.id === "github")).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/section-registration.test.ts`
Expected: FAIL — no `github` section.

- [ ] **Step 3: Implement**

In `src/sections/types.ts`: add `| "github"` to the `SectionId` union, and add to `SECTIONS` (place before `settings`):

```ts
  { id: "github", label: "GitHub" },
```

In `src/components/SidebarRail.tsx` `ICONS` map add:

```ts
  github: "social-github",
```

(If `"social-github"` is not a valid `LeoIconName`, use `"code"` — verify against the `LeoIconName` type at edit time.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/section-registration.test.ts`
Expected: PASS. Also run `pnpm typecheck` and resolve any `Record<SectionId, …>` exhaustiveness errors the new id introduces.

- [ ] **Step 5: Commit**

```bash
git add src/sections/types.ts src/components/SidebarRail.tsx tests/github/section-registration.test.ts
git commit -m "feat(github): register GitHub sidebar section id"
```

---

### Task 4.2: token UI helper (Doppler → session cache)

**Files:**
- Create: `src/sections/github/github-token-ui.ts`
- Test: `tests/github/github-token-ui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/github-token-ui.test.ts
import { describe, it, expect } from "vitest"
import { GH_TOKEN_SECRET_NAMES, pickGitHubToken } from "../../src/sections/github/github-token-ui"

describe("pickGitHubToken", () => {
  it("prefers GITHUB_PAT then falls back through candidates", () => {
    expect(pickGitHubToken({ GH_TOKEN: "b", GITHUB_PAT: "a" })).toBe("a")
    expect(pickGitHubToken({ GH_TOKEN: "b" })).toBe("b")
    expect(pickGitHubToken({})).toBe("")
  })
  it("exposes the candidate list for the Doppler request", () => {
    expect(GH_TOKEN_SECRET_NAMES[0]).toBe("GITHUB_PAT")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/github-token-ui.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/sections/github/github-token-ui.ts
// Mirrors pickSecretValue / secret-name-candidates pattern from SettingsSection.
export const GH_TOKEN_SECRET_NAMES = ["GITHUB_PAT", "GITHUB_TOKEN", "GH_TOKEN", "GH_PAT"]

export function pickGitHubToken(secrets: Record<string, string>): string {
  const normalized = Object.entries(secrets).reduce<Record<string, string>>(
    (acc, [k, v]) => { acc[k.trim().toUpperCase()] = v; return acc },
    {}
  )
  for (const name of GH_TOKEN_SECRET_NAMES) {
    const hit = normalized[name]
    if (typeof hit === "string" && hit.trim()) return hit.trim()
  }
  return ""
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/github-token-ui.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sections/github/github-token-ui.ts tests/github/github-token-ui.test.ts
git commit -m "feat(github): GitHub PAT secret-name resolution helper"
```

---

### Task 4.3: `GitHubSection` component

**Files:**
- Create: `src/sections/github/GitHubSection.tsx`
- Modify: `src/sidepanel.tsx` (import ~line 20, render block ~line 90)

- [ ] **Step 1: Implement the component**

```tsx
// src/sections/github/GitHubSection.tsx
import { useMemo } from "react"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { setToken } from "../../lib/github/token"
import { FEATURES, type FeatureCategory, type FeatureMeta } from "../../lib/github/registry"
import { GH_TOKEN_SECRET_NAMES, pickGitHubToken } from "./github-token-ui"

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  global: "Global",
  repository: "Repository",
  "pull-requests": "Pull Requests",
  issues: "Issues",
  profiles: "Profiles",
  "write-actions": "Write actions"
}
const CATEGORY_ORDER: FeatureCategory[] = [
  "global", "repository", "pull-requests", "issues", "profiles", "write-actions"
]

export function GitHubSection() {
  const { settings, update } = useSettings()
  const nativeHost = useNativeHost()
  const grouped = useMemo(() => {
    const map = new Map<FeatureCategory, FeatureMeta[]>()
    for (const f of FEATURES) {
      const list = map.get(f.category) ?? []
      list.push(f)
      map.set(f.category, list)
    }
    return map
  }, [])

  if (!settings) return null
  const gh = settings.github

  const isOn = (f: FeatureMeta) => gh.features[f.id] ?? f.defaultEnabled
  const toggleFeature = (id: string, value: boolean) =>
    update({ github: { ...gh, features: { ...gh.features, [id]: value } } })
  const toggleMaster = (value: boolean) =>
    update({ github: { ...gh, enabled: value } })

  const loadToken = () =>
    nativeHost.dopplerSecretsDownload({ secrets: GH_TOKEN_SECRET_NAMES })

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">GitHub Refinements</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gh.enabled}
            onChange={(e) => toggleMaster(e.target.checked)}
          />
          <span>Enabled</span>
        </label>
      </header>

      <section className="rounded border border-border p-3">
        <div className="flex items-center justify-between">
          <span>GitHub token (Doppler)</span>
          <button className="rounded bg-muted px-2 py-1" onClick={loadToken}>
            Load from Doppler
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-fg">
          Resolved from {GH_TOKEN_SECRET_NAMES.join(", ")}. Required for API and
          write features. Write actions need <code>repo</code> (and{" "}
          <code>delete_repo</code> for repository deletion) scopes.
        </p>
      </section>

      <div className={gh.enabled ? "" : "pointer-events-none opacity-50"}>
        {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
          <section key={category} className="mb-4">
            <h3
              className={
                "mb-2 text-xs font-semibold uppercase tracking-wide " +
                (category === "write-actions" ? "text-amber-500" : "text-muted-fg")
              }
            >
              {CATEGORY_LABELS[category]}
              {category === "write-actions" && " — these modify GitHub"}
            </h3>
            <ul className="flex flex-col gap-2">
              {grouped.get(category)!.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
                      {f.needsToken && (
                        <span className="rounded bg-blue-500/20 px-1 text-[10px] text-blue-400">
                          API
                        </span>
                      )}
                      {f.isWrite && (
                        <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-500">
                          WRITE{f.writeScopes ? ` · ${f.writeScopes.join(" ")}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-fg">{f.description}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={isOn(f)}
                    onChange={(e) => toggleFeature(f.id, e.target.checked)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
```

Wire the Doppler response to `setToken`: in `GitHubSection`, the `useNativeHost`
message handler for `doppler.secrets.download` should call
`void setToken(pickGitHubToken(msg.secrets || {}))`. Follow the existing
`useNativeHost({ onMessage })` pattern used in `SettingsSection.tsx` (the hook
accepts an `onMessage`-style callback — match its current signature at edit
time). If `useNativeHost` here cannot subscribe independently, add a thin
`onMessage` filter for `type === "doppler.secrets.download"` and resolve the
token from `msg.secrets`.

- [ ] **Step 2: Render it in the side panel**

In `src/sidepanel.tsx` add the import near the other section imports:

```ts
import { GitHubSection } from "./sections/github/GitHubSection";
```

And in the render block (alongside `{active === "settings" && <SettingsSection />}`):

```tsx
          {active === "github" && <GitHubSection />}
```

- [ ] **Step 3: Typecheck + live verification**

Run: `pnpm typecheck`
Expected: passes.
Run: `pnpm dev`, open the side panel, click the **GitHub** rail icon.
Expected: the section renders with the master switch, token row, and (after Phase 5) category groups. Toggling persists to `ai-dev-settings.github` (check `chrome.storage.local`).

- [ ] **Step 4: Commit**

```bash
git add src/sections/github/GitHubSection.tsx src/sidepanel.tsx
git commit -m "feat(github): GitHub sidebar section with master switch and toggles"
```

---

## Phase 5 — Feature ports

Each feature is one file in `src/lib/github/features/`, `export default` a
`FeatureMeta`, and is appended to `FEATURES` in `registry.ts` (keep
alphabetised). Each task has a unit test against fixture DOM **and** a live
verification step (selectors must be confirmed against current GitHub).

**Porting protocol for every feature task:**
1. Read the RGH source at `/tmp/refined-github/source/features/<id>.tsx` (and any
   `.css`) for intent and selectors.
2. Replace RGH deps: `dom-chef`→`el`/`injectStyle`; `selector-observer`→`observe`;
   `select-dom`→`querySelector`; `github-url-detection`→`page-detect`;
   `api`→`./api`; `getRepo`→`parseRepo`; octicons→inline SVG via `el`.
3. Drop any attribution/welcome/sponsor/easter-egg code paths.
4. Use `el()` only — never `innerHTML`. Guard every DOM write with a presence
   check so a missing selector is a silent no-op.
5. For `[API]`/`isWrite`, early-return when `await hasToken()` is false.
6. For `confirm`, call `window.confirm(meta.confirm)` and bail if false.

### Task 5.1 (template, fully worked): `sticky-file-headers` (CSS-only)

**Files:**
- Create: `src/lib/github/features/sticky-file-headers.ts`
- Modify: `src/lib/github/registry.ts` (append to `FEATURES`)
- Test: `tests/github/features/sticky-file-headers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/features/sticky-file-headers.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/sticky-file-headers"

beforeEach(() => { document.head.innerHTML = "" })

describe("sticky-file-headers", () => {
  it("metadata", () => {
    expect(feature.id).toBe("sticky-file-headers")
    expect(feature.category).toBe("repository")
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
  })
  it("init injects a keyed style, abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="sticky-file-headers"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="sticky-file-headers"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/features/sticky-file-headers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/features/sticky-file-headers.ts
import { injectStyle, removeStyle } from "../dom"
import { isPRFiles, isCommit, isSingleFile } from "../page-detect"
import type { FeatureMeta } from "../registry"

const KEY = "sticky-file-headers"
const CSS = `
.file-header { position: sticky; top: 0; z-index: 1; }
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Sticky file headers",
  description: "Keep each file's header pinned while scrolling diffs.",
  category: "repository",
  defaultEnabled: true,
  pageTest: (url) => isPRFiles(url) || isCommit(url) || isSingleFile(url),
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
```

Append to `FEATURES` in `registry.ts`:

```ts
import stickyFileHeaders from "./features/sticky-file-headers"
// ...
export const FEATURES: FeatureMeta[] = [stickyFileHeaders]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/features/sticky-file-headers.test.ts`
Expected: PASS

- [ ] **Step 5: Live verification**

`pnpm dev` → open a PR's **Files changed** tab. Confirm headers stick on scroll
and the **GitHub** section lists the feature. Adjust the `.file-header`
selector/`top` value if GitHub's current markup differs.

- [ ] **Step 6: Commit**

```bash
git add src/lib/github/features/sticky-file-headers.ts src/lib/github/registry.ts tests/github/features/sticky-file-headers.test.ts
git commit -m "feat(github): sticky-file-headers feature"
```

### Task 5.2 (template, fully worked): `copy-file-path` (DOM)

**Files:**
- Create: `src/lib/github/features/copy-file-path.ts`
- Modify: `src/lib/github/registry.ts`
- Test: `tests/github/features/copy-file-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/features/copy-file-path.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import feature from "../../../src/lib/github/features/copy-file-path"
import * as repo from "../../../src/lib/github/repo"

beforeEach(() => { document.body.innerHTML = "" })

describe("copy-file-path", () => {
  it("adds a copy button next to a file actions container", async () => {
    vi.spyOn(repo, "parseRepo").mockReturnValue({
      owner: "o", name: "r", nameWithOwner: "o/r", branch: "main", filePath: "src/a.ts"
    })
    document.body.append(
      Object.assign(document.createElement("div"), { className: "file-actions" })
    )
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))
    const btn = document.querySelector<HTMLButtonElement>(".rgh-copy-file-path")
    expect(btn).not.toBeNull()
    const writeText = vi.fn()
    ;(navigator as any).clipboard = { writeText }
    btn!.click()
    expect(writeText).toHaveBeenCalledWith("src/a.ts")
    ctrl.abort()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/features/copy-file-path.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/features/copy-file-path.ts
import { el } from "../dom"
import { observe } from "../observe"
import { isSingleFile } from "../page-detect"
import { parseRepo } from "../repo"
import type { FeatureMeta } from "../registry"

const KEY = "copy-file-path"

const feature: FeatureMeta = {
  id: KEY,
  name: "Copy file path",
  description: "Button to copy the current file's repo-relative path.",
  category: "repository",
  defaultEnabled: true,
  pageTest: (url) => isSingleFile(url),
  init: (signal) => {
    observe(".file-actions", (container) => {
      if (container.querySelector(`.${"rgh-copy-file-path"}`)) return
      const info = parseRepo(new URL(location.href))
      if (!info?.filePath) return
      const button = el("button", {
        className: "btn btn-sm rgh-copy-file-path",
        type: "button",
        title: "Copy file path",
        onclick: () => void navigator.clipboard.writeText(info.filePath!)
      }, "Copy path")
      container.prepend(button)
    }, { signal })
  }
}

export default feature
```

Append `copyFilePath` to `FEATURES` (alphabetical) in `registry.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/features/copy-file-path.test.ts`
Expected: PASS

- [ ] **Step 5: Live verification**

`pnpm dev` → open a file (`/blob/...`). Confirm the **Copy path** button appears
in the file actions and copies the path. Update `.file-actions` if GitHub's
current markup differs.

- [ ] **Step 6: Commit**

```bash
git add src/lib/github/features/copy-file-path.ts src/lib/github/registry.ts tests/github/features/copy-file-path.test.ts
git commit -m "feat(github): copy-file-path feature"
```

### Task 5.3 (template, fully worked): `quick-repo-deletion` (write, confirm, no PAT)

**Files:**
- Create: `src/lib/github/features/quick-repo-deletion.ts`
- Modify: `src/lib/github/registry.ts`
- Test: `tests/github/features/quick-repo-deletion.test.ts`

This ports RGH's flow: on a repo page, add a "Delete repository" button that,
after `confirm()`, navigates to the Danger Zone and auto-fills the confirmation
field — leaving the final native delete click to the user (never deletes
silently). The RGH source uses `api.v3 DELETE`; we deliberately use the
**form-driven** path so no `delete_repo` PAT is required and the user always
performs the last action.

- [ ] **Step 1: Write the failing test**

```ts
// tests/github/features/quick-repo-deletion.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import feature from "../../../src/lib/github/features/quick-repo-deletion"

beforeEach(() => { document.body.innerHTML = "" })

describe("quick-repo-deletion", () => {
  it("is a write feature, off by default, with a confirm prompt", () => {
    expect(feature.isWrite).toBe(true)
    expect(feature.defaultEnabled).toBe(false)
    expect(typeof feature.confirm).toBe("string")
    expect(feature.category).toBe("write-actions")
  })
  it("auto-fills the danger-zone confirmation field when present", async () => {
    const input = Object.assign(document.createElement("input"), {
      className: "js-repo-delete-proceed-confirmation"
    })
    document.body.append(input)
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))
    // The feature pre-fills the owner/name when the field appears.
    expect(input.value.length).toBeGreaterThan(0)
    ctrl.abort()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/github/features/quick-repo-deletion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/github/features/quick-repo-deletion.ts
import { observe } from "../observe"
import { isRepo } from "../page-detect"
import { parseRepo } from "../repo"
import type { FeatureMeta } from "../registry"

const KEY = "quick-repo-deletion"

const feature: FeatureMeta = {
  id: KEY,
  name: "Quick repo deletion",
  description:
    "Adds a delete shortcut that routes to the Danger Zone and pre-fills the " +
    "confirmation. You still click the final native Delete button.",
  category: "write-actions",
  defaultEnabled: false,
  isWrite: true,
  writeScopes: ["delete_repo"],
  confirm: "Open the Danger Zone to delete this repository? You will still confirm the final deletion yourself.",
  pageTest: (url) => isRepo(url),
  init: (signal) => {
    // When on the settings page, pre-fill the confirmation field GitHub shows.
    observe(".js-repo-delete-proceed-confirmation", (node) => {
      const info = parseRepo(new URL(location.href))
      if (!info) return
      const field = node as HTMLInputElement
      if (!field.value) {
        field.value = info.nameWithOwner
        field.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }, { signal })
    // The trigger button is added in a live step (selector verification needed);
    // unit scope here is the auto-fill behavior above.
  }
}

export default feature
```

Append `quickRepoDeletion` to `FEATURES` (alphabetical) in `registry.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/github/features/quick-repo-deletion.test.ts`
Expected: PASS

- [ ] **Step 5: Live verification (use a throwaway repo)**

`pnpm dev` → enable the feature in the GitHub section → open a **test** repo's
Settings → Danger Zone delete dialog. Confirm the confirmation field is
pre-filled and that the final delete still requires your click. Add the
trigger-button affordance against the current repo-header markup; if the
Danger-Zone selector differs, update `.js-repo-delete-proceed-confirmation`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/github/features/quick-repo-deletion.ts src/lib/github/registry.ts tests/github/features/quick-repo-deletion.test.ts
git commit -m "feat(github): quick-repo-deletion (confirm-gated, form-driven)"
```

### Tasks 5.4 – 5.N: remaining features

For each feature below, follow the **Porting protocol** and the same 6-step
structure as 5.1–5.3 (failing test → fail → implement → pass → live-verify →
commit). The table gives the per-feature metadata and the RGH source to port
from. `T` = needs token; `W` = write (off by default, requires `confirm` for
destructive ones). Default-on for non-write read features unless noted.

| id | category | flags | RGH source | porting notes |
|---|---|---|---|---|
| `clean-sidebar` | global | — | `features/clean-sidebar.tsx`(+css) | CSS-only: hide dashboard/repo promo widgets. `injectStyle`. |
| `hide-newsfeed-noise` | global | — | `features/hide-newsfeed-noise.tsx` | CSS-only feed declutter on dashboard. `pageTest: isDashboard`. |
| `useful-not-found-page` | global | — | `features/useful-not-found-page.tsx` | On 404 body, add path-walk + search links via `el`. Detect 404 via `document.title`/`[data-error]` marker. |
| `selectable-comment-quotes` | global | — | `features/selectable-comment-quotes.tsx` | CSS `user-select` fix on quotes. |
| `expand-all-files` | repository | — | `features/expand-all-diffs.tsx` | Button to expand/collapse all diff entries (`<details>` toggling). |
| `copy-raw-file` | repository | — | `features/copy-file-on-blob.tsx` | Fetch raw via `v3 contents` (`responseFormat:"text"`, raw accept header) or read DOM; copy to clipboard. `T` if API path used. |
| `default-branch-button` | repository | T | `features/default-branch-name.tsx` | `v3 /repos/{o}/{r}` → default_branch; show "back to default" link when off-branch. |
| `collapse-all-diff-files` | pull-requests | — | `features/collapse-all-diffs.tsx` | Toggle on Files tab; `pageTest: isPRFiles`. |
| `show-whitespace-toggle` | pull-requests | — | `features/show-whitespace-button.tsx` | Toggle `?w=1` on the diff URL; no API. `pageTest: isPRFiles`. |
| `pr-ci-status-summary` | pull-requests | T | `features/pr-commit-lines-changed.tsx` (pattern) | `v3` checks/status for head sha; compact summary near title. |
| `conversation-links` | pull-requests | — | `features/comment-fields-keyboard-shortcuts.tsx` (pattern) | Linkify plain issue/PR/commit refs in titles via `el` (regex → anchors). No `innerHTML`. |
| `sticky-pr-tabs` | pull-requests | — | `features/sticky-conversation-list-toolbar.css` (pattern) | CSS sticky on the PR tab bar. |
| `comment-fields-keyboard-shortcuts` | issues | — | `features/comment-fields-keyboard-shortcuts.tsx` | Cmd/Ctrl+Enter submit + editor shortcuts via keydown delegation. |
| `clean-issue-labels` | issues | — | `features/clean-issue-labels.css` | CSS readability tweak. |
| `linked-issue-references` | issues | T | `features/linkify-code.tsx` (pattern) | `v4` GraphQL for linked PRs/refs; render inline. |
| `profile-repo-search` | profiles | — | `features/profile-repo-search.tsx` | Add a filter box over pinned/repos list; client-side filter. |
| `clean-profile` | profiles | — | `features/clean-profile.css` | CSS hide low-value widgets. |
| `restore-file` | write-actions | T,W | `features/restore-file.tsx` | `v3 contents` read merge-base + write commit; `confirm` before discard. scopes `["repo"]`. defaultEnabled false. |
| `quick-label-removal` | write-actions | T,W | `features/quick-label-removal.tsx` | `v4` removeLabels mutation on click; scopes `["repo"]`. defaultEnabled false. |
| `quick-review` | write-actions | W | `features/quick-review.tsx` | POST to github.com review form endpoint (session/CSRF, no PAT); `confirm` unless alt-held. defaultEnabled false. |
| `new-repo-disable-projects-and-wikis` | write-actions | T,W | `features/new-repo-disable-projects-and-wikis.tsx` | On `/new`, after creation `v3 PATCH /repos/{o}/{r}` `{has_projects:false,has_wiki:false}`; scopes `["repo"]`. `pageTest: isNewRepo`. defaultEnabled false. |
| `sync-pr-commit-title` | write-actions | W | `features/sync-pr-commit-title.tsx` | Drive the merge-title field via the page form (no PAT). defaultEnabled false. |
| `update-pr-from-base-branch` | write-actions | T,W | `features/update-pr-from-base-branch.gql` + tsx | `v4` mergeBranch/updatePullRequestBranch mutation; `confirm`; scopes `["repo"]`. defaultEnabled false. |

For each: write a metadata test (id/category/flags/`pageTest`) plus at least one
behavior test against fixture DOM (mock `parseRepo`, `v3`/`v4`, and
`navigator.clipboard` as in 5.2). Write features additionally assert
`defaultEnabled === false` and (where destructive) a non-empty `confirm`.

---

## Phase 6 — Integration verification

### Task 6.1: full suite + typecheck + manual matrix

- [ ] **Step 1:** Run the whole GitHub unit suite.

Run: `pnpm vitest run tests/github`
Expected: all pass.

- [ ] **Step 2:** Typecheck.

Run: `pnpm typecheck`
Expected: no errors (especially `Record<SectionId, …>` exhaustiveness in `SidebarRail`).

- [ ] **Step 3:** Manual matrix in `pnpm dev`:
  - Master switch off ⇒ no features run on any GitHub page.
  - A read feature toggled off live ⇒ disappears without reload (storage-change path).
  - SPA nav (click between Conversation/Files tabs) ⇒ page-specific features attach/detach.
  - Token absent ⇒ `T` features no-op, `API`/`WRITE` badges show in the section.
  - "Load from Doppler" ⇒ token cached in `chrome.storage.session` (not in `ai-dev-settings`).
  - One `W` feature on a throwaway repo ⇒ `confirm()` appears; final destructive click is the user's.

- [ ] **Step 4:** Commit any selector fixes made during verification.

```bash
git add -A
git commit -m "fix(github): selector adjustments from live verification"
```

### Task 6.2: docs touch-up

**Files:**
- Modify: `README.md` (Extension Functionality list)

- [ ] **Step 1:** Add a bullet describing the GitHub section (master switch +
  per-feature toggles, Doppler PAT for API/write features, no remote code).
  Do **not** add attribution/license text.

- [ ] **Step 2:** Commit.

```bash
git add README.md
git commit -m "docs: describe GitHub refinements section"
```

---

## Notes for the implementer

- **No new dependencies.** Everything uses platform APIs (`MutationObserver`,
  `fetch`, `navigator.clipboard`, `chrome.storage`).
- **Security invariants (must hold in every feature):** no `innerHTML`/
  `insertAdjacentHTML`/`eval`; only `github.com`/`api.github.com` are contacted;
  the PAT lives only in `chrome.storage.session`; write features are
  `defaultEnabled: false` and destructive ones are `confirm`-gated.
- **Idempotency:** every `init` must tolerate being called again after a prior
  `abort` on the same page (guard injected nodes with a class/`data-rgh` check).
- **Cleanup:** `/tmp/refined-github` is a reference clone, not vendored — nothing
  from it is committed.
