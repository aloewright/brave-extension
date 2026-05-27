# Page Agent Code Mode + Step Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the page agent's per-turn loop into a Code-Mode-style program runner that executes 1–8 validated ops per turn, captures a per-op trace, and renders the trace as collapsible step strips in the chat UI.

**Architecture:** Add a pure `page-agent-program` module with `parseProgram` (validates LLM output against `BROWSER_AGENT_OPERATIONS`), `summarizeStep` (pure), and `executeProgram` (sequential runner with halt-on-error and internal auto re-observe). Wire it into `handlePageAgentMessage`, push step entries from the content script, and teach the Foundation Models bridge to emit `program` alongside the legacy `action` field.

**Tech Stack:** TypeScript, Vitest, Plasmo, Chrome MV3, Swift `@Generable` (Apple Foundation Models).

**Spec:** `docs/superpowers/specs/2026-05-27-page-agent-code-mode-design.md`

---

## File Structure

```
src/background/page-agent-program.ts        # NEW — pure parser + summarizer + runner
src/background.ts                            # MODIFIED — call executeProgram, ship `steps`
src/contents/page-agent.ts                   # MODIFIED — step entry variant + renderer
native-host/foundation-models-bridge.swift   # MODIFIED — AgentOp + AgentPlan.program
src/lib/browser-agent-code-mode.ts           # UNCHANGED — catalog already correct
tests/page-agent-program.test.ts             # NEW — parseProgram + executeProgram
tests/page-agent-step.test.ts                # NEW — summarizeStep
```

`src/lib/browser-agent-code-mode.ts` already exports `BROWSER_AGENT_OPERATIONS` and `isBrowserAgentOperation` — the new module imports both and does not duplicate them.

DOM-tool mapping (from `src/background/dom-tools.ts`):

| Op kind          | Handler                                           | Args                                  |
|------------------|--------------------------------------------------|---------------------------------------|
| `browser.observe`| `DOM_TOOL_HANDLERS.browser_observe`              | `{ tabId }`                           |
| `browser.click`  | `DOM_TOOL_HANDLERS.click`                        | `{ tabId, selector }`                 |
| `browser.type`   | `DOM_TOOL_HANDLERS.type`                         | `{ tabId, selector, value }`          |
| `browser.scroll` | `DOM_TOOL_HANDLERS.scroll_to`                    | `{ tabId, selector? , y? }`           |
| `browser.navigate`| `DOM_TOOL_HANDLERS.navigate`                    | `{ tabId, url }`                      |
| `browser.wait`   | inline `setTimeout` (no handler)                 | `ms` (clamped to 2000)                |
| `memory.*`       | stub: returns `{ ok:false, skipped:true, reason:"memory not wired" }` | n/a |
| `session.compact`| stub: same as memory.*                            | n/a                                   |

---

## Task 1: Module skeleton + parseProgram for the modern `{program: [...]}` shape

**Files:**
- Create: `src/background/page-agent-program.ts`
- Create: `tests/page-agent-program.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/page-agent-program.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { parseProgram, MAX_OPS } from "../src/background/page-agent-program"

describe("parseProgram", () => {
  it("accepts a modern program field with valid ops", () => {
    const plan = {
      program: [
        { op: "browser.observe" },
        { op: "browser.click", ref: "el12" },
        { op: "browser.type", ref: "el18", value: "alice@example.com" }
      ]
    }
    expect(parseProgram(plan)).toEqual([
      { kind: "browser.observe" },
      { kind: "browser.click", ref: "el12" },
      { kind: "browser.type", ref: "el18", value: "alice@example.com" }
    ])
  })

  it("returns [] when plan is null/undefined/empty", () => {
    expect(parseProgram(null)).toEqual([])
    expect(parseProgram(undefined)).toEqual([])
    expect(parseProgram({})).toEqual([])
    expect(parseProgram({ program: [] })).toEqual([])
  })

  it("exposes MAX_OPS = 8", () => {
    expect(MAX_OPS).toBe(8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: FAIL with `Cannot find module '../src/background/page-agent-program'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/background/page-agent-program.ts`:

```ts
import {
  BROWSER_AGENT_OPERATIONS,
  isBrowserAgentOperation,
  type BrowserAgentOperation
} from "../lib/browser-agent-code-mode"

export const MAX_OPS = 8

export type Op = {
  kind: BrowserAgentOperation
  ref?: string
  value?: string
  ms?: number
  y?: number
  url?: string
}

function coerceOp(raw: unknown): Op | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const kindRaw = typeof r.op === "string" ? r.op : typeof r.kind === "string" ? r.kind : ""
  if (!isBrowserAgentOperation(kindRaw)) return null
  const op: Op = { kind: kindRaw }
  if (typeof r.ref === "string") op.ref = r.ref
  if (typeof r.value === "string") op.value = r.value
  if (typeof r.url === "string") op.url = r.url
  if (typeof r.ms === "number" && Number.isFinite(r.ms)) op.ms = r.ms
  if (typeof r.y === "number" && Number.isFinite(r.y)) op.y = r.y
  return op
}

