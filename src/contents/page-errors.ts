import { normalizeConsoleEntry } from "../lib/console-errors"

const errors: any[] = []

window.addEventListener("error", (event) => {
  const entry = normalizeConsoleEntry({
    level: "error",
    message: event.message,
    source: event.filename,
    line: event.lineno,
    timestamp: Date.now()
  })

  if (entry) errors.push(entry)
})

window.addEventListener("unhandledrejection", (event) => {
  const entry = normalizeConsoleEntry({
    level: "error",
    message: `Unhandled Promise Rejection: ${String(event.reason)}`,
    source: location.href,
    timestamp: Date.now()
  })

  if (entry) errors.push(entry)
})

setInterval(() => {
  if (errors.length > 0) {
    const batch = errors.splice(0, errors.length)
    try {
      chrome.runtime?.sendMessage?.({ type: "PAGE_ERRORS", errors: batch }).catch(() => {})
    } catch {
      // Extension context can be invalidated while Brave reloads the unpacked
      // extension. Drop this batch instead of making the collector the error.
    }
  }
}, 2000)

try {
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message.type === "GET_PAGE_HTML") {
      sendResponse({
        html: document.documentElement.outerHTML,
        text: document.body.innerText
      })
    }
  })
} catch {
  // Same reload boundary as above: content-script diagnostics should be best-effort.
}

export {}
