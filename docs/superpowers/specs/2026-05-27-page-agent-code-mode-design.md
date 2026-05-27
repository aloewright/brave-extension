# Page Agent Code Mode + Step Visibility (Design)

**Status:** Draft 2026-05-27.
**Author:** Claude, paired with project owner.
**Scope:** `ai-dev-sidebar` (Brave/Chromium MV3 extension) — content script `src/contents/page-agent.ts`, background `src/background.ts` and helpers under `src/background/`, plus the local planner in `native-host/foundation-models-bridge.swift`.

## Goal

Replace the page agent's "observe → plan-one-action → done" loop with a Code-Mode-style program runner that executes a short, validated sequence of operations per turn, and show the per-op trace in the chat UI as collapsible step strips. The work flesheshes out the stub at `src/lib/browser-agent-code-mode.ts` and exposes the operation catalog (`BROWSER_AGENT_OPERATIONS`) as the LLM's contract.

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| Plan output shape | LLM emits `program: Op[]` (JSON DSL); legacy single `action` field is auto-wrapped into a 1-op program | Backward compatible with any planner that hasn't been updated yet. |
| Sandboxing | JSON DSL, **not** sandboxed JS | Linear ops only — no `if`/`for`. Avoids shipping a JS interpreter (quickjs-wasm etc.) into the extension. Equivalent expressiveness for the bounded use case. |
| Max ops per turn | `MAX_OPS = 8` | Covers "fill 3 fields + submit + re-observe" with headroom. Bounds LLM output and turn duration. |
| Failure policy | **Halt-on-error.** First op returning `ok:false && !skipped` stops the program. Remaining ops marked `skipped: "halted after error"`. | Safer for browser actions — don't keep clicking after the wrong target was hit. |
| Op catalog | `browser.observe \| click \| type \| scroll \| wait \| navigate` + `memory.search \| memory.remember` + `session.compact` (catalog already defined in `src/lib/browser-agent-code-mode.ts`) | Reuses the existing stub. `memory.*` and `session.compact` are catalog-valid but currently no-op (return `{ok:false, skipped:true, reason:"not wired"}`). |
| Wait clamp | `browser.wait.ms ≤ 2000` | Bounds per-turn latency; longer waits should be a future control-flow primitive, not a wait. |
| Re-observe policy | Internal-only auto re-observe after `click`, `type`, `navigate` to keep the next op's `ref` resolution accurate. **These do not appear as visible step entries** — only explicit `browser.observe` ops produce a visible step. | Internal observes are an implementation detail; surfacing them would clutter the UI. The planner can still request an explicit `browser.observe` when it wants the user to see the new state. |
| UI shape | One compact step strip per op, between the user message and the assistant reply. Click to expand into op/result JSON. | User-selected during brainstorm: "Compact step strip per turn". Scales naturally from 1 op to MAX_OPS. |
| Reply text | No longer carries action-result text. `replyWithActionResult` is removed in favor of structured `steps`. | UI renders the trace; the natural-language reply stays clean. |
| Persistence | Per-turn only; chat clears on page reload (matches existing behavior). | YAGNI — no new storage layer. |
| Native-host planner change | Include in this slice (`AgentPlan` gains optional `program: [AgentOp]?`, instructions teach the new shape). | Selected during brainstorm to make Code Mode usable on the local path immediately. |

## Architecture

