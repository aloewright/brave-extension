import type { Settings, ChatMessage, PageInspection, CLIBackend } from "./types"

const KEYS = {
  settings: "ai-dev-settings",
  // Legacy single-array key — migrated to per-backend shards on first read
  legacyMessages: "ai-dev-messages",
  inspections: "ai-dev-inspections",
  scrapes: "ai-dev-scrapes"
}

const BACKENDS: CLIBackend[] = ["claude", "gemini", "copilot", "codex"]

function messageKey(backend: CLIBackend): string {
  return `ai-dev-messages-${backend}`
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(KEYS.settings)
  return { ...defaultSettings(), ...result[KEYS.settings] }
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await chrome.storage.local.set({ [KEYS.settings]: { ...current, ...settings } })
}

/**
 * Get all messages across all backends, sorted by timestamp.
 * Performs a one-time migration from the legacy single-array format.
 */
export async function getMessages(): Promise<ChatMessage[]> {
  const keys = [KEYS.legacyMessages, ...BACKENDS.map(messageKey)]
  const result = await chrome.storage.local.get(keys)

  // Migrate legacy single-array format if present
  const legacy: ChatMessage[] | undefined = result[KEYS.legacyMessages]
  if (legacy && legacy.length > 0) {
    const grouped: Record<string, ChatMessage[]> = {}
    for (const m of legacy) {
      const b = m.backend || "claude"
      if (!grouped[messageKey(b)]) grouped[messageKey(b)] = []
      grouped[messageKey(b)].push(m)
    }
    // Merge with any existing per-backend data
    for (const key of Object.keys(grouped)) {
      const existing: ChatMessage[] = result[key] || []
      grouped[key] = [...existing, ...grouped[key]].sort((a, b) => a.timestamp - b.timestamp)
    }
    await chrome.storage.local.set(grouped)
    await chrome.storage.local.remove(KEYS.legacyMessages)
    // Re-fetch after migration
    return getMessages()
  }

  // Concatenate all backend shards and sort
  const all: ChatMessage[] = []
  for (const backend of BACKENDS) {
    const shard: ChatMessage[] = result[messageKey(backend)] || []
    all.push(...shard)
  }
  all.sort((a, b) => a.timestamp - b.timestamp)
  return all
}

/**
 * Get messages for a specific backend.
 */
export async function getMessagesForBackend(backend: CLIBackend): Promise<ChatMessage[]> {
  const result = await chrome.storage.local.get(messageKey(backend))
  return result[messageKey(backend)] || []
}

/**
 * Append a message to its backend's shard. No cap.
 */
export async function addMessage(message: ChatMessage): Promise<void> {
  const backend: CLIBackend = message.backend || "claude"
  const key = messageKey(backend)
  const result = await chrome.storage.local.get(key)
  const existing: ChatMessage[] = result[key] || []
  existing.push(message)
  await chrome.storage.local.set({ [key]: existing })
}

/**
 * Replace all messages (used by setMessages — kept for API compatibility).
 * Re-shards by backend.
 */
export async function setMessages(messages: ChatMessage[]): Promise<void> {
  const grouped: Record<string, ChatMessage[]> = {}
  for (const backend of BACKENDS) grouped[messageKey(backend)] = []
  for (const m of messages) {
    const key = messageKey(m.backend || "claude")
    grouped[key].push(m)
  }
  await chrome.storage.local.set(grouped)
}

/**
 * Clear messages: pass a backend to wipe just that backend, or omit to wipe all.
 */
export async function clearMessages(backend?: CLIBackend): Promise<void> {
  if (backend) {
    await chrome.storage.local.set({ [messageKey(backend)]: [] })
    return
  }
  const grouped: Record<string, ChatMessage[]> = {}
  for (const b of BACKENDS) grouped[messageKey(b)] = []
  await chrome.storage.local.set(grouped)
}

export async function getInspections(): Promise<PageInspection[]> {
  const result = await chrome.storage.local.get(KEYS.inspections)
  return result[KEYS.inspections] || []
}

export async function addInspection(inspection: PageInspection): Promise<void> {
  const current = await getInspections()
  await chrome.storage.local.set({
    [KEYS.inspections]: [inspection, ...current].slice(0, 50)
  })
}

function defaultSettings(): Settings {
  return {
    backend: "claude",
    workingDirectory: "~",
    claudeConfigPath: "~/.claude.json",
    autoScrape: false,
    captureConsole: true,
    captureNetwork: false,
    theme: "dark",
    cloudosSyncEnabled: false,
    cloudosNotesUrl: "https://notes.pdx.software/api/notes",
    cloudosServiceToken: "",
    cloudosPruneAfterSync: false
  }
}
