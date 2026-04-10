import { useState, useEffect, useRef, useCallback } from "react"
import "./style.css"
import { useNativeHost } from "./hooks/useNativeHost"
import { useSettings } from "./hooks/useSettings"
import { useCloudosSync } from "./hooks/useCloudosSync"
import { VirtualizedChat } from "./components/VirtualizedChat"
import { InspectorPanel } from "./components/InspectorPanel"
import { SettingsPanel } from "./components/SettingsPanel"
import { BackendSwitcher } from "./components/BackendSwitcher"
import { ReviewPanel } from "./components/ReviewPanel"
import type { ChatMessage, CLIBackend, PageInspection, ConsoleError, ScrapeResult, MCPServer } from "./types"
import { addMessage, getMessages, clearMessages } from "./storage"

type Panel = "chat" | "inspector" | "settings" | "review"

function SidePanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [panel, setPanel] = useState<Panel>("chat")
  const [isRunning, setIsRunning] = useState(false)
  const [activePid, setActivePid] = useState<number | null>(null)
  const [inspection, setInspection] = useState<PageInspection | null>(null)
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([])
  const [scrapeData, setScrapeData] = useState<ScrapeResult | null>(null)
  const [streamBuffer, setStreamBuffer] = useState("")
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])

  const { settings, update: updateSettings } = useSettings()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cloudosSync = useCloudosSync({ settings, messages })

  // Filter messages to only show ones for the active backend
  const visibleMessages = settings
    ? messages.filter((m) => !m.backend || m.backend === settings.backend)
    : messages

  // Load messages on mount
  useEffect(() => {
    getMessages().then(setMessages)
  }, [])

  const appendMessage = useCallback(async (msg: ChatMessage) => {
    await addMessage(msg)
    setMessages((prev) => [...prev, msg])
  }, [])

  const nativeHost = useNativeHost({
    onStdout: (data, pid) => {
      setStreamBuffer((prev) => prev + data)
    },
    onStderr: (data, pid) => {
      setStreamBuffer((prev) => prev + data)
    },
    onExit: async (code, pid) => {
      setIsRunning(false)
      setActivePid(null)
      // Finalize the streamed response
      setStreamBuffer((buf) => {
        if (buf.trim()) {
          const msg: ChatMessage = {
            id: crypto.randomUUID(),
            role: code === 0 ? "assistant" : "error",
            content: buf,
            timestamp: Date.now(),
            backend: settings?.backend
          }
          addMessage(msg)
          setMessages((prev) => [...prev, msg])
        }
        return ""
      })
    },
    onError: async (error) => {
      setIsRunning(false)
      setActivePid(null)
      await appendMessage({
        id: crypto.randomUUID(),
        role: "error",
        content: error,
        timestamp: Date.now(),
        backend: settings?.backend
      })
    },
    onMcpList: (servers) => {
      setMcpServers(servers as MCPServer[])
    },
    onSessionReset: (backend) => {
      appendMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `Session reset — next message will start a new conversation`,
        timestamp: Date.now(),
        backend
      })
    },
    onScrape: (result: ScrapeResult) => {
      setScrapeData(result)
      appendMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `Scraped: ${result.title}\n${result.text.slice(0, 200)}...`,
        timestamp: Date.now(),
        backend: settings?.backend
      })
    },
    onInspect: (result: PageInspection) => {
      setInspection(result)
      setPanel("inspector")
    },
    onSelection: (data: { text: string; url: string }) => {
      setInput((prev) => prev + (prev ? "\n" : "") + data.text)
      inputRef.current?.focus()
    }
  } as any)

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isRunning || !settings) return

    setInput("")
    inputRef.current?.focus()

    // Add user message
    await appendMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
      backend: settings.backend
    })

    // Check for special commands
    if (text.startsWith("!")) {
      // Raw terminal command
      const rawCmd = text.slice(1).trim()
      setIsRunning(true)
      setStreamBuffer("")
      nativeHost.execRaw(rawCmd, [], settings.workingDirectory)
      return
    }

    if (text.startsWith("/inspect")) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.runtime.sendMessage({ type: "INSPECT_TAB", tabId: tab.id }, (result) => {
          setInspection(result)
          setPanel("inspector")
        })
      }
      return
    }

    if (text.startsWith("/scrape")) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.runtime.sendMessage({ type: "SCRAPE_TAB", tabId: tab.id }, (result) => {
          setScrapeData(result)
          appendMessage({
            id: crypto.randomUUID(),
            role: "system",
            content: `Scraped: ${result.title}\nText: ${result.text?.slice(0, 300)}...\nLinks: ${result.links?.length || 0}\nImages: ${result.images?.length || 0}`,
            timestamp: Date.now(),
            backend: settings.backend
          })
        })
      }
      return
    }

    if (text.startsWith("/cd ")) {
      const dir = text.slice(4).trim()
      updateSettings({ workingDirectory: dir })
      await appendMessage({
        id: crypto.randomUUID(),
        role: "system",
        content: `Working directory set to: ${dir}`,
        timestamp: Date.now(),
        backend: settings.backend
      })
      return
    }

    if (text === "/clear") {
      // Clear only messages for the active backend
      await clearMessages(settings.backend)
      setMessages((prev) => prev.filter((m) => m.backend !== settings.backend))
      return
    }

    if (text === "/errors") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        chrome.runtime.sendMessage({ type: "GET_CONSOLE_ERRORS", tabId: tab.id }, (result) => {
          if (result.errors?.length) {
            setConsoleErrors(result.errors)
            setPanel("inspector")
          } else {
            appendMessage({
              id: crypto.randomUUID(),
              role: "system",
              content: "No console errors captured for this tab.",
              timestamp: Date.now(),
              backend: settings.backend
            })
          }
        })
      }
      return
    }

    // Prepend scrape context if available
    let prompt = text
    if (scrapeData && text.toLowerCase().includes("page")) {
      prompt = `[Context: Current page "${scrapeData.title}" at ${scrapeData.url}]\n\n${text}`
    }

    // Send to CLI backend
    setIsRunning(true)
    setStreamBuffer("")
    nativeHost.exec(prompt, settings.backend, settings.workingDirectory)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleStop = () => {
    if (activePid) {
      nativeHost.kill(activePid)
    }
    setIsRunning(false)
    setActivePid(null)
  }

  const handleClearScreen = async () => {
    if (!settings) return
    // Insert a "clear" marker — renders as a viewport-height spacer
    // pushing existing history above the visible area. Scroll up to see it.
    // The virtualizer auto-scrolls to the new bottom on items.length change.
    await appendMessage({
      id: crypto.randomUUID(),
      role: "clear",
      content: "",
      timestamp: Date.now(),
      backend: settings.backend
    })
  }

  if (!settings) {
    return (
      <div className="w-full h-screen bg-bg flex items-center justify-center">
        <div className="text-fg/50 text-sm">Loading...</div>
      </div>
    )
  }

  if (panel === "inspector") {
    return (
      <InspectorPanel
        inspection={inspection}
        consoleErrors={consoleErrors}
        onClose={() => setPanel("chat")}
        onSendToChat={(text) => {
          setInput(text)
          setPanel("chat")
          inputRef.current?.focus()
        }}
      />
    )
  }

  if (panel === "settings") {
    return (
      <SettingsPanel
        settings={settings}
        onUpdate={updateSettings}
        onClose={() => setPanel("chat")}
        nativeHost={nativeHost}
        mcpServers={mcpServers}
        cloudosSync={cloudosSync}
      />
    )
  }

  if (panel === "review") {
    return <ReviewPanel onClose={() => setPanel("chat")} />
  }

  return (
    <div className="w-full h-screen bg-bg text-fg font-sans flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${nativeHost.connected ? "bg-success" : "bg-error"}`} />
          <span className="text-[11px] text-fg/50 truncate font-mono">
            {settings.workingDirectory}
          </span>
        </div>

        <button
          onClick={handleClearScreen}
          title="Clear screen (history preserved — scroll up to see)"
          className="p-1.5 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="12" y1="11" x2="12" y2="17" /><line x1="9" y1="14" x2="15" y2="14" />
          </svg>
        </button>

        <button
          onClick={async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab?.id) {
              chrome.runtime.sendMessage({ type: "INSPECT_TAB", tabId: tab.id }, (result) => {
                setInspection(result)
                setPanel("inspector")
              })
            }
          }}
          title="Inspect page"
          className="p-1.5 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </button>

        <button
          onClick={async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (tab?.id) {
              chrome.runtime.sendMessage({ type: "SCRAPE_TAB", tabId: tab.id }, (result) => {
                setScrapeData(result)
                appendMessage({
                  id: crypto.randomUUID(),
                  role: "system",
                  content: `Scraped: ${result.title} (${result.links?.length || 0} links, ${result.images?.length || 0} images)`,
                  timestamp: Date.now(),
                  backend: settings.backend
                })
              })
            }
          }}
          title="Scrape page"
          className="p-1.5 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>

        <button
          onClick={async () => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id) return
            chrome.runtime.sendMessage(
              { type: "START_RECORDING", tabId: tab.id },
              (result) => {
                if (result?.ok) {
                  // Close the side panel — the red badge on the extension
                  // icon becomes the only recording indicator. User clicks
                  // the icon again (opens popup) to stop.
                  window.close()
                } else if (result?.error) {
                  console.warn("Recording failed to start:", result.error)
                }
              }
            )
          }}
          title="Record tab — saves to media storage"
          className="p-1.5 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="8" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        </button>

        <button
          onClick={() => setPanel("review")}
          title="Review highlights"
          className="p-1.5 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </button>

        <button
          onClick={() => setPanel("settings")}
          title="Settings"
          className="p-1.5 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>

      {/* Backend Switcher */}
      <div className="px-3 py-1.5 border-b border-border">
        <BackendSwitcher
          active={settings.backend}
          onChange={(backend) => updateSettings({ backend })}
          onReset={(backend) => {
            nativeHost.resetBackend(backend)
            setStreamBuffer("")
            setIsRunning(false)
          }}
        />
      </div>

      {/* Messages — virtualized */}
      <VirtualizedChat
        messages={visibleMessages}
        streamBuffer={streamBuffer || undefined}
        streamBackend={settings.backend}
        isLoading={isRunning && !streamBuffer.trim()}
        loadingBackend={settings.backend}
        emptyState={
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="text-fg/20 text-2xl mb-3">AI Dev</div>
            <div className="text-fg/30 text-xs space-y-1">
              <div>Type a message to chat with <span className="font-medium">{settings.backend}</span></div>
              <div className="text-[10px] text-fg/20 mt-3 space-y-0.5">
                <div><span className="font-mono text-fg/30">!</span>command — run terminal commands</div>
                <div><span className="font-mono text-fg/30">/inspect</span> — inspect current page</div>
                <div><span className="font-mono text-fg/30">/scrape</span> — scrape page content</div>
                <div><span className="font-mono text-fg/30">/errors</span> — view console errors</div>
                <div><span className="font-mono text-fg/30">/cd</span> path — change directory</div>
                <div><span className="font-mono text-fg/30">/clear</span> — clear chat</div>
              </div>
            </div>
          </div>
        }
      />

      {/* Input */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${settings.backend}... (Shift+Enter for newline)`}
            rows={1}
            className="flex-1 text-xs py-2 px-3 rounded-lg bg-input border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 resize-none min-h-[36px] max-h-[120px] font-mono transition-colors"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.target as HTMLTextAreaElement
              el.style.height = "auto"
              el.style.height = Math.min(el.scrollHeight, 120) + "px"
            }}
          />

          {isRunning ? (
            <button
              onClick={handleStop}
              className="p-2 rounded-lg bg-error/20 text-error hover:bg-error/30 transition-colors flex-shrink-0"
              title="Stop"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title="Send"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default SidePanel