```
┌───────────────────────── Content script (page-agent.ts) ─────────────────────────┐
│  user types ─▶ PAGE_AGENT_MESSAGE                                                 │
│                          │                                                        │
│                          ▼                                                        │
│                 await background reply                                            │
│                          │                                                        │
│           push entries:  step #1 → step #2 → … → step #N → assistant reply        │
│           render():     [▸ 47 nodes·click "Sign in"·✓ ok] [▸ type "..."·✓] ...   │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │ chrome.runtime
                                       ▼
┌─────────────────────────── Background service worker ────────────────────────────┐
│  handlePageAgentMessage(tabId, sessionId, text)                                  │
│      observation₀ = await pageAgentObserve(tabId)                                │
│      plan         = await requestNative(foundationModels.plan, {obs, text})      │
│      program      = parseProgram(plan)            // [Op, …]  size ≤ MAX_OPS     │
│      trace        = await executeProgram(tabId, program, observation₀)           │
│      reply        = plan.reply ?? <fallback summary>                             │
│      return { sessionId, reply, provider, steps: trace.steps }                   │
│                                                                                  │
│  executeProgram(tabId, program, obs):                                            │
│      for op in program:                                                          │
│        run via DOM_TOOL_HANDLERS[op.kind] → result                               │
│        if op rewrites DOM (click/type/navigate): obs = await re-observe          │
│        summarize → step entry                                                    │
│        if !result.ok and !result.skipped: halt, mark rest "halted after error"   │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │ native messaging
                                       ▼
┌──────────────────── Native host (foundation-models-bridge.swift) ────────────────┐
│  AgentPlan now includes optional `program: [AgentOp]?` (Generable struct).       │
│  Instructions teach the model: "Emit a program of up to 8 ops; first op should   │
│  be observe unless the previous observation is fresh; halt on first error."      │
│  If model emits both `program` and `action`, `program` wins.                     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## Components (new and modified)

### New: `src/background/page-agent-program.ts` (~150 LOC)

Pure-ish module exporting:

- `type Op = { kind: BrowserAgentOperation; ref?: string; value?: string; ms?: number; y?: number; url?: string }`
- `type StepEntry = {
    kind: string;          // op kind, e.g. "browser.click"
    label?: string;        // human-readable target ("Sign in" link)
    ok: boolean;
    skipped?: boolean;
    reason?: string;       // friendly explanation when skipped or failed
    durationMs?: number;
    selector?: string;     // resolved CSS selector for click/type
    raw: { op: Op; result?: unknown };
  }`
- `parseProgram(plan: unknown): Op[]` — accepts modern `{program: [...]}`, legacy `{action: {...}}` (wrapped), or neither (returns `[]`). Validates each op kind against `BROWSER_AGENT_OPERATIONS`. Drops unknown ops with a `console.warn`. Clamps to `MAX_OPS = 8`.
- `executeProgram(tabId, program, observation, deps): Promise<{ steps: StepEntry[]; finalObservation: unknown }>` — sequential execution; `deps` is `{ runTool, observe, now }` so tests can inject mocks.
- `summarizeStep(op, result, observationBeforeOp): StepEntry` — pure; computes label by looking up `op.ref` in the observation's `nodes`.

### Modified: `src/background.ts`

- Replace `executePageAgentAction` call in `handlePageAgentMessage` with `executeProgram`.
- Response shape: `{ sessionId, reply, provider, steps: StepEntry[] }` (drop `observation` and `plan` from the wire — content script doesn't need them; if a debugging surface wants them later, add a separate diagnostic message).
- Remove `replyWithActionResult` (no more action-text folding into the reply).
- Keep `executePageAgentAction` for any other callers, but if there are none, delete it in the same change.

### Modified: `src/contents/page-agent.ts`

- `ChatEntry` becomes a discriminated union:
  ```ts
  type ChatEntry =
    | { role: "user" | "assistant" | "status" | "error"; text: string }
    | { role: "step"; step: StepEntry; expanded: boolean }
  ```
- `render()`: keep the existing text-entry rendering; add a step renderer that produces a 1-line strip + a hidden `<pre>` (toggled by clicking the strip). Strip format:
  `▸ <icon> <kind-short> "<label>" <status> <duration>`
  - icon: 👁 (observe), 🖱 (click), ⌨ (type), ↕ (scroll), ⏱ (wait), 🧭 (navigate), 🧠 (memory.*), 🗜 (session.compact)
  - status: `✓` / `↷ skipped` / `✗ <reason>`
- After response: push one `{role:"step"}` per `response.steps` entry, then the assistant reply. Status entry ("Planning...") is removed *before* steps are pushed.
- Click handler on a strip toggles `entry.expanded` and re-renders.

### Modified: `native-host/foundation-models-bridge.swift`

- New `@Generable struct AgentOp`:
  ```swift
  @Guide(description: "Operation kind.", .anyOf([
    "browser.observe","browser.click","browser.type","browser.scroll",
    "browser.wait","browser.navigate","memory.search","memory.remember","session.compact"
  ]))
  var op: String
  @Guide(description: "Observation ref (e.g. el3) when targeting an element.") var ref: String?
  @Guide(description: "Text, URL, or query string for the op.") var value: String?
  @Guide(description: "Wait duration in ms, ≤ 2000.") var ms: Int?
  @Guide(description: "Scroll target y-coordinate in CSS pixels.") var y: Int?
  ```
- `AgentPlan` gains: `@Guide("Sequence of up to 8 ops; halt on first failure.", .maximumCount(8)) var program: [AgentOp]?`
- Instructions string teaches: "Prefer emitting a `program` of 1–8 ops. The `action` field is for legacy callers only; if both are present, `program` wins."
- The Swift module needs a rebuild after the change (existing build pipeline already covers this).

## Data flow (one turn, multi-step)

```
1. user: "log me in as alice@example.com"
2. content → bg: PAGE_AGENT_MESSAGE
3. bg observes (47 nodes)
4. bg → native: foundationModels.plan(observation, text)
5. native returns: {
     objective: "Sign in",
     program: [
       { op: "browser.click", ref: "el12", reason: "open the sign-in form" },
       { op: "browser.type",  ref: "el18", value: "alice@example.com" },
       { op: "browser.type",  ref: "el19", value: "<password>" },
       { op: "browser.click", ref: "el23", reason: "submit" },
       { op: "browser.observe", reason: "verify navigation" }
     ],
     reply: "Filling sign-in form and submitting."
   }
