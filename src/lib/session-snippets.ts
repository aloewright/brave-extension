/**
 * Session snippets storage (ALO-470). Context-menu "Save highlight"
 * captures the selected text + source URL/title into chrome.storage.local
 * under SESSION_SNIPPETS_KEY. The selected text is also copied to the
 * user's clipboard via chrome.scripting.executeScript in the calling tab.
 *
 * The previous "save-highlight" context menu fed src/review.ts (the
 * Review panel under Inspector). That still exists for backward
 * compatibility, but the canonical Session feed is here.
 */
export const SESSION_SNIPPETS_KEY = "session.snippets" as const
export const SNIPPET_CAP = 500

export interface SessionSnippet {
  id: string
  text: string
  sourceUrl: string
  sourceTitle: string | null
  createdAt: number
  /**
   * "selection" — created from a context-menu "save-highlight" action.
   * Future types: "link", "page", "search" — leaving room without a
   * migration.
   */
  type: "selection"
}

function isStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local
}

export async function getSnippets(): Promise<SessionSnippet[]> {
  if (!isStorage()) return []
  const got = await chrome.storage.local.get(SESSION_SNIPPETS_KEY)
  const raw = got[SESSION_SNIPPETS_KEY]
  if (!Array.isArray(raw)) return []
  return raw as SessionSnippet[]
}

export async function addSessionSnippet(input: {
  text: string
  sourceUrl: string
  sourceTitle?: string | null
}): Promise<SessionSnippet> {
  const snippet: SessionSnippet = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `snip_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    text: input.text,
    sourceUrl: input.sourceUrl,
    sourceTitle: input.sourceTitle ?? null,
    createdAt: Date.now(),
    type: "selection"
  }
  const existing = await getSnippets()
  // Newest first; cap to prevent unbounded growth.
  const next = [snippet, ...existing].slice(0, SNIPPET_CAP)
  await chrome.storage.local.set({ [SESSION_SNIPPETS_KEY]: next })
  return snippet
}

export async function removeSnippet(id: string): Promise<void> {
  const existing = await getSnippets()
  const next = existing.filter((s) => s.id !== id)
  await chrome.storage.local.set({ [SESSION_SNIPPETS_KEY]: next })
}

export async function clearSnippets(): Promise<void> {
  await chrome.storage.local.set({ [SESSION_SNIPPETS_KEY]: [] })
}

/**
 * Subscribe to chrome.storage changes and call back with the latest list
 * whenever the snippet key changes. Returns an unsubscribe function. The
 * subscription is best-effort — if chrome.storage.onChanged is missing
 * (test environments without the shim) we just no-op.
 */
export function subscribeToSnippets(cb: (snippets: SessionSnippet[]) => void): () => void {
  if (!chrome?.storage?.onChanged) return () => {}
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ) => {
    if (area !== "local" || !(SESSION_SNIPPETS_KEY in changes)) return
    const next = changes[SESSION_SNIPPETS_KEY].newValue
    cb(Array.isArray(next) ? (next as SessionSnippet[]) : [])
  }
  chrome.storage.onChanged.addListener(listener)
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener)
    } catch {
      // ignore
    }
  }
}

/**
 * Copy a string to the clipboard from the background SW by injecting
 * `navigator.clipboard.writeText` into the active tab. Returns true on a
 * successful write; false if the tab couldn't host the script (privileged
 * URL, no permission). Never throws.
 */
export async function copyToClipboardViaTab(tabId: number, text: string): Promise<boolean> {
  try {
    if (!chrome?.scripting?.executeScript) return false
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (payload: string) => {
        return navigator.clipboard
          .writeText(payload)
          .then(() => true)
          .catch(() => false)
      },
      args: [text]
    })
    return result?.result === true
  } catch {
    return false
  }
}
