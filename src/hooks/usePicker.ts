import type { Reference } from "../types"

// Kicks off the element picker on the given tab and resolves with the
// captured Reference (ALO-243). The Terminal section's [+ Reference]
// button (ALO-244) calls this; MCP `dom_pick` (ALO-245) reuses the same
// background entrypoint over a different transport.
export function startPicker(tabId: number): Promise<Reference> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "picker:start", tabId },
      (response: { ok: boolean; reference?: Reference; error?: string } | undefined) => {
        const lastErr = chrome.runtime.lastError?.message
        if (lastErr) return reject(new Error(lastErr))
        if (!response) return reject(new Error("no response"))
        if (!response.ok || !response.reference) {
          return reject(new Error(response.error || "picker failed"))
        }
        resolve(response.reference)
      }
    )
  })
}

export function cancelPicker(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "picker:cancel", tabId }, () => {
      void chrome.runtime.lastError
      resolve()
    })
  })
}
