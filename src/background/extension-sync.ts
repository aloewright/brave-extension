import { getSettings as getSidebarSettings } from "../storage"
import { createSidebarApiClient, type ExtensionSnapshotPayload } from "../lib/sidebar-api"
import { getAll as getExtensionManagerState, KEYS as LX_KEYS } from "../sections/_lx/storage"

const DEBOUNCE_MS = 5000
const LAST_PUSH_KEY = "ai-dev-sidebar-extension-last-push"
const BACKUP_INDEX_KEY = "ai-dev-sidebar-extension-backups"
const LX_WATCHED_KEYS = [
  LX_KEYS.profiles,
  LX_KEYS.groups,
  LX_KEYS.settings,
  LX_KEYS.extensionLastUsed
] as const

export interface ExtensionBackupRequest {
  id: string
  name: string
  version: string
  description?: string
  installType?: string | null
  homepageUrl?: string | null
}

export type ExtensionBackupFn = (extension: ExtensionBackupRequest) => Promise<unknown> | unknown

let timer: ReturnType<typeof setTimeout> | null = null
let inflight = false
let backupTimer: ReturnType<typeof setTimeout> | null = null

export function setupExtensionSync(opts: { backupExtension?: ExtensionBackupFn } = {}): void {
  const mgmt = (chrome as unknown as { management?: typeof chrome.management }).management
  const onManagementChanged = (info?: chrome.management.ExtensionInfo | string) => {
    scheduleSync()
    if (typeof info !== "string" && info) {
      void backupExtensionOnce(info, opts.backupExtension)
    }
  }

  mgmt?.onInstalled?.addListener?.(onManagementChanged)
  mgmt?.onUninstalled?.addListener?.(onManagementChanged)
  mgmt?.onEnabled?.addListener?.(onManagementChanged)
  mgmt?.onDisabled?.addListener?.(onManagementChanged)

  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local") return
    if (LX_WATCHED_KEYS.some((key) => key in changes)) scheduleSync()
  })

  scheduleSync()
  scheduleInstalledBackups(opts.backupExtension)
}

function scheduleSync(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void pushExtensionSnapshot()
  }, DEBOUNCE_MS)
}

function scheduleInstalledBackups(backupExtension?: ExtensionBackupFn): void {
  if (!backupExtension) return
  if (backupTimer) clearTimeout(backupTimer)
  backupTimer = setTimeout(() => {
    void backupInstalledExtensions(backupExtension)
  }, DEBOUNCE_MS)
}

export async function pushExtensionSnapshot(): Promise<{ pushed: boolean; reason?: string }> {
  if (inflight) return { pushed: false, reason: "already running" }
  inflight = true
  try {
    const settings = await getSidebarSettings()
    if (!settings.sidebarSyncEnabled) return { pushed: false, reason: "sidebar sync disabled" }
    if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
      return { pushed: false, reason: "sidebar api not configured" }
    }

    const [extensions, managerState] = await Promise.all([
      listInstalledExtensions(),
      getExtensionManagerState()
    ])
    const payload: ExtensionSnapshotPayload = {
      extensions: extensions.map(toPayload),
      profiles: managerState.profiles,
      groups: managerState.groups,
      settings: managerState.settings as unknown as Record<string, unknown>,
      lastUsed: managerState.extensionLastUsed,
      pulledAt: new Date().toISOString()
    }

    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    await client.extensions.snapshot(payload)
    await chrome.storage.local.set({ [LAST_PUSH_KEY]: Date.now() })
    return { pushed: true }
  } catch (err) {
    console.warn("[extension-sync] push failed:", (err as Error).message)
    return { pushed: false, reason: (err as Error).message }
  } finally {
    inflight = false
  }
}

async function backupInstalledExtensions(backupExtension: ExtensionBackupFn): Promise<void> {
  for (const extension of await listInstalledExtensions()) {
    await backupExtensionOnce(extension, backupExtension)
  }
}

async function backupExtensionOnce(
  extension: chrome.management.ExtensionInfo,
  backupExtension?: ExtensionBackupFn
): Promise<void> {
  if (!backupExtension || !shouldBackup(extension)) return
  const key = `${extension.id}@${extension.version}`
  const backedUp = await readBackupIndex()
  if (backedUp[key]) return

  try {
    const result = await backupExtension(toBackupRequest(extension))
    if (isBackupMiss(result)) return
    await chrome.storage.local.set({
      [BACKUP_INDEX_KEY]: {
        ...backedUp,
        [key]: {
          backedUpAt: new Date().toISOString(),
          result
        }
      }
    })
  } catch (err) {
    console.warn("[extension-sync] local extension backup failed:", (err as Error).message)
  }
}

async function readBackupIndex(): Promise<Record<string, unknown>> {
  const got = await chrome.storage.local.get(BACKUP_INDEX_KEY)
  const value = got[BACKUP_INDEX_KEY]
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

async function listInstalledExtensions(): Promise<chrome.management.ExtensionInfo[]> {
  const mgmt = (chrome as unknown as { management?: typeof chrome.management }).management
  return (await mgmt?.getAll?.()) ?? []
}

function toPayload(extension: chrome.management.ExtensionInfo): ExtensionSnapshotPayload["extensions"][number] {
  return {
    id: extension.id,
    name: extension.name,
    enabled: extension.enabled,
    type: extension.type,
    version: extension.version,
    description: extension.description,
    installType: extension.installType ?? null,
    homepageUrl: extension.homepageUrl ?? null,
    mayDisable: extension.mayDisable,
    icons: extension.icons ?? []
  }
}

function toBackupRequest(extension: chrome.management.ExtensionInfo): ExtensionBackupRequest {
  return {
    id: extension.id,
    name: extension.name,
    version: extension.version,
    description: extension.description,
    installType: extension.installType ?? null,
    homepageUrl: extension.homepageUrl ?? null
  }
}

function shouldBackup(extension: chrome.management.ExtensionInfo): boolean {
  if (!extension.id || extension.id === chrome.runtime.id) return false
  if (extension.type !== "extension" && extension.type !== "theme") return false
  return extension.installType !== "development"
}

function isBackupMiss(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === "object" &&
      "found" in result &&
      (result as { found?: unknown }).found === false
  )
}

export const __internal = { DEBOUNCE_MS, LAST_PUSH_KEY, BACKUP_INDEX_KEY }
