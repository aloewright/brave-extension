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
