import type { Settings } from "../types"

export interface BrowserAgentCloudUse {
  planning: boolean
  vision: boolean
  ocr: boolean
}

export interface BrowserAgentCloudChatInput {
  settings: Pick<
    Settings,
    | "browserAgentCloudPlanningEnabled"
    | "browserAgentCloudVisionEnabled"
    | "browserAgentCloudOcrEnabled"
  >
  sessionId: string
  message: string
  objective?: string
  observation?: unknown
}

export interface BrowserAgentCloudChatPayload {
  sessionId: string
  message: string
  objective?: string
  observation?: unknown
  cloudUse: BrowserAgentCloudUse
}

const MAX_VISIBLE_TEXT_CHARS = 4_000
const MAX_NODE_TEXT_CHARS = 500
const MAX_NODES = 50

export function browserAgentCloudUseFromSettings(
  settings: BrowserAgentCloudChatInput["settings"],
): BrowserAgentCloudUse {
  return {
    planning: settings.browserAgentCloudPlanningEnabled === true,
    vision: settings.browserAgentCloudVisionEnabled === true,
    ocr: settings.browserAgentCloudOcrEnabled === true,
  }
}

export function buildBrowserAgentCloudChatPayload(
  input: BrowserAgentCloudChatInput,
): BrowserAgentCloudChatPayload {
  const cloudUse = browserAgentCloudUseFromSettings(input.settings)
  const payload: BrowserAgentCloudChatPayload = {
    sessionId: input.sessionId,
    message: input.message,
    cloudUse,
  }
  if (input.objective !== undefined) payload.objective = input.objective
  const boundedObservation = buildBoundedObservation(input.observation)
  if (cloudUse.planning && boundedObservation) payload.observation = boundedObservation
  return payload
}

function buildBoundedObservation(observation: unknown): Record<string, unknown> | undefined {
  if (!observation || typeof observation !== "object" || Array.isArray(observation)) return undefined
  const src = observation as Record<string, unknown>
  const nodes = Array.isArray(src.nodes)
    ? src.nodes.slice(0, MAX_NODES).map((node) => boundNode(node))
    : undefined
  return {
    ...(typeof src.url === "string" ? { url: src.url } : {}),
    ...(typeof src.title === "string" ? { title: src.title } : {}),
    ...(typeof src.visibleText === "string"
      ? { visibleText: src.visibleText.slice(0, MAX_VISIBLE_TEXT_CHARS) }
      : {}),
    ...(nodes ? { nodes } : {}),
    ...(src.limits && typeof src.limits === "object" && !Array.isArray(src.limits)
      ? { limits: src.limits }
      : {}),
  }
}

function boundNode(node: unknown): Record<string, unknown> {
  if (!node || typeof node !== "object" || Array.isArray(node)) return {}
  const src = node as Record<string, unknown>
  return {
    ...(typeof src.ref === "string" ? { ref: src.ref } : {}),
    ...(typeof src.role === "string" ? { role: src.role } : {}),
    ...(typeof src.name === "string" ? { name: src.name.slice(0, MAX_NODE_TEXT_CHARS) } : {}),
    ...(typeof src.text === "string" ? { text: src.text.slice(0, MAX_NODE_TEXT_CHARS) } : {}),
    ...(typeof src.selector === "string" ? { selector: src.selector } : {}),
    ...(src.rect && typeof src.rect === "object" && !Array.isArray(src.rect) ? { rect: src.rect } : {}),
    ...(src.state && typeof src.state === "object" && !Array.isArray(src.state) ? { state: src.state } : {}),
  }
}
