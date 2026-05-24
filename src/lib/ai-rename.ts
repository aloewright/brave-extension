import type { Settings } from "../types"
import { createSidebarApiClient } from "./sidebar-api"

export interface MediaRenameInput {
  settings: Settings
  fallbackFilename: string
  mediaKind: "image" | "video" | "file"
  mimeType?: string
  sourceUrl?: string
  sourceTitle?: string
  createdAt?: string
}

const MAX_CONTEXT_CHARS = 500

export async function suggestMediaFilename(input: MediaRenameInput): Promise<string> {
  if (!input.settings.browserAgentCloudPlanningEnabled) return input.fallbackFilename
  const apiUrl = input.settings.sidebarApiUrl?.trim()
  const apiToken = input.settings.sidebarApiToken?.trim()
  if (!apiUrl || !apiToken) return input.fallbackFilename

  try {
    const client = createSidebarApiClient(apiToken, apiUrl)
    const response = await client.agent.chat({
      sessionId: `media-rename-${crypto.randomUUID()}`,
      message:
        "Suggest one concise, filesystem-safe filename. Return only the filename with extension.",
      objective: `Rename this ${input.mediaKind} capture using bounded metadata only.`,
      observation: {
        fallbackFilename: input.fallbackFilename,
        mediaKind: input.mediaKind,
        mimeType: input.mimeType?.slice(0, MAX_CONTEXT_CHARS),
        sourceUrl: input.sourceUrl?.slice(0, MAX_CONTEXT_CHARS),
        sourceTitle: input.sourceTitle?.slice(0, MAX_CONTEXT_CHARS),
        createdAt: input.createdAt
      },
      cloudUse: {
        planning: true,
        vision: input.settings.browserAgentCloudVisionEnabled === true,
        ocr: input.settings.browserAgentCloudOcrEnabled === true
      }
    })
    return sanitizeFilename(response.reply, input.fallbackFilename)
  } catch {
    return input.fallbackFilename
  }
}

export function sanitizeFilename(candidate: string, fallbackFilename: string): string {
  const fallbackExtension = extensionOf(fallbackFilename)
  const cleaned = candidate
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120)
  if (!cleaned || cleaned === fallbackExtension) return fallbackFilename
  if (!extensionOf(cleaned) && fallbackExtension) return `${cleaned}${fallbackExtension}`
  return cleaned
}

function extensionOf(filename: string): string {
  const match = filename.match(/\.[A-Za-z0-9]{1,8}$/)
  return match?.[0] ?? ""
}