6. bg.executeProgram runs all 5 ops:
     click el12 → (internal re-observe) → type el18 → (internal re-observe) →
     type el19 → (internal re-observe) → click el23 → (internal re-observe) →
     explicit observe
     Visible trace: 5 step entries — one per emitted op. The internal re-observes
     run but do NOT generate step entries (they're invisible plumbing so the next
     op's `ref` resolves against fresh DOM).
7. bg returns: { sessionId, reply, provider, steps: [5 StepEntry] }
8. content pushes: 5 step entries + 1 assistant text entry; re-renders
9. user sees: 5 strips above the reply, each clickable to expand.
```

## Operation catalog

| Op | Required fields | Re-observe after | Notes |
|---|---|---|---|
Re-observe column: **internal** = `executeProgram` refreshes its own observation cache so the next op's `ref` resolves against current DOM. Internal observes do *not* produce a visible step.

| Op | Required fields | Internal re-observe? | Notes |
|---|---|---|---|
| `browser.observe` | — | n/a (this IS an observe; produces a visible step) | Forces a fresh DOM snapshot. |
| `browser.click` | `ref` | yes | `ref` resolved via observation.nodes; `{ok:false, skipped:true, reason:"target gone"}` if missing. |
| `browser.type` | `ref`, `value` | yes | Same `ref` resolution. |
| `browser.scroll` | one of `ref`, `y` | no | `ref` scrolls into view; `y` scrolls to absolute coord. |
| `browser.wait` | `ms` (≤2000) | no | Clamps silently to 2000 if larger; reason recorded in step. |
| `browser.navigate` | `url` | yes | Same-tab navigation via existing tool. URL must be `http(s):`; others rejected. |
| `memory.search` | `value` | no | Stub: returns `{ok:false, skipped:true, reason:"memory not wired"}`. |
| `memory.remember` | `value` | no | Same stub. |
| `session.compact` | — | no | Same stub. |

## Error handling

- **Unknown op kind from planner** → dropped during `parseProgram` with `console.warn`. Not surfaced to user (planner-side bug, not user-actionable).
- **Op resolution miss** (e.g., `ref` not in observation) → `{ok:false, skipped:true, reason}`. Counts as a skip, not a halt — execution continues. (Most common case: planner referenced a node that scrolled off after a re-observe.)
- **Op tool throws** → `{ok:false, skipped:false, reason:friendlyMessage}`. Halts program; subsequent ops marked `"halted after error"`.
- **Planner returned no program and no action** → `steps: []`; UI shows just the assistant reply (likely "I need more info" from the planner).
- **Cloud planner fallback** (`settings.sidebarSyncEnabled`) — if local plan failed, cloud plan still gets called via the existing path and may also emit `program`. Same parser handles both.

## Testing

| Test file | Covers |
|---|---|
| `tests/page-agent-program.test.ts` | `parseProgram`: legacy `action` wrap, modern `program`, MAX_OPS clamp, unknown-op drop, both-present-prefers-program. |
| `tests/page-agent-program.test.ts` (same file) | `executeProgram`: linear success, halt-on-error, skip-on-missing-ref, auto-re-observe after structural ops, wait-clamp. Mocks `runTool` + `observe`. |
| `tests/page-agent-step.test.ts` | `summarizeStep` pure cases for each op kind: click w/ label, type w/ truncated value, observe (no label), navigate, wait-clamp reason, skipped, halted. |

Existing `tests/tasks-section.test.ts`-style "source contains expected string" tests will be added to `tests/page-agent.test.ts` if any don't already exist, asserting the content-script imports the step renderer.

The Swift bridge change isn't unit-tested directly (no Swift test infra here); manual verification via the existing `pnpm install-host` + a `foundationModels.plan` round-trip during dev.

## Out of scope (explicit non-goals)

- Control flow in the DSL (`if`, `for`, `while`). Future Code Mode v2.
- Sandboxed JS execution (quickjs-wasm). Same — v2 only if the JSON DSL proves insufficient.
- Persisting step traces across page reloads. Chat state already doesn't persist.
- Streaming step results as they execute. Per-turn batch response; the chat already shows a status entry during the wait, which is sufficient.
- Memory/compact ops actually doing anything. Catalog presence only; wiring is a separate slice tracked against the sidebar-api memory routes.
- Native-host planner improvements beyond adding the `program` field and a one-paragraph instruction tweak. Prompt-tuning is its own slice.

## File index

| Path | Status |
|---|---|
| `src/background/page-agent-program.ts` | new |
| `src/background.ts` | modified (replace `executePageAgentAction` call site; change response shape; delete `replyWithActionResult`) |
| `src/contents/page-agent.ts` | modified (step entry variant + renderer + click toggle) |
| `src/lib/browser-agent-code-mode.ts` | unchanged (catalog already correct) |
| `native-host/foundation-models-bridge.swift` | modified (`AgentOp` struct + `AgentPlan.program` + instructions) |
| `tests/page-agent-program.test.ts` | new |
| `tests/page-agent-step.test.ts` | new |
