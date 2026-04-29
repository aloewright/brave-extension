export interface ExtensionInfo {
  id: string
  name: string
  description: string
  version: string
  enabled: boolean
  icons?: chrome.management.IconInfo[]
  installType: string
  homepageUrl?: string
  mayDisable: boolean
  type: string
}

export interface Profile {
  id: string
  name: string
  extensionIds: string[]
}

export interface Group {
  id: string
  name: string
  extensionIds: string[]
  enabled: boolean
}

export interface CollectedLink {
  id: string
  url: string
  title: string
  tags: string[]
  date: string
  favicon?: string
}

export interface Settings {
  notebookMode: "append" | "new"
  lastNotebookUrl?: string
  alwaysEnabled: string[]
  leanExtensionIds: string[]
  activeProfileId?: string
  browserHomeEnabled?: boolean
  leanMode?: boolean
  autoOffloadDays?: number
  autoDeleteDays?: number
}

export interface StorageSchema {
  profiles: Profile[]
  groups: Group[]
  collectedLinks: CollectedLink[]
  settings: Settings
  extensionLastUsed: Record<string, string>
}

export const DEFAULT_STORAGE: StorageSchema = {
  profiles: [],
  groups: [],
  collectedLinks: [],
  settings: {
    notebookMode: "append",
    alwaysEnabled: [],
    leanExtensionIds: [],
    browserHomeEnabled: false
  },
  extensionLastUsed: {}
}
