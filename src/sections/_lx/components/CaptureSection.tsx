export function CaptureSection() {
  const captureScreenshot = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    const dataUrl = await chrome.tabs.captureVisibleTab(undefined, { format: "png" })
    const link = document.createElement("a")
    link.href = dataUrl
    link.download = `screenshot-${Date.now()}.png`
    link.click()
  }

  const capturePdf = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    chrome.runtime.sendMessage({ type: "CAPTURE_PDF", tabId: tab.id })
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Page Capture</h2>
      <p className="text-xs text-fg/40 mb-6">Capture the currently active tab</p>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={captureScreenshot}
          className="p-6 rounded-lg bg-card border border-border hover:border-chart-1/40 transition-colors text-center group">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-fg/40 group-hover:text-chart-1 transition-colors">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span className="text-sm font-medium">Screenshot</span>
          <p className="text-[10px] text-fg/30 mt-1">Visible area as PNG</p>
        </button>

        <button
          onClick={capturePdf}
          className="p-6 rounded-lg bg-card border border-border hover:border-chart-5/40 transition-colors text-center group">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-3 text-fg/40 group-hover:text-chart-5 transition-colors">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="text-sm font-medium">Full Page PDF</span>
          <p className="text-[10px] text-fg/30 mt-1">Complete page via debugger</p>
        </button>
      </div>
    </div>
  )
}
