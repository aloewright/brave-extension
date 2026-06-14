import { getSettings } from "../storage"
import { QUICK_LINKS_STORAGE_KEY } from "../newtab-quick-links"
import {
  APP_ICON_STORAGE_KEY,
  APP_ORDER_STORAGE_KEY,
  CUSTOM_APPS_STORAGE_KEY,
  HIDDEN_APPS_STORAGE_KEY,
  WORKSPACE_APP_STORAGE_KEYS
} from "../lib/newtab-state"
import { createSidebarApiClient, type NewTabSnapshotPayload } from "../lib/sidebar-api"

const DEBOUNCE_MS = 5000
const LAST_PUSH_KEY = "ai-dev-sidebar-newtab-last-push"
const WATCHED_KEYS = [...WORKSPACE_APP_STORAGE_KEYS, QUICK_LINKS_STORAGE_KEY] as const

let timer: ReturnType<typeof setTimeout> | null = null
let inflight = false

export function setupNewTabStateSync(): void {
  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local") return
    if (WATCHED_KEYS.some((key) => key in changes)) scheduleSync()
  })
  scheduleSync()
}

function scheduleSync(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void pushNewTabStateSnapshot()
  }, DEBOUNCE_MS)
}

export async function pushNewTabStateSnapshot(): Promise<{ pushed: boolean; reason?: string }> {
  if (inflight) return { pushed: false, reason: "already running" }
  inflight = true
  try {
    const settings = await getSettings()
    if (!settings.sidebarSyncEnabled) return { pushed: false, reason: "sidebar sync disabled" }
    if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
      return { pushed: false, reason: "sidebar api not configured" }
    }

    const stored = await chrome.storage.local.get(WATCHED_KEYS as unknown as string[])
    const payload: NewTabSnapshotPayload = {
      quickLinks: arrayValue(stored[QUICK_LINKS_STORAGE_KEY]),
      customApps: arrayValue(stored[CUSTOM_APPS_STORAGE_KEY]),
      hiddenApps: stringArrayValue(stored[HIDDEN_APPS_STORAGE_KEY]),
      appOrder: stringArrayValue(stored[APP_ORDER_STORAGE_KEY]),
      appIconOverrides: recordValue(stored[APP_ICON_STORAGE_KEY])
    }

    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    await client.newtab.snapshot(payload)
    await chrome.storage.local.set({ [LAST_PUSH_KEY]: Date.now() })
    return { pushed: true }
  } catch (err) {
    console.warn("[newtab-sync] push failed:", (err as Error).message)
    return { pushed: false, reason: (err as Error).message }
  } finally {
    inflight = false
  }
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export const __internal = { DEBOUNCE_MS, LAST_PUSH_KEY, WATCHED_KEYS }
