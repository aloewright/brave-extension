// Full-page PDF capture via the Chrome DevTools Protocol (Page.printToPDF).
// Requires the "debugger" permission (already declared in the manifest).

const DEBUGGER_VERSION = "1.3"

/** Decode a base64 string to bytes (CDP returns the PDF as base64). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sendCommand<T>(
  target: chrome.debugger.Debuggee,
  method: string,
  params?: Record<string, unknown>
): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params ?? {}, (result) => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve(result as T)
    })
  })
}

function attach(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, DEBUGGER_VERSION, () => {
      const err = chrome.runtime.lastError
      if (err) reject(new Error(err.message))
      else resolve()
    })
  })
}

function detach(target: chrome.debugger.Debuggee): Promise<void> {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => resolve())
  })
}

/**
 * Capture the full page of `tabId` as a PDF, returned as base64. Throws a clear
 * error on pages where the debugger can't attach (chrome://, Web Store, the PDF
 * viewer). Always detaches the debugger.
 */
export async function captureFullPagePdf(tabId: number): Promise<string> {
  const target: chrome.debugger.Debuggee = { tabId }
  try {
    await attach(target)
  } catch (err) {
    throw new Error(
      `Can't capture this page as PDF (${err instanceof Error ? err.message : String(err)}). ` +
        `Restricted pages like chrome://, the Web Store, and the PDF viewer aren't supported.`
    )
  }
  try {
    await sendCommand(target, "Page.enable")
    const res = await sendCommand<{ data: string }>(target, "Page.printToPDF", {
      printBackground: true,
      transferMode: "ReturnAsBase64"
    })
    if (!res?.data) throw new Error("printToPDF returned no data")
    return res.data
  } finally {
    await detach(target)
  }
}
