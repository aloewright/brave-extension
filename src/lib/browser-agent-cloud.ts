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
    objective: input.objective,
    cloudUse,
  }
  if (cloudUse.planning) payload.observation = input.observation
  return payload
}
