import type { InspectorMessage } from "../types"

export async function sendToTab<T = unknown>(tabId: number, message: InspectorMessage): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null)
        return
      }
      resolve(response as T)
    })
  })
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
