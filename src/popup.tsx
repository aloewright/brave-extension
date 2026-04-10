import { useEffect, useState } from "react"
import "./style.css"

interface RecordingState {
  active: boolean
  tabId: number | null
  startedAt: number | null
  lastUpload: { key?: string; url?: string; size: number; at: number } | null
  lastError: string | null
}

function formatElapsed(startedAt: number): string {
  const sec = Math.floor((Date.now() - startedAt) / 1000)
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Popup() {
  const [state, setState] = useState<RecordingState | null>(null)
  const [tick, setTick] = useState(0)

  // Fetch current recording state on mount, then poll once per second for
  // the timer display.
  useEffect(() => {
    const fetchState = () =>
      chrome.runtime.sendMessage({ type: "GET_RECORDING_STATE" }, (res) => {
        if (res?.state) setState(res.state)
      })
    fetchState()
    const t = setInterval(() => {
      setTick((x) => x + 1)
      fetchState()
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const openSidebar = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId })
    }
    window.close()
  }

  const startRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return
    chrome.runtime.sendMessage(
      { type: "START_RECORDING", tabId: tab.id },
      () => {
        window.close()
      }
    )
  }

  const stopRecording = () => {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, () => {
      // Leave the popup open so the user sees the upload confirmation
    })
  }

  // Recording view
  if (state?.active) {
    return (
      <div className="w-[240px] bg-bg text-fg p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-semibold text-red-400">Recording</span>
        </div>
        <div className="text-[11px] text-fg/50 mb-3 font-mono">
          {state.startedAt ? formatElapsed(state.startedAt) : "0:00"}
          {/* tick forces rerender */}
          <span className="hidden">{tick}</span>
        </div>
        <button
          onClick={stopRecording}
          className="w-full text-xs py-2 px-4 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
        >
          Stop Recording
        </button>
        <div className="text-[9px] text-fg/30 mt-2">
          Saves to cloudos-media/recordings
        </div>
      </div>
    )
  }

  // Idle view (with most recent upload, if any)
  return (
    <div className="w-[240px] bg-bg text-fg p-4 text-center">
      <div className="text-sm font-medium mb-2">AI Dev Sidebar</div>
      <div className="text-[11px] text-fg/50 mb-3">
        Open the sidebar to chat with your local AI CLI tools
      </div>
      <button
        onClick={openSidebar}
        className="w-full text-xs py-2 px-4 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors mb-2"
      >
        Open Sidebar
      </button>
      <button
        onClick={startRecording}
        className="w-full text-xs py-2 px-4 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
      >
        Record Tab
      </button>
      {state?.lastUpload && (
        <div className="text-[10px] text-fg/40 mt-3 leading-tight">
          Last saved: {formatBytes(state.lastUpload.size)}
          <br />
          <span className="font-mono break-all text-fg/30">
            {state.lastUpload.key}
          </span>
        </div>
      )}
      {state?.lastError && (
        <div className="text-[10px] text-red-400/80 mt-3 leading-tight">
          {state.lastError}
        </div>
      )}
      <div className="text-[9px] text-fg/30 mt-2">Alt+Shift+A</div>
    </div>
  )
}

export default Popup