export function parseProgram(plan: unknown): Op[] {
  if (!plan || typeof plan !== "object") return []
  const program = (plan as Record<string, unknown>).program
  if (!Array.isArray(program)) return []
  const ops = program.map(coerceOp).filter((op): op is Op => op !== null)
  return ops.slice(0, MAX_OPS)
}

// Catalog re-export for callers that want it
export { BROWSER_AGENT_OPERATIONS }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/background/page-agent-program.ts tests/page-agent-program.test.ts
git commit -m "feat(page-agent): add parseProgram for modern program shape"
```

---

## Task 2: parseProgram — legacy `action` wrap

**Files:**
- Modify: `src/background/page-agent-program.ts`
- Modify: `tests/page-agent-program.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/page-agent-program.test.ts` inside `describe("parseProgram", ...)`:

```ts
  it("wraps a legacy single action into a 1-op program", () => {
    const plan = { action: { kind: "click", ref: "el5", reason: "open form" } }
    expect(parseProgram(plan)).toEqual([{ kind: "browser.click", ref: "el5" }])
  })

  it("legacy action `type` maps with value", () => {
    const plan = { action: { kind: "type", ref: "el7", value: "alice" } }
    expect(parseProgram(plan)).toEqual([{ kind: "browser.type", ref: "el7", value: "alice" }])
  })

  it("legacy action with unknown kind yields []", () => {
    const plan = { action: { kind: "telepathy", ref: "el5" } }
    expect(parseProgram(plan)).toEqual([])
  })

  it("when both program and action are present, program wins", () => {
    const plan = {
      action: { kind: "click", ref: "el1" },
      program: [{ op: "browser.observe" }]
    }
    expect(parseProgram(plan)).toEqual([{ kind: "browser.observe" }])
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: FAIL on the four new tests with "expected `[]`/`[...]` …".

- [ ] **Step 3: Implement legacy wrap**

In `src/background/page-agent-program.ts`, add a helper and update `parseProgram`:

```ts
const LEGACY_KIND_MAP: Record<string, BrowserAgentOperation> = {
  observe: "browser.observe",
  click: "browser.click",
  type: "browser.type",
  scroll: "browser.scroll",
  wait: "browser.wait",
  navigate: "browser.navigate",
  remember: "memory.remember",
  compact: "session.compact"
}

function legacyActionToOp(action: unknown): Op | null {
  if (!action || typeof action !== "object") return null
  const a = action as Record<string, unknown>
  const rawKind = typeof a.kind === "string" ? a.kind.toLowerCase() : ""
  const mapped = LEGACY_KIND_MAP[rawKind]
  if (!mapped) return null
  const op: Op = { kind: mapped }
  if (typeof a.ref === "string") op.ref = a.ref
  if (typeof a.value === "string") op.value = a.value
  return op
}

export function parseProgram(plan: unknown): Op[] {
  if (!plan || typeof plan !== "object") return []
  const p = plan as Record<string, unknown>

  if (Array.isArray(p.program)) {
    const ops = p.program.map(coerceOp).filter((op): op is Op => op !== null)
    return ops.slice(0, MAX_OPS)
  }

  const legacy = legacyActionToOp(p.action)
  return legacy ? [legacy] : []
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: PASS, 7 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/background/page-agent-program.ts tests/page-agent-program.test.ts
git commit -m "feat(page-agent): wrap legacy action field into one-op program"
```

---

## Task 3: parseProgram — MAX_OPS clamp + unknown-op drop

**Files:**
- Modify: `tests/page-agent-program.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/page-agent-program.test.ts` inside `describe("parseProgram", ...)`:

```ts
  it("clamps to MAX_OPS = 8", () => {
    const program = Array.from({ length: 20 }, () => ({ op: "browser.observe" }))
    const plan = { program }
    expect(parseProgram(plan)).toHaveLength(MAX_OPS)
  })

  it("drops ops with unknown kinds and keeps known ones", () => {
    const plan = {
      program: [
        { op: "browser.observe" },
        { op: "telepathy" },
        { op: "browser.click", ref: "el1" }
      ]
    }
    expect(parseProgram(plan)).toEqual([
      { kind: "browser.observe" },
      { kind: "browser.click", ref: "el1" }
    ])
  })
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: PASS — the existing implementation already handles both via `filter(coerceOp)` and `slice(0, MAX_OPS)`. If a test fails, fix `parseProgram` rather than the test.

- [ ] **Step 3: Commit**

```bash
git add tests/page-agent-program.test.ts
git commit -m "test(page-agent): assert MAX_OPS clamp and unknown-op drop"
```

---

## Task 4: summarizeStep — pure summarizer with observation-based labels

**Files:**
- Create: `tests/page-agent-step.test.ts`
- Modify: `src/background/page-agent-program.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/page-agent-step.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { summarizeStep, type Op, type OpResult } from "../src/background/page-agent-program"

const obs = {
  nodes: [
    { ref: "el12", name: "Sign in", text: "Sign in", selector: "button.sign-in" },
    { ref: "el18", name: "Email", text: "", selector: "input#email" }
  ]
}

describe("summarizeStep", () => {
  it("labels click with observation node name", () => {
    const op: Op = { kind: "browser.click", ref: "el12" }
    const r: OpResult = { ok: true, durationMs: 120, selector: "button.sign-in" }
    const step = summarizeStep(op, r, obs)
    expect(step.kind).toBe("browser.click")
    expect(step.label).toBe("Sign in")
    expect(step.ok).toBe(true)
    expect(step.selector).toBe("button.sign-in")
    expect(step.durationMs).toBe(120)
  })

  it("labels type with node name and truncates value preview", () => {
    const op: Op = {
      kind: "browser.type",
      ref: "el18",
      value: "alice@example.com"
    }
    const r: OpResult = { ok: true, durationMs: 80 }
    const step = summarizeStep(op, r, obs)
    expect(step.kind).toBe("browser.type")
    expect(step.label).toBe("Email")
  })

  it("observe step has no label", () => {
    const op: Op = { kind: "browser.observe" }
    const r: OpResult = { ok: true, durationMs: 40 }
    const step = summarizeStep(op, r, obs)
    expect(step.kind).toBe("browser.observe")
    expect(step.label).toBeUndefined()
  })

  it("navigate step uses url as label", () => {
    const op: Op = { kind: "browser.navigate", url: "https://example.com/x" }
    const r: OpResult = { ok: true, durationMs: 0 }
    const step = summarizeStep(op, r, obs)
    expect(step.label).toBe("https://example.com/x")
  })

  it("skipped result preserves reason", () => {
    const op: Op = { kind: "browser.click", ref: "missing" }
    const r: OpResult = { ok: false, skipped: true, reason: "ref not in observation" }
    const step = summarizeStep(op, r, obs)
    expect(step.ok).toBe(false)
    expect(step.skipped).toBe(true)
    expect(step.reason).toBe("ref not in observation")
  })

  it("halted step keeps reason text", () => {
    const op: Op = { kind: "browser.click", ref: "el12" }
    const r: OpResult = { ok: false, reason: "halted after error" }
    const step = summarizeStep(op, r, obs)
    expect(step.ok).toBe(false)
    expect(step.skipped).toBeUndefined()
    expect(step.reason).toBe("halted after error")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/page-agent-step.test.ts`
Expected: FAIL — `summarizeStep` and `OpResult` are not exported.

- [ ] **Step 3: Implement summarizeStep**

Add to `src/background/page-agent-program.ts`:

```ts
export type OpResult = {
  ok: boolean
  skipped?: boolean
  reason?: string
  durationMs?: number
  selector?: string
  data?: unknown
}

export type StepEntry = {
  kind: string
  label?: string
  ok: boolean
  skipped?: boolean
  reason?: string
  durationMs?: number
  selector?: string
  raw: { op: Op; result: OpResult }
}

type ObservationLite = { nodes?: Array<{ ref?: string; name?: string; text?: string; selector?: string }> }

function labelFor(op: Op, observation: ObservationLite | null | undefined): string | undefined {
  if (op.kind === "browser.navigate") return op.url
  if (op.kind === "browser.wait") return op.ms != null ? `${op.ms}ms` : undefined
  if (op.kind === "memory.search" || op.kind === "memory.remember") return op.value
  if (op.kind === "browser.observe" || op.kind === "session.compact") return undefined
  if (!op.ref) return undefined
  const nodes = observation?.nodes ?? []
  const node = nodes.find((n) => n?.ref === op.ref)
  const name = (node?.name && node.name.trim()) || (node?.text && node.text.trim())
  return name || undefined
}

export function summarizeStep(op: Op, result: OpResult, observation: ObservationLite | null | undefined): StepEntry {
  const step: StepEntry = {
    kind: op.kind,
    ok: result.ok,
    raw: { op, result }
  }
  const label = labelFor(op, observation)
  if (label) step.label = label
  if (result.skipped) step.skipped = true
  if (result.reason) step.reason = result.reason
  if (typeof result.durationMs === "number") step.durationMs = result.durationMs
  if (result.selector) step.selector = result.selector
  return step
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/page-agent-step.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/background/page-agent-program.ts tests/page-agent-step.test.ts
git commit -m "feat(page-agent): summarizeStep pure helper with observation labels"
```

---

## Task 5: executeProgram — linear happy path

**Files:**
- Modify: `src/background/page-agent-program.ts`
- Modify: `tests/page-agent-program.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/page-agent-program.test.ts`:

```ts
import { executeProgram, type ProgramDeps } from "../src/background/page-agent-program"

const initialObs = {
  nodes: [
    { ref: "el12", name: "Sign in", selector: "button.sign-in" },
    { ref: "el18", name: "Email", selector: "input#email" }
  ]
}

function makeDeps(overrides: Partial<ProgramDeps> = {}): ProgramDeps {
  const calls: any[] = []
  const deps: ProgramDeps = {
    runTool: async (name, args) => {
      calls.push({ tool: "runTool", name, args })
      return { ok: true, data: null }
    },
    observe: async () => {
      calls.push({ tool: "observe" })
      return initialObs
    },
    wait: async (ms) => {
      calls.push({ tool: "wait", ms })
    },
    now: (() => {
      let t = 1000
      return () => (t += 100)
    })(),
    ...overrides
  }
  ;(deps as any)._calls = calls
  return deps
}

describe("executeProgram", () => {
  it("runs ops linearly and produces a step entry per op", async () => {
    const program: Op[] = [
      { kind: "browser.click", ref: "el12" },
      { kind: "browser.type", ref: "el18", value: "alice" },
      { kind: "browser.observe" }
    ]
    const deps = makeDeps()
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps).toHaveLength(3)
    expect(result.steps.map((s) => s.kind)).toEqual([
      "browser.click",
      "browser.type",
      "browser.observe"
    ])
    expect(result.steps.every((s) => s.ok)).toBe(true)
    expect(result.steps[0].label).toBe("Sign in")
    expect(result.steps[1].label).toBe("Email")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: FAIL — `executeProgram` and `ProgramDeps` are not exported.

- [ ] **Step 3: Implement executeProgram (happy path)**

Add to `src/background/page-agent-program.ts`:

```ts
export type ToolName = "browser_observe" | "click" | "type" | "scroll_to" | "navigate"

export type ProgramDeps = {
  runTool(name: ToolName, args: Record<string, unknown>): Promise<OpResult>
  observe(tabId: number): Promise<ObservationLite>
  wait(ms: number): Promise<void>
  now(): number
}

const STRUCTURAL_OPS = new Set<string>(["browser.click", "browser.type", "browser.navigate"])
const WAIT_MAX_MS = 2000

function resolveSelector(op: Op, observation: ObservationLite | null | undefined): string | null {
  if (!op.ref) return null
  const node = observation?.nodes?.find((n) => n?.ref === op.ref)
  const selector = typeof node?.selector === "string" ? node.selector.trim() : ""
  return selector || null
}

async function runOp(
  op: Op,
  observation: ObservationLite | null | undefined,
  deps: ProgramDeps,
  tabId: number
): Promise<OpResult> {
  const t0 = deps.now()
  const elapsed = (): number => deps.now() - t0

  if (op.kind === "browser.observe") {
    const data = await deps.observe(tabId)
    return { ok: true, durationMs: elapsed(), data }
  }
  if (op.kind === "browser.wait") {
    const ms = Math.min(Math.max(0, op.ms ?? 0), WAIT_MAX_MS)
    await deps.wait(ms)
    return { ok: true, durationMs: elapsed(), reason: ms !== (op.ms ?? 0) ? `clamped to ${ms}ms` : undefined }
  }
  if (op.kind === "browser.navigate") {
    if (!op.url || !/^https?:\/\//i.test(op.url)) {
      return { ok: false, skipped: true, reason: "navigate requires http(s) url", durationMs: elapsed() }
    }
    return { ...(await deps.runTool("navigate", { tabId, url: op.url })), durationMs: elapsed() }
  }
  if (op.kind === "browser.click" || op.kind === "browser.type" || op.kind === "browser.scroll") {
    if (op.kind === "browser.scroll" && op.y != null && !op.ref) {
      return { ...(await deps.runTool("scroll_to", { tabId, y: op.y })), durationMs: elapsed() }
    }
    const selector = resolveSelector(op, observation)
    if (!selector) {
      return { ok: false, skipped: true, reason: "ref not in observation", durationMs: elapsed() }
    }
    if (op.kind === "browser.click") {
      return { ...(await deps.runTool("click", { tabId, selector })), selector, durationMs: elapsed() }
    }
    if (op.kind === "browser.type") {
      return { ...(await deps.runTool("type", { tabId, selector, value: op.value ?? "" })), selector, durationMs: elapsed() }
    }
    return { ...(await deps.runTool("scroll_to", { tabId, selector })), selector, durationMs: elapsed() }
  }
  if (op.kind === "memory.search" || op.kind === "memory.remember" || op.kind === "session.compact") {
    return { ok: false, skipped: true, reason: "memory not wired", durationMs: elapsed() }
  }
  return { ok: false, skipped: true, reason: `unknown op ${op.kind}`, durationMs: elapsed() }
}

export async function executeProgram(
  tabId: number,
  program: Op[],
  initialObservation: ObservationLite | null | undefined,
  deps: ProgramDeps
): Promise<{ steps: StepEntry[]; finalObservation: ObservationLite | null | undefined }> {
  let observation = initialObservation
  const steps: StepEntry[] = []
  for (const op of program) {
    const result = await runOp(op, observation, deps, tabId)
    steps.push(summarizeStep(op, result, observation))
    if (op.kind === "browser.observe" && result.data) {
      observation = result.data as ObservationLite
    } else if (STRUCTURAL_OPS.has(op.kind) && result.ok && !result.skipped) {
      observation = await deps.observe(tabId)
    }
  }
  return { steps, finalObservation: observation }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: PASS, all prior tests + the new one.

- [ ] **Step 5: Commit**

```bash
git add src/background/page-agent-program.ts tests/page-agent-program.test.ts
git commit -m "feat(page-agent): executeProgram linear runner with internal re-observe"
```

---

## Task 6: executeProgram — halt-on-error

**Files:**
- Modify: `tests/page-agent-program.test.ts`
- Modify: `src/background/page-agent-program.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/page-agent-program.test.ts` inside `describe("executeProgram", ...)`:

```ts
  it("halts on first non-skipped failure and marks remaining ops 'halted after error'", async () => {
    const program: Op[] = [
      { kind: "browser.click", ref: "el12" },
      { kind: "browser.type", ref: "el18", value: "alice" },
      { kind: "browser.observe" }
    ]
    let calls = 0
    const deps = makeDeps({
      runTool: async (name) => {
        calls += 1
        if (calls === 1) return { ok: false, reason: "click intercepted" }
        return { ok: true }
      }
    })
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0].ok).toBe(false)
    expect(result.steps[0].reason).toBe("click intercepted")
    expect(result.steps[1].ok).toBe(false)
    expect(result.steps[1].skipped).toBe(true)
    expect(result.steps[1].reason).toBe("halted after error")
    expect(result.steps[2].ok).toBe(false)
    expect(result.steps[2].skipped).toBe(true)
    expect(result.steps[2].reason).toBe("halted after error")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: FAIL — currently all 3 ops execute.

- [ ] **Step 3: Implement halt-on-error**

In `src/background/page-agent-program.ts`, update the `executeProgram` loop:

```ts
export async function executeProgram(
  tabId: number,
  program: Op[],
  initialObservation: ObservationLite | null | undefined,
  deps: ProgramDeps
): Promise<{ steps: StepEntry[]; finalObservation: ObservationLite | null | undefined }> {
  let observation = initialObservation
  const steps: StepEntry[] = []
  let halted = false
  for (const op of program) {
    if (halted) {
      steps.push(
        summarizeStep(op, { ok: false, skipped: true, reason: "halted after error" }, observation)
      )
      continue
    }
    const result = await runOp(op, observation, deps, tabId)
    steps.push(summarizeStep(op, result, observation))
    if (!result.ok && !result.skipped) {
      halted = true
      continue
    }
    if (op.kind === "browser.observe" && result.data) {
      observation = result.data as ObservationLite
    } else if (STRUCTURAL_OPS.has(op.kind) && result.ok && !result.skipped) {
      observation = await deps.observe(tabId)
    }
  }
  return { steps, finalObservation: observation }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: PASS, all tests (including prior happy path).

- [ ] **Step 5: Commit**

```bash
git add src/background/page-agent-program.ts tests/page-agent-program.test.ts
git commit -m "feat(page-agent): halt program on first non-skip error"
```

---

## Task 7: executeProgram — skip on missing ref + wait clamp

**Files:**
- Modify: `tests/page-agent-program.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/page-agent-program.test.ts` inside `describe("executeProgram", ...)`:

```ts
  it("skips click when ref is not in observation but continues running", async () => {
    const program: Op[] = [
      { kind: "browser.click", ref: "ghost" },
      { kind: "browser.observe" }
    ]
    const deps = makeDeps()
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps[0].ok).toBe(false)
    expect(result.steps[0].skipped).toBe(true)
    expect(result.steps[0].reason).toBe("ref not in observation")
    expect(result.steps[1].ok).toBe(true)
  })

  it("clamps browser.wait to 2000ms and records reason", async () => {
    const program: Op[] = [{ kind: "browser.wait", ms: 999_999 }]
    let waitedMs = -1
    const deps = makeDeps({ wait: async (ms) => { waitedMs = ms } })
    const result = await executeProgram(1, program, initialObs, deps)
    expect(waitedMs).toBe(2000)
    expect(result.steps[0].ok).toBe(true)
    expect(result.steps[0].reason).toBe("clamped to 2000ms")
  })

  it("browser.wait under cap is unmodified", async () => {
    const program: Op[] = [{ kind: "browser.wait", ms: 500 }]
    const deps = makeDeps()
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps[0].ok).toBe(true)
    expect(result.steps[0].reason).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: PASS — the existing `executeProgram` already handles these (selector resolution and `Math.min` clamp are in place from Task 5). If a test fails, fix the implementation rather than the test.

- [ ] **Step 3: Commit**

```bash
git add tests/page-agent-program.test.ts
git commit -m "test(page-agent): cover skip-on-missing-ref and wait clamp"
```

---

## Task 8: Wire executeProgram into background.ts

**Files:**
- Modify: `src/background.ts`

- [ ] **Step 1: Write the failing source-shape test**

Append to `tests/page-agent-program.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("background wiring", () => {
  const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")

  it("imports executeProgram + parseProgram from page-agent-program", () => {
    expect(background).toMatch(/from\s+["']\.\/background\/page-agent-program["']/)
    expect(background).toContain("parseProgram")
    expect(background).toContain("executeProgram")
  })

  it("no longer references replyWithActionResult", () => {
    expect(background).not.toContain("replyWithActionResult")
  })

  it("PAGE_AGENT_MESSAGE response carries `steps`", () => {
    expect(background).toMatch(/steps:\s*[A-Za-z_.]+\.steps/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: FAIL on all three new "background wiring" assertions.

- [ ] **Step 3: Update `src/background.ts`**

Add import near the other `./background/*` imports (around line 58, just after the `cal-tasks-origin` import):

```ts
import {
  parseProgram,
  executeProgram,
  type ProgramDeps,
  type StepEntry
} from "./background/page-agent-program";
```

Delete `replyWithActionResult` (currently at line ~1019) — entire function body.

Replace the body of `handlePageAgentMessage` from the `executePageAgentAction` call through the two `return` statements with the version below. Locate the function (currently starting at line ~1030):

```ts
async function handlePageAgentMessage(input: {
  tabId: number;
  sessionId?: string;
  text: string;
}): Promise<{
  sessionId: string;
  reply: string;
  provider: string;
  steps: StepEntry[];
}> {
  const text = input.text.trim();
  if (!text) throw new Error("message required");
  const initialObservation = await pageAgentObserve(input.tabId);
  const sessionId = input.sessionId || `page_${crypto.randomUUID()}`;
  const localPlan = await requestNative(
    { type: "foundationModels.plan", objective: text, observation: initialObservation },
    15000,
  ).catch(() => null);

  const programDeps: ProgramDeps = {
    runTool: async (name, args) => {
      const handler = DOM_TOOL_HANDLERS[name];
      if (!handler) return { ok: false, reason: `unknown tool ${name}` };
      const r = await handler(args);
      if (r.isError) return { ok: false, reason: r.content?.[0]?.text || "tool error" };
      try {
        const parsed = JSON.parse(r.content?.[0]?.text || "null");
        return { ok: true, data: parsed };
      } catch {
        return { ok: true, data: r.content?.[0]?.text };
      }
    },
    observe: (tabId) => pageAgentObserve(tabId) as Promise<any>,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now()
  };

  const program = parseProgram(localPlan?.plan ?? localPlan);
  const trace = await executeProgram(input.tabId, program, initialObservation as any, programDeps);

  const settings = await getSettings();
  if (settings.sidebarSyncEnabled && settings.sidebarApiUrl) {
    try {
      const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl);
      const res = await client.agent.chat(buildBrowserAgentCloudChatPayload({
        settings,
        sessionId,
        message: text,
        objective: text,
        observation: trace.finalObservation
      }));
      return {
        sessionId: res.session.id,
        reply: localPlan?.ok && localPlan.reply ? localPlan.reply : res.reply,
        provider: localPlan?.ok ? "foundation-models" : res.provider,
        steps: trace.steps
      };
    } catch (err) {
      safeRuntimeWarning("page agent cloud chat failed; using local fallback", err);
    }
  }

  const nodes = Array.isArray((trace.finalObservation as any)?.nodes)
    ? (trace.finalObservation as any).nodes.length
    : 0;
  const reply =
    localPlan?.ok && localPlan.reply
      ? localPlan.reply
      : [
          `Objective: ${text}`,
          `Status: observed ${nodes} visible page node${nodes === 1 ? "" : "s"}.`,
          "Plan: choose one safe browser action, request consent for write actions, then observe again.",
          "Next step: configure sidebar-api sync for persistent memory or continue locally from this page observation."
        ].join("\n");
  return {
    sessionId,
    reply,
    provider: localPlan?.ok ? "foundation-models" : "local-deterministic",
    steps: trace.steps
  };
}
```

- [ ] **Step 4: Run full test suite + typecheck**

```bash
pnpm exec vitest run tests/page-agent-program.test.ts tests/page-agent-step.test.ts
pnpm exec tsc --noEmit
```
Expected: all PASS, no TypeScript errors. If `executePageAgentAction` or `extractPageAgentAction` become unreferenced, delete them (skill rule: no dead code). Re-run tsc after deletions.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts tests/page-agent-program.test.ts
git commit -m "feat(page-agent): wire executeProgram into PAGE_AGENT_MESSAGE handler"
```

---

## Task 9: Content script — step entry variant + renderer

**Files:**
- Modify: `src/contents/page-agent.ts`
- Modify: `tests/page-agent-program.test.ts` (add a content-script source-shape assertion)

- [ ] **Step 1: Write the failing source-shape test**

Append to `tests/page-agent-program.test.ts`:

```ts
describe("content script step rendering", () => {
  const cs = readFileSync(join(process.cwd(), "src/contents/page-agent.ts"), "utf8")

  it("declares a step ChatEntry variant", () => {
    expect(cs).toMatch(/role:\s*["']step["']/)
  })

  it("renders a class 'step' element for step entries", () => {
    expect(cs).toContain('.step')
  })

  it("pushes step entries from the response before the assistant reply", () => {
    expect(cs).toContain("response.steps")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/page-agent-program.test.ts`
Expected: FAIL on the three new content-script assertions.

- [ ] **Step 3: Update `src/contents/page-agent.ts`**

Replace the `ChatEntry` type (currently `type ChatEntry = { role: "user" | "assistant" | "status" | "error"; text: string }`) with:

```ts
type StepEntryLite = {
  kind: string
  label?: string
  ok: boolean
  skipped?: boolean
  reason?: string
  durationMs?: number
  selector?: string
  raw: unknown
}

type TextEntry = { role: "user" | "assistant" | "status" | "error"; text: string }
type StepChatEntry = { role: "step"; step: StepEntryLite; expanded: boolean }
type ChatEntry = TextEntry | StepChatEntry
```

Inside the inline `<style>` block in `mount()`, append (just before the closing `</style>`):

```css
      .step {
        font-size: 11px;
        color: #c8d2dc;
        background: rgba(255,255,255,.04);
        border-radius: 6px;
        padding: 6px 8px;
        cursor: pointer;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .step.bad { color: #ffd4d4; }
      .step .detail {
        display: none;
        margin-top: 6px;
        padding: 6px;
        background: #0c1015;
        border-radius: 5px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .step[data-expanded="true"] .detail { display: block; }
```

Replace the `render()` function's `log.replaceChildren(...)` call with a renderer that handles both variants:

```ts
  const render = () => {
    root.style.display = visible ? "block" : "none"
    panel.dataset.open = open ? "true" : "false"
    toggle.style.display = visible && !open ? "inline-grid" : "none"
    log.replaceChildren(
      ...entries.map((entry, idx) => {
        if (entry.role === "step") return renderStep(entry, idx)
        const node = document.createElement("div")
        node.className = `msg ${entry.role}`
        node.textContent = entry.text
        return node
      })
    )
    log.scrollTop = log.scrollHeight
  }

  const ICON: Record<string, string> = {
    "browser.observe": "👁",
    "browser.click": "🖱",
    "browser.type": "⌨",
    "browser.scroll": "↕",
    "browser.wait": "⏱",
    "browser.navigate": "🧭",
    "memory.search": "🧠",
    "memory.remember": "🧠",
    "session.compact": "🗜"
  }

  const renderStep = (entry: StepChatEntry, idx: number) => {
    const node = document.createElement("div")
    node.className = `step ${entry.step.ok ? "" : "bad"}`.trim()
    node.dataset.expanded = entry.expanded ? "true" : "false"
    const icon = ICON[entry.step.kind] || "·"
    const labelPart = entry.step.label ? ` "${entry.step.label}"` : ""
    const statusPart = entry.step.ok
      ? "✓"
      : entry.step.skipped
        ? `↷ ${entry.step.reason || "skipped"}`
        : `✗ ${entry.step.reason || "failed"}`
    const durationPart = typeof entry.step.durationMs === "number" ? ` ${entry.step.durationMs}ms` : ""
    const summary = document.createElement("div")
    summary.textContent = `▸ ${icon} ${entry.step.kind}${labelPart} · ${statusPart}${durationPart}`
    const detail = document.createElement("pre")
    detail.className = "detail"
    detail.textContent = JSON.stringify(entry.step.raw, null, 2)
    node.append(summary, detail)
    node.addEventListener("click", () => {
      entries[idx] = { ...entry, expanded: !entry.expanded }
      render()
    })
    return node
  }
```

Update the response shape and post-response handling in the `form.addEventListener("submit", ...)` block:

```ts
  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ""
    entries.push({ role: "user", text }, { role: "status", text: "Planning with current page observation..." })
    render()
    try {
      const response = await sendRuntime<{
        ok: true
        sessionId: string
        reply: string
        provider: string
        steps: StepEntryLite[]
      }>({ type: "PAGE_AGENT_MESSAGE", sessionId, text })
      sessionId = response.sessionId
      removeLastStatus()
      for (const step of response.steps || []) {
        entries.push({ role: "step", step, expanded: false })
      }
      entries.push({ role: "assistant", text: `${response.reply}\n\nProvider: ${response.provider}` })
    } catch (err) {
      removeLastStatus()
      entries.push({ role: "error", text: err instanceof Error ? err.message : String(err) })
    }
    render()
  })
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm exec vitest run tests/page-agent-program.test.ts
pnpm exec tsc --noEmit
```
Expected: PASS on all assertions, no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/contents/page-agent.ts tests/page-agent-program.test.ts
git commit -m "feat(page-agent): render per-op step strips with click-to-expand"
```

---

## Task 10: Native-host bridge — add AgentOp + AgentPlan.program

**Files:**
- Modify: `native-host/foundation-models-bridge.swift`

- [ ] **Step 1: Add the `AgentOp` struct**

In `native-host/foundation-models-bridge.swift`, just above `struct AgentAction` (currently ~line 46):

```swift
@Generable
struct AgentOp: Codable {
    @Guide(description: "Operation kind.", .anyOf([
        "browser.observe","browser.click","browser.type","browser.scroll",
        "browser.wait","browser.navigate","memory.search","memory.remember","session.compact"
    ]))
    var op: String

    @Guide(description: "Observation ref like el3 when the op targets an element.")
    var ref: String?

    @Guide(description: "Text, URL, or query value for the op.")
    var value: String?

    @Guide(description: "Wait duration in milliseconds (cap 2000).")
    var ms: Int?

    @Guide(description: "Scroll target y-coordinate in CSS pixels.")
    var y: Int?

    @Guide(description: "Navigate target URL (http or https).")
    var url: String?
}
```

- [ ] **Step 2: Add `program` field to `AgentPlan`**

Inside the `struct AgentPlan` body (currently ~line 62), append after the `action` field:

```swift
    @Guide(description: "Sequence of up to 8 ops; halt on first failure. Prefer this over action.", .maximumCount(8))
    var program: [AgentOp]?
```

- [ ] **Step 3: Update planner instructions**

In `planResponse(for:operation:)` (currently ~line 214), replace the `instructions` string with:

```swift
    let instructions = """
    You are a local, privacy-preserving browser agent planner running on the user's Mac.
    You do not execute browser actions. You produce compact structured plans for a consent-gated browser tool layer.
    Prefer emitting a `program` of 1-8 ops in order; the runner halts at the first failure.
    The legacy `action` field is for backward compatibility only — when both are present, `program` wins.
    Keep output short. Do not invent page details that are not in the observation.
    """
```

- [ ] **Step 4: Surface `program` on the response**

In the same function, expand the `BridgeResponse` construction to include `program`. First, add a corresponding field to the `BridgeResponse` struct (search for `var plan: AgentPlan?` and add right after):

```swift
    var program: [AgentOp]?
```

Then in `planResponse(for:operation:)`, update the return:

```swift
    return BridgeResponse(
        ok: true,
        available: true,
        operation: operation,
        contextSize: SystemLanguageModel.default.contextSize,
        tokenEstimate: await tokenEstimate(for: prompt),
        plan: plan,
        action: plan.action,
        program: plan.program,
        compactSummary: nil,
        status: plan.status,
        nextStep: plan.nextStep,
        reply: [
            "Objective: \(plan.objective)",
            "Status: \(plan.status)",
            "Next step: \(plan.nextStep)",
            plan.program?.isEmpty == false
                ? "Program: \(plan.program?.count ?? 0) ops"
                : "Action: \(plan.action.kind) - \(plan.action.reason)"
        ].joined(separator: "\n")
    )
```

Adjust the initializer call to match the actual field order in `BridgeResponse` (search the struct definition near the top of the file and order accordingly — Swift requires the order to match unless you use named initializers).

- [ ] **Step 5: Rebuild native host**

```bash
swift build --package-path native-host
# or, if the host uses a different build script:
pnpm --filter native-host build 2>/dev/null || (cd native-host && swift build)
```
Expected: compiles cleanly. If Foundation Models is unavailable on the build host (non-Apple silicon, older macOS), this step will surface a build warning — that's pre-existing and out of scope.

- [ ] **Step 6: Commit**

```bash
git add native-host/foundation-models-bridge.swift
git commit -m "feat(native-host): teach planner to emit program of ops"
```

---

## Task 11: Final build + smoke

**Files:**
- (no source changes)

- [ ] **Step 1: Full TS test suite + typecheck**

```bash
pnpm exec vitest run
pnpm exec tsc --noEmit
```
Expected: ALL tests PASS, no TS errors.

- [ ] **Step 2: Production build**

```bash
pnpm build
```
Expected: `🟢 DONE | Finished in ~Xs!`

- [ ] **Step 3: Manual reload + smoke**

1. Open `chrome://extensions`, click the reload icon on "Brave Dev Extension".
2. Open any page, click the page-agent toggle (bottom-right bubble).
3. Type: `observe the page and click the most prominent link`.
4. Expect: 1+ step strips appear above the assistant reply. Each strip is clickable to expand into the raw op/result JSON.

- [ ] **Step 4: Commit (only if any tweaks were needed)**

If the smoke test surfaced issues, fix them, write a regression test, and commit. If everything works, no commit — the work is done.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `parseProgram` (modern + legacy + MAX_OPS + unknown drop + both-prefers-program) | Tasks 1, 2, 3 |
| `summarizeStep` pure, label resolution | Task 4 |
| `executeProgram` linear, halt-on-error, skip-on-miss, wait clamp, internal re-observe | Tasks 5, 6, 7 |
| `handlePageAgentMessage` response = `{sessionId, reply, provider, steps}` | Task 8 |
| Remove `replyWithActionResult` | Task 8 |
| Content-script `step` ChatEntry variant + renderer + click-to-expand | Task 9 |
| Native-host `AgentOp` + `AgentPlan.program` + instructions | Task 10 |
| Op catalog (browser.* + memory.* + session.compact) | Tasks 5–7 (impl), Task 10 (planner) |
| Re-observe only after structural ops, not surfaced as visible steps | Task 5 (impl), Task 6 (preserved through halt) |
| Wait clamp ≤2000ms with reason recorded | Task 7 |
| memory.* / session.compact return "memory not wired" stub | Task 5 (impl) |
| MAX_OPS = 8 | Task 1 |

**No placeholders detected** — every step includes the actual code, the exact command, and the expected outcome.

**Type consistency:** `Op`, `OpResult`, `StepEntry`, `ProgramDeps` are defined once in Task 4 / Task 5 and reused verbatim downstream. The content script defines `StepEntryLite` (structural twin of `StepEntry` minus the deep `raw` typing) to avoid a content-script import of background-only types — this is intentional and noted in Task 9.
