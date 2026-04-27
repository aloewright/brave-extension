import { useEffect, useRef, useState } from "react"

import type { ElementSnapshot, InspectorMessage, InspectorSettings } from "../types"
import { getActiveTab } from "../utils/messaging"
import { BoxModelView } from "./BoxModelView"
import { ColorFormatToggle } from "./ColorFormatToggle"
import { ColorSwatch } from "./ColorSwatch"
import { ContrastBadge } from "./ContrastBadge"
import { EmptyState } from "./EmptyState"
import { ExportPanel } from "./ExportPanel"
import { FontCard } from "./FontCard"

interface Props {
  settings: InspectorSettings
  onToast: (msg: string) => void
}

const KEEPALIVE_PORT = "alexometer-inspector-keepalive"

export function InspectTab({ settings, onToast }: Props) {
  const [active, setActive] = useState(false)
  const [hover, setHover] = useState<ElementSnapshot | null>(null)
  const [picked, setPicked] = useState<ElementSnapshot | null>(null)
  const [colorFormat, setColorFormat] = useState(settings.colorFormat)
  const tabIdRef = useRef<number | null>(null)
  const keepaliveRef = useRef<chrome.runtime.Port | null>(null)

  useEffect(() => {
    setColorFormat(settings.colorFormat)
  }, [settings.colorFormat])

  useEffect(() => {
    const listener = (message: InspectorMessage) => {
      if (message.type === "inspector:hover") setHover(message.payload)
      if (message.type === "inspector:pick") {
        setPicked(message.payload)
        setHover(null)
      }
      if (message.type === "inspector:stopped") {
        setActive(false)
        setHover(null)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      chrome.runtime.onMessage.removeListener(listener)
      // Cleanup on tab-switch / panel-close — content script tears down on
      // port disconnect.
      if (keepaliveRef.current) {
        try {
          keepaliveRef.current.disconnect()
        } catch {
          /* already gone */
        }
        keepaliveRef.current = null
      }
    }
  }, [])

  const start = async () => {
    const tab = await getActiveTab()
    if (!tab?.id) return onToast("No active tab")
    tabIdRef.current = tab.id
    chrome.tabs.sendMessage(
      tab.id,
      { type: "inspector:start" } satisfies InspectorMessage,
      (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          onToast("Reload the page and try again")
          return
        }
        // Open a keepalive port so the content script auto-tears-down when
        // this panel closes (the port disconnects automatically).
        try {
          keepaliveRef.current = chrome.tabs.connect(tab.id!, { name: KEEPALIVE_PORT })
        } catch {
          /* port couldn't open — content script will still respond to inspector:stop */
        }
        setActive(true)
      }
    )
  }

  const stop = async () => {
    if (keepaliveRef.current) {
      try {
        keepaliveRef.current.disconnect()
      } catch {
        /* already gone */
      }
      keepaliveRef.current = null
    }
    if (tabIdRef.current) {
      chrome.tabs.sendMessage(tabIdRef.current, {
        type: "inspector:stop"
      } satisfies InspectorMessage)
    }
    setActive(false)
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    onToast("Copied")
  }

  const snap = picked ?? hover
  const fg = snap?.colors.find((c) => c.kind === "color")?.value
  const bg = snap?.colors.find((c) => c.kind === "background")?.value

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        {!active ? (
          <button
            onClick={start}
            className="flex-1 text-xs py-2 px-3 rounded bg-chart-1 text-white font-medium border border-white/40 shadow-sm transition-all duration-150 hover:bg-chart-1/90 hover:border-white/70 hover:shadow-md hover:-translate-y-px active:translate-y-0 active:scale-[0.98]">
            Start inspecting
          </button>
        ) : (
          <button
            onClick={stop}
            className="flex-1 text-xs py-2 px-3 rounded bg-destructive/30 text-white font-medium border border-white/40 shadow-sm transition-all duration-150 hover:bg-destructive/40 hover:border-white/70 hover:shadow-md hover:-translate-y-px active:translate-y-0 active:scale-[0.98]">
            Stop
          </button>
        )}
        <ColorFormatToggle value={colorFormat} onChange={setColorFormat} />
      </div>

      {!snap && (
        <EmptyState
          title={active ? "Hover any element on the page" : "Click Start to inspect"}
          hint={active ? "Click to freeze · Esc to exit" : "Then hover over the page"}
        />
      )}

      {snap && (
        <>
          <div className="text-[11px] font-mono text-fg/50">
            {snap.selector} <span className="text-fg/30">·</span>{" "}
            {Math.round(snap.rect.width)}×{Math.round(snap.rect.height)}
          </div>

          <BoxModelView box={snap.box} />

          {snap.colors.length > 0 && (
            <div className="space-y-1.5">
              {snap.colors.map((c, i) => (
                <ColorSwatch
                  key={`${c.kind}-${i}`}
                  value={c.value}
                  format={colorFormat}
                  label={c.kind}
                  onCopy={copy}
                />
              ))}
            </div>
          )}

          {fg && bg && <ContrastBadge fg={fg} bg={bg} target={settings.contrastTarget} />}

          <FontCard
            family={snap.font.family}
            size={snap.font.size}
            weight={snap.font.weight}
            lineHeight={snap.font.lineHeight}
            letterSpacing={snap.font.letterSpacing}
            onCopy={copy}
          />

          {picked && <ExportPanel snapshot={picked} onCopy={copy} />}
        </>
      )}
    </div>
  )
}
