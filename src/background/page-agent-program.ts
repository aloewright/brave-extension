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
  targetTabId?: number
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
  if (typeof r.targetTabId === "number" && Number.isFinite(r.targetTabId)) op.targetTabId = r.targetTabId
  return op
}

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

export { BROWSER_AGENT_OPERATIONS }

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
  if (op.kind === "browser.waitFor") return op.value
  if (op.kind === "browser.new_tab") return op.url || "new tab"
  if (op.kind === "browser.switch_tab") return op.targetTabId?.toString()
  if (op.kind === "browser.close_tab") return op.targetTabId?.toString()
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

export type ToolName = "browser_observe" | "click" | "type" | "scroll_to" | "navigate"

export type ProgramDeps = {
  runTool(name: ToolName, args: Record<string, unknown>): Promise<OpResult>
  observe(tabId: number): Promise<ObservationLite>
  wait(ms: number): Promise<void>
  waitFor?(tabId: number, selector: string, timeoutMs: number): Promise<boolean>
  newTab?(url?: string): Promise<number>
  switchTab?(tabId: number): Promise<void>
  /** Closes the tab and returns the now-active tab id (or null if none). */
  closeTab?(tabId: number): Promise<number | null>
  now(): number
  retain?(content: string): Promise<void>
  recall?(query: string): Promise<string>
  onStep?(step: StepEntry): void
}

const STRUCTURAL_OPS = new Set<string>(["browser.click", "browser.type", "browser.navigate", "browser.new_tab", "browser.switch_tab", "browser.close_tab"])
const WAIT_MAX_MS = 2000
const WAIT_FOR_MAX_MS = 10000

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
): Promise<OpResult & { newTabId?: number }> {
  const t0 = deps.now()
  const elapsed = (): number => deps.now() - t0

  if (op.kind === "browser.observe") {
    const data = await deps.observe(tabId)
    return { ok: true, durationMs: elapsed(), data }
  }
  if (op.kind === "browser.wait") {
    const requested = op.ms ?? 0
    const ms = Math.min(Math.max(0, requested), WAIT_MAX_MS)
    await deps.wait(ms)
    return { ok: true, durationMs: elapsed(), reason: ms !== requested ? `clamped to ${ms}ms` : undefined }
  }
  if (op.kind === "browser.waitFor") {
    const requested = op.ms ?? WAIT_FOR_MAX_MS
    const ms = Math.min(Math.max(0, requested), WAIT_FOR_MAX_MS)
    if (!op.value) return { ok: false, skipped: true, reason: "waitFor requires value (selector)", durationMs: elapsed() }
    if (!deps.waitFor) return { ok: false, skipped: true, reason: "waitFor not wired", durationMs: elapsed() }
    const found = await deps.waitFor(tabId, op.value, ms)
    if (!found) return { ok: false, reason: "timeout waiting for element", durationMs: elapsed() }
    return { ok: true, durationMs: elapsed() }
  }
  if (op.kind === "browser.new_tab") {
    if (!deps.newTab) return { ok: false, skipped: true, reason: "newTab not wired", durationMs: elapsed() }
    const newTabId = await deps.newTab(op.url)
    return { ok: true, durationMs: elapsed(), newTabId }
  }
  if (op.kind === "browser.switch_tab") {
    if (op.targetTabId == null) return { ok: false, skipped: true, reason: "switch_tab requires targetTabId", durationMs: elapsed() }
    if (!deps.switchTab) return { ok: false, skipped: true, reason: "switchTab not wired", durationMs: elapsed() }
    await deps.switchTab(op.targetTabId)
    return { ok: true, durationMs: elapsed(), newTabId: op.targetTabId }
  }
  if (op.kind === "browser.close_tab") {
    if (op.targetTabId == null) return { ok: false, skipped: true, reason: "close_tab requires targetTabId", durationMs: elapsed() }
    if (!deps.closeTab) return { ok: false, skipped: true, reason: "closeTab not wired", durationMs: elapsed() }
    const replacement = await deps.closeTab(op.targetTabId)
    // If we closed the active tab, hand the replacement back so the engine
    // re-observes the surviving tab instead of the removed one.
    const newTabId = op.targetTabId === tabId && replacement != null ? replacement : undefined
    return { ok: true, durationMs: elapsed(), newTabId }
  }
  if (op.kind === "browser.navigate") {
    if (!op.url || !/^https?:\/\//i.test(op.url)) {
      return { ok: false, skipped: true, reason: "navigate requires http(s) url", durationMs: elapsed() }
    }
    const r = await deps.runTool("navigate", { tabId, url: op.url })
    return { ...r, durationMs: elapsed() }
  }
  if (op.kind === "browser.click" || op.kind === "browser.type" || op.kind === "browser.scroll") {
    if (op.kind === "browser.scroll" && op.y != null && !op.ref) {
      const r = await deps.runTool("scroll_to", { tabId, y: op.y })
      return { ...r, durationMs: elapsed() }
    }
    const selector = resolveSelector(op, observation)
    if (!selector) {
      return { ok: false, skipped: true, reason: "ref not in observation", durationMs: elapsed() }
    }
    if (op.kind === "browser.click") {
      const r = await deps.runTool("click", { tabId, selector })
      return { ...r, selector, durationMs: elapsed() }
    }
    if (op.kind === "browser.type") {
      const r = await deps.runTool("type", { tabId, selector, value: op.value ?? "" })
      return { ...r, selector, durationMs: elapsed() }
    }
    const r = await deps.runTool("scroll_to", { tabId, selector })
    return { ...r, selector, durationMs: elapsed() }
  }
  if (op.kind === "memory.search") {
    if (!deps.recall) return { ok: false, skipped: true, reason: "memory recall not wired", durationMs: elapsed() }
    const r = await deps.recall(op.value ?? "")
    return { ok: true, durationMs: elapsed(), data: r }
  }
  if (op.kind === "memory.remember") {
    if (!deps.retain) return { ok: false, skipped: true, reason: "memory retain not wired", durationMs: elapsed() }
    await deps.retain(op.value ?? "")
    return { ok: true, durationMs: elapsed() }
  }
  if (op.kind === "session.compact") {
    return { ok: false, skipped: true, reason: "session.compact not wired", durationMs: elapsed() }
  }
  return { ok: false, skipped: true, reason: `unknown op ${op.kind}`, durationMs: elapsed() }
}

