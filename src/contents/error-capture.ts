import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_start"
}

// Capture console errors and warnings, forward to background
const errors: any[] = []

const originalError = console.error
const originalWarn = console.warn

console.error = (...args: any[]) => {
  const entry = {
    level: "error" as const,
    message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    source: location.href,
    timestamp: Date.now()
  }
  errors.push(entry)
  // Forward batch every 2 seconds
  originalError.apply(console, args)
}

console.warn = (...args: any[]) => {
  const entry = {
    level: "warning" as const,
    message: args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
    source: location.href,
    timestamp: Date.now()
  }
  errors.push(entry)
  originalWarn.apply(console, args)
}

// Capture unhandled errors
window.addEventListener("error", (event) => {
  errors.push({
    level: "error" as const,
    message: event.message,
    source: event.filename,
    line: event.lineno,
    timestamp: Date.now()
  })
})

// Capture unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  errors.push({
    level: "error" as const,
    message: `Unhandled Promise Rejection: ${event.reason}`,
    source: location.href,
    timestamp: Date.now()
  })
})

// Flush errors to background periodically
setInterval(() => {
  if (errors.length > 0) {
    const batch = errors.splice(0, errors.length)
    chrome.runtime.sendMessage({ type: "PAGE_ERRORS", errors: batch }).catch(() => {})
  }
}, 2000)

// Handle messages from background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_PAGE_HTML") {
    sendResponse({
      html: document.documentElement.outerHTML,
      text: document.body.innerText
    })
  }
})

export {}
