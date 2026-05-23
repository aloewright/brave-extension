import { useEffect, useState } from "react"

import { getInspectorSettings } from "../storage"
import {
  DEFAULT_INSPECTOR_SETTINGS,
  type ConsoleError,
  type InspectorSettings
} from "../types"
import { InspectTab } from "./InspectTab"
import { ScanTab } from "./ScanTab"

type Tab = "inspect" | "scan" | "console"

interface Props {
  consoleErrors: ConsoleError[]
  onClose: () => void
  onSendToChat: (text: string) => void
}

export function InspectorPanel({ consoleErrors, onClose, onSendToChat }: Props) {
  const [tab, setTab] = useState<Tab>("inspect")
  const [settings, setSettings] = useState<InspectorSettings>(DEFAULT_INSPECTOR_SETTINGS)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    getInspectorSettings().then(setSettings)
  }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1800)
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "inspect", label: "Inspect" },
    { id: "scan", label: "Scan" },
    { id: "console", label: "Console", count: consoleErrors.length }
  ]

  return (
    <div className="flex flex-col h-full bg-bg-alt relative">
      {toast && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 text-[11px] py-1 px-3 rounded bg-chart-1/20 text-chart-1 animate-fade-in border border-chart-1/30">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-xs font-medium text-fg/80 flex-1">Inspector</span>
        <button
          onClick={onClose}
          className="text-fg/40 hover:text-fg text-xs"
          title="Close inspector">
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-2 py-1.5 text-[11px] transition-colors ${
              tab === t.id
                ? "text-fg border-b-2 border-chart-1 -mb-[1px]"
                : "text-fg/40 hover:text-fg/70"
            }`}>
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 bg-error/20 text-error px-1 rounded text-[9px]">
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "inspect" && <InspectTab settings={settings} onToast={showToast} />}
        {tab === "scan" && <ScanTab settings={settings} onToast={showToast} />}
        {tab === "console" && (
          <ConsoleErrorsView errors={consoleErrors} onSendToChat={onSendToChat} />
        )}
      </div>
    </div>
  )
}

function ConsoleErrorsView({
  errors,
  onSendToChat
}: {
  errors: ConsoleError[]
  onSendToChat: (text: string) => void
}) {
  if (errors.length === 0) {
    return (
      <div className="text-[11px] text-fg/30 text-center py-8">No console errors captured</div>
    )
  }
  return (
    <div className="space-y-1 p-2">
      {errors.map((err, i) => (
        <div
          key={i}
          className={`text-[11px] p-2 rounded cursor-pointer hover:bg-card/50 ${
            err.level === "error"
              ? "bg-error/5 text-error/90"
              : err.level === "warning"
                ? "bg-warning/5 text-warning/90"
                : "bg-card/20 text-fg/60"
          }`}
          onClick={() => onSendToChat(`Fix this console ${err.level}: ${err.message}`)}>
          <div className="flex items-center gap-1.5">
            <span className="uppercase text-[9px] font-bold opacity-60">{err.level}</span>
            {err.source && (
              <span className="text-[9px] text-fg/30">
                {err.source}:{err.line}
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono break-all">{err.message}</div>
        </div>
      ))}
    </div>
  )
}
