import { getSettings } from "../storage"

export const TAB_COLLECTIONS_KEY = "session.tabCollections.v1"
export const TAB_COLLECTION_LIMIT = 100

export interface SavedTab {
  id: string
  title: string
  url: string
  favIconUrl?: string
  windowId?: number
  index?: number
  pinned?: boolean
}

export interface TabCollection {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  tabs: SavedTab[]
  source: "manual-save-all"
}

function newId(prefix: string) {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function hubTabsApiUrl(id?: string) {
  const base = "https://hub.copythe.link".replace(/\/+$/, "")
  return `${base}/api/tabs/collections${id ? `/${encodeURIComponent(id)}` : ""}`
}

async function getHubToken(): Promise<string> {
  const settings = await getSettings()
  return settings.sidebarApiToken?.trim() || ""
}

async function syncCollection(collection: TabCollection): Promise<void> {
  try {
    const token = await getHubToken()
    await fetch(hubTabsApiUrl(), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}`, "X-Sidebar-Token": token } : {})
      },
      body: JSON.stringify(collection)
    })
  } catch {
    // Local storage is the recovery source of truth; Hub sync is best effort until the Tabs API exists.
  }
}

export async function getTabCollections(): Promise<TabCollection[]> {
  const result = await chrome.storage.local.get(TAB_COLLECTIONS_KEY)
  const raw = result[TAB_COLLECTIONS_KEY]
  return Array.isArray(raw) ? raw as TabCollection[] : []
}

export async function setTabCollections(collections: TabCollection[]): Promise<void> {
  await chrome.storage.local.set({
    [TAB_COLLECTIONS_KEY]: collections.slice(0, TAB_COLLECTION_LIMIT)
  })
}

export async function saveCurrentWindowTabs(title: string): Promise<TabCollection> {
  const currentWindow = await chrome.windows.getCurrent()
  const tabs = await chrome.tabs.query({ windowId: currentWindow.id })
  const now = Date.now()
  const collection: TabCollection = {
    id: newId("tabs"),
    title: title.trim() || `Tabs ${new Date(now).toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    source: "manual-save-all",
    tabs: tabs
      .filter((tab) => tab.url && !/^(chrome|chrome-extension|brave|edge|about):/i.test(tab.url))
      .map((tab) => ({
        id: newId("tab"),
        title: tab.title || tab.url || "Untitled tab",
        url: tab.url!,
        favIconUrl: tab.favIconUrl,
        windowId: tab.windowId,
        index: tab.index,
        pinned: tab.pinned
      }))
  }
  const existing = await getTabCollections()
  await setTabCollections([collection, ...existing])
  void syncCollection(collection)
  return collection
}

export async function removeTabCollection(id: string): Promise<void> {
  const existing = await getTabCollections()
  await setTabCollections(existing.filter((collection) => collection.id !== id))
  try {
    const token = await getHubToken()
    await fetch(hubTabsApiUrl(id), {
      method: "DELETE",
      credentials: "include",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}`, "X-Sidebar-Token": token } : {})
      }
    })
  } catch {
    // Best-effort remote cleanup.
  }
}

export async function openTabCollection(collection: TabCollection): Promise<void> {
  for (const tab of collection.tabs) {
    await chrome.tabs.create({ url: tab.url, active: false, pinned: Boolean(tab.pinned) })
  }
}

export async function openSavedTab(tab: SavedTab): Promise<void> {
  await chrome.tabs.create({ url: tab.url, active: true, pinned: Boolean(tab.pinned) })
}

export async function closeCurrentWindowSavedTabs(collection: TabCollection): Promise<number> {
  const currentWindow = await chrome.windows.getCurrent()
  const openTabs = await chrome.tabs.query({ windowId: currentWindow.id })
  const savedUrls = new Set(collection.tabs.map((tab) => tab.url))
  const removable = openTabs.filter((tab) => tab.id && tab.url && savedUrls.has(tab.url) && !tab.pinned)
  if (removable.length <= 1) return 0
  const active = removable.find((tab) => tab.active)
  const ids = removable
    .filter((tab) => tab.id !== active?.id)
    .map((tab) => tab.id!)
  if (ids.length) await chrome.tabs.remove(ids)
  return ids.length
}