export async function executeProgram(
  initialTabId: number,
  program: Op[],
  initialObservation: ObservationLite | null | undefined,
  deps: ProgramDeps
): Promise<{ steps: StepEntry[]; finalObservation: ObservationLite | null | undefined; finalTabId: number }> {
  let observation = initialObservation
  const steps: StepEntry[] = []
  let halted = false
  let currentTabId = initialTabId

  for (const op of program) {
    if (halted) {
      const step = summarizeStep(op, { ok: false, skipped: true, reason: "halted after error" }, observation)
      steps.push(step)
      if (deps.onStep) deps.onStep(step)
      continue
    }
    const result = await runOp(op, observation, deps, currentTabId)
    if (result.newTabId != null) currentTabId = result.newTabId
    const step = summarizeStep(op, result, observation)
    steps.push(step)
    if (deps.onStep) deps.onStep(step)
    
    if (!result.ok && !result.skipped) {
      halted = true
      continue
    }
    if (op.kind === "browser.observe" && result.data) {
      observation = result.data as ObservationLite
    } else if (STRUCTURAL_OPS.has(op.kind) && result.ok && !result.skipped) {
      try {
        observation = await deps.observe(currentTabId)
      } catch {
        // The tab may have been closed or navigated out from under us
        // (e.g. close_tab with no surviving tab); keep the prior observation.
      }
    }
  }
  return { steps, finalObservation: observation, finalTabId: currentTabId }
}
