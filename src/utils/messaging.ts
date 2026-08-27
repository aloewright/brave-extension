import type { InspectorMessage } from "../types"

const SCANNER_SCRIPT = "content/scanner.js"

type TabMessageAttempt<T> = {
  response: T | null
  error: string | null
}

async function sendToTabAttempt<T>(
  tabId: number,
  message: InspectorMessage
): Promise<TabMessageAttempt<T>> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError?.message ?? null
      if (error) {
        resolve({ response: null, error })
        return
      }
      resolve({ response: response == null ? null : (response as T), error: null })
    })
  })
}

export async function sendToTab<T = unknown>(tabId: number, message: InspectorMessage): Promise<T | null> {
  return (await sendToTabAttempt<T>(tabId, message)).response
}

function isMissingReceiverError(error: string | null): boolean {
  return Boolean(error && /receiving end does not exist/i.test(error))
}

/**
 * Send a scanner command, repairing the common stale-tab case where the
 * extension was installed or reloaded after the page finished loading.
 * Manifest content scripts are not retroactively added to those tabs, so the
 * first message has no receiver. Inject the built scanner and retry once.
 */
export async function sendToScanner<T = unknown>(
  tabId: number,
  message: InspectorMessage
): Promise<T | null> {
  const firstAttempt = await sendToTabAttempt<T>(tabId, message)
  if (firstAttempt.response !== null) return firstAttempt.response
  if (!isMissingReceiverError(firstAttempt.error)) return null
  if (!chrome.scripting?.executeScript) return null

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [SCANNER_SCRIPT]
    })
  } catch {
    // Restricted pages (chrome://, Web Store, PDF viewer) cannot be injected.
    return null
  }

  return sendToTab<T>(tabId, message)
}

export async function sendToRuntime<T = unknown>(message: InspectorMessage): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve(response as T)
    })
  })
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}
