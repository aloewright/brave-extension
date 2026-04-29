import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useReferences } from "../../hooks/useReferences"
import { startPicker } from "../../hooks/usePicker"
import { ReferencesTray } from "./ReferencesTray"
import { TerminalView } from "./Terminal"

interface Tab {
  sessionId: string
  pid?: number
  status: "spawning" | "running" | "exited" | "error"
  exitInfo?: string
}

function newSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return `pty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function TerminalSection() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<string | null>(null)

  const dataSinks = useRef(new Map<string, (data: string) => void>())

  const registerData = useCallback(
    (sessionId: string, sink: (data: string) => void) => {
      dataSinks.current.set(sessionId, sink)
    },
    []
  )

  const unregisterData = useCallback((sessionId: string) => {
    dataSinks.current.delete(sessionId)
  }, [])

  const host = useNativeHost({
    onPtyData: (sessionId, data) => {
      dataSinks.current.get(sessionId)?.(data)
    },
    onPtySpawned: (sessionId, pid) => {
      setTabs((prev) =>
        prev.map((t) => (t.sessionId === sessionId ? { ...t, pid, status: "running" } : t))
      )
    },
    onPtyExit: (sessionId, exitCode, signal) => {
      const sink = dataSinks.current.get(sessionId)
      sink?.(
        `\r\n\x1b[2m[process exited code=${exitCode}${signal ? ` signal=${signal}` : ""}]\x1b[0m\r\n`
      )
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === sessionId
            ? { ...t, status: "exited", exitInfo: `code ${exitCode}` }
            : t
        )
      )
    },
    onPtyError: (sessionId, error) => {
      const sink = sessionId ? dataSinks.current.get(sessionId) : undefined
      sink?.(`\r\n\x1b[31m[pty error] ${error}\x1b[0m\r\n`)
      if (sessionId) {
        setTabs((prev) =>
          prev.map((t) => (t.sessionId === sessionId ? { ...t, status: "error", exitInfo: error } : t))
        )
      }
    }
  })

  const resourceSync = useMemo(
    () => ({
      upsert: (uri: string, def: { name: string; description?: string; mimeType?: string; payload?: unknown }) =>
        host.mcpResourceUpsert(uri, def),
      remove: (uri: string) => host.mcpResourceRemove(uri)
    }),
    [host]
  )
  const references = useReferences(resourceSync)

  const [pickerBusy, setPickerBusy] = useState(false)
  const onAddReference = useCallback(async () => {
    if (pickerBusy) return
    setPickerBusy(true)
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      const tab = tabs[0]
      if (!tab?.id) throw new Error("no active tab")
      const ref = await startPicker(tab.id)
      await references.add(ref)
    } catch (err) {
      // Picker rejected (user cancelled, no tab, etc.) — surface in console;
      // a richer toast UX lives outside this milestone.
      console.warn("[references] picker failed:", err)
    } finally {
      setPickerBusy(false)
    }
  }, [pickerBusy, references])

  const openTab = useCallback(() => {
    if (!host.connected) return
    const sessionId = newSessionId()
    setTabs((prev) => [...prev, { sessionId, status: "spawning" }])
    setActive(sessionId)
    host.ptySpawn(sessionId)
  }, [host])

  const closeTab = useCallback(
    (sessionId: string) => {
      host.ptyKill(sessionId)
      setTabs((prev) => {
        const next = prev.filter((t) => t.sessionId !== sessionId)
        if (active === sessionId) {
          setActive(next.length ? next[next.length - 1].sessionId : null)
        }
        return next
      })
    },
    [host, active]
  )

  useEffect(() => {
    return () => {
      // Sidepanel closing — kill all sessions.
      for (const t of tabs) host.ptyKill(t.sessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === "t") {
        e.preventDefault()
        openTab()
      } else if (e.key === "w" && active) {
        e.preventDefault()
        closeTab(active)
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1
        if (tabs[idx]) {
          e.preventDefault()
          setActive(tabs[idx].sessionId)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [active, tabs, openTab, closeTab])

  // The header bar (with [+ Reference]) and the references tray are rendered
  // unconditionally so users can capture/inspect references even before they
  // open a terminal. The tab strip and `+ new tab` button only appear once at
  // least one tab exists; the body switches between empty state and grid.
  const hasTabs = tabs.length > 0

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center border-b border-border bg-bg/60">
        <div className="flex-1 flex items-center overflow-x-auto">
          {hasTabs ? (
            tabs.map((t, i) => {
              const isActive = t.sessionId === active
              return (
                <div
                  key={t.sessionId}
                  onClick={() => setActive(t.sessionId)}
                  className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer border-r border-border ${
                    isActive ? "bg-bg text-fg" : "text-fg/50 hover:text-fg/80"
                  }`}>
                  <span className="font-mono">{i + 1}</span>
                  <span>{t.status === "running" ? "shell" : t.status}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(t.sessionId)
                    }}
                    className="text-fg/30 hover:text-fg/80"
                    title="Close tab">
                    ×
                  </button>
                </div>
              )
            })
          ) : (
            <span className="px-3 py-1.5 text-fg/40 text-[11px]">Terminal</span>
          )}
        </div>
        <button
          onClick={onAddReference}
          disabled={pickerBusy}
          title="Capture an element from the active tab as a reference"
          className="px-2 py-1.5 text-fg/50 hover:text-fg text-[11px] border-l border-border disabled:opacity-50">
          {pickerBusy ? "Picking…" : "+ Reference"}
        </button>
        {hasTabs && (
          <button
            onClick={openTab}
            title="New tab (⌘T)"
            className="px-3 py-1.5 text-fg/40 hover:text-fg text-sm border-l border-border">
            +
          </button>
        )}
      </div>
      <div className="relative flex-1 min-h-0">
        {hasTabs ? (
          tabs.map((t) => (
            <TerminalView
              key={t.sessionId}
              sessionId={t.sessionId}
              active={t.sessionId === active}
              onWrite={(data) => host.ptyWrite(t.sessionId, data)}
              onResize={(cols, rows) => host.ptyResize(t.sessionId, cols, rows)}
              registerData={registerData}
              unregisterData={unregisterData}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
            <div className="text-fg/30 text-lg font-medium">Terminal</div>
            {host.connected ? (
              <button
                onClick={openTab}
                className="px-4 py-2 rounded bg-primary/20 text-primary hover:bg-primary/30 text-xs">
                Open Terminal
              </button>
            ) : (
              <div className="text-fg/40 text-xs max-w-xs leading-relaxed">
                Native host not connected. Run{" "}
                <code className="font-mono text-fg/60">pnpm install-host</code> and reload Brave.
              </div>
            )}
            <div className="text-[10px] text-fg/30 mt-2">⌘T new tab · ⌘W close · ⌘1–9 switch</div>
          </div>
        )}
      </div>
      <ReferencesTray
        references={references.references}
        onRemove={references.remove}
        onClear={references.clear}
      />
    </div>
  )
}
