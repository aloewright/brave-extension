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
  // Accurate deterministic name from the page title / host — used directly when
  // AI is off/unavailable, and as the fallback whenever the AI reply is unusable.
  const metaName = metadataFilename(input)
  if (!input.settings.browserAgentCloudPlanningEnabled) return metaName
  const apiUrl = input.settings.sidebarApiUrl?.trim()
  const apiToken = input.settings.sidebarApiToken?.trim()
  if (!apiUrl || !apiToken) return metaName

  try {
    const client = createSidebarApiClient(apiToken, apiUrl)
    const response = await client.agent.chat({
      sessionId: `media-rename-${crypto.randomUUID()}`,
      message:
        `Give one short, descriptive, filesystem-safe filename (2-6 words) for this ${input.mediaKind}, based on its title/URL. Reply with ONLY the filename and extension — no explanation, no planning.`,
      objective: `Name this ${input.mediaKind} capture from its metadata.`,
      observation: {
        fallbackFilename: input.fallbackFilename,
        mediaKind: input.mediaKind,
        mimeType: input.mimeType?.slice(0, MAX_CONTEXT_CHARS),
        sourceUrl: input.sourceUrl?.slice(0, MAX_CONTEXT_CHARS),
        sourceTitle: input.sourceTitle?.slice(0, MAX_CONTEXT_CHARS),
        createdAt: input.createdAt
      },
      cloudUse: {
        // A rename is a one-shot answer, not a task to plan — planning makes the
        // agent reply with its Objective/Status/Plan narrative, which then became
        // the filename. Keep it off for this call.
        planning: false,
        vision: input.settings.browserAgentCloudVisionEnabled === true,
        ocr: input.settings.browserAgentCloudOcrEnabled === true
      }
    })
    if (!isPlausibleFilename(response.reply)) return metaName
    return sanitizeFilename(response.reply, metaName)
  } catch {
    return metaName
  }
}

/** A usable filename suggestion is short and not a sentence/plan narrative. */
export function isPlausibleFilename(reply: string): boolean {
  const r = (reply ?? "").trim()
  if (!r || r.length > 100) return false
  if (/[\r\n]/.test(r)) return false // multi-line → narrative
  if (/\b(objective|status|plan|observed|node|step\s*\d|i will|let me|here'?s)\b/i.test(r)) return false
  if (r.split(/\s+/).length > 10) return false
  return true
}

/** Deterministic name from the page title (preferred) or source host. */
export function metadataFilename(input: MediaRenameInput): string {
  const ext = extensionOf(input.fallbackFilename) || defaultExtension(input.mediaKind, input.mimeType)
  const base = (input.sourceTitle ?? "").trim() || hostOf(input.sourceUrl)
  const slug = slugify(base)
  return slug ? `${slug}${ext}` : input.fallbackFilename
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

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, " ") // drop punctuation/symbols (em-dashes, etc.)
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80)
}

function hostOf(url?: string): string {
  if (!url) return ""
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}

function defaultExtension(mediaKind: MediaRenameInput["mediaKind"], mimeType?: string): string {
  if (mimeType?.includes("pdf")) return ".pdf"
  if (mimeType?.startsWith("image/")) return `.${mimeType.slice("image/".length).split("+")[0]}`
  if (mediaKind === "image") return ".png"
  return ""
}

function extensionOf(filename: string): string {
  const match = filename.match(/\.[A-Za-z0-9]{1,8}$/)
  return match?.[0] ?? ""
}
