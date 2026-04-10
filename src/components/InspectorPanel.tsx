import { useState } from "react"
import type { PageInspection, ConsoleError } from "../types"

type InspectorTab = "css" | "errors" | "meta" | "html"

export function InspectorPanel({
  inspection,
  consoleErrors,
  onClose,
  onSendToChat
}: {
  inspection: PageInspection | null
  consoleErrors: ConsoleError[]
  onClose: () => void
  onSendToChat: (text: string) => void
}) {
  const [tab, setTab] = useState<InspectorTab>("errors")

  const tabs: { id: InspectorTab; label: string; count?: number }[] = [
    { id: "errors", label: "Console", count: consoleErrors.length },
    { id: "css", label: "CSS", count: inspection?.css?.length || 0 },
    { id: "meta", label: "Meta" },
    { id: "html", label: "HTML" }
  ]

  return (
    <div className="flex flex-col h-full bg-bg-alt">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-xs font-medium text-fg/80 flex-1">Inspector</span>
        <button
          onClick={onClose}
          className="text-fg/40 hover:text-fg text-xs"
        >
          ✕
        </button>
      </div>

      {/* URL bar */}
      {inspection && (
        <div className="px-3 py-1.5 border-b border-border">
          <div className="text-[10px] text-fg/40 truncate">{inspection.url}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 px-2 py-1.5 text-[11px] transition-colors ${
              tab === t.id
                ? "text-fg border-b-2 border-primary bg-primary/5"
                : "text-fg/40 hover:text-fg/60"
            }`}
          >
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
      <div className="flex-1 overflow-y-auto p-2">
        {tab === "errors" && (
          <div className="space-y-1">
            {consoleErrors.length === 0 ? (
              <div className="text-[11px] text-fg/30 text-center py-4">No console errors captured</div>
            ) : (
              consoleErrors.map((err, i) => (
                <div
                  key={i}
                  className={`text-[11px] p-2 rounded cursor-pointer hover:bg-card/50 ${
                    err.level === "error"
                      ? "bg-error/5 text-error/90"
                      : err.level === "warning"
                      ? "bg-warning/5 text-warning/90"
                      : "bg-card/20 text-fg/60"
                  }`}
                  onClick={() => onSendToChat(`Fix this console ${err.level}: ${err.message}`)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="uppercase text-[9px] font-bold opacity-60">{err.level}</span>
                    {err.source && (
                      <span className="text-[9px] text-fg/30">{err.source}:{err.line}</span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono break-all">{err.message}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "css" && (
          <div className="space-y-1">
            {!inspection?.css?.length ? (
              <div className="text-[11px] text-fg/30 text-center py-4">No CSS issues found</div>
            ) : (
              inspection.css.map((issue, i) => (
                <div
                  key={i}
                  className="text-[11px] p-2 rounded bg-warning/5 text-warning/90 cursor-pointer hover:bg-warning/10"
                  onClick={() => onSendToChat(`Fix CSS issue: ${issue.selector} — ${issue.issue}`)}
                >
                  <div className="font-mono text-fg/60">{issue.selector}</div>
                  <div className="mt-0.5">
                    <span className="text-fg/40">{issue.property}:</span> {issue.value}
                  </div>
                  <div className="mt-0.5 text-warning">{issue.issue}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === "meta" && (
          <div className="space-y-1">
            {inspection?.meta && Object.keys(inspection.meta).length > 0 ? (
              Object.entries(inspection.meta).map(([key, value]) => (
                <div key={key} className="text-[11px] p-1.5 rounded bg-card/30">
                  <span className="text-info/60 font-mono">{key}</span>
                  <div className="text-fg/70 mt-0.5 break-all">{value}</div>
                </div>
              ))
            ) : (
              <div className="text-[11px] text-fg/30 text-center py-4">
                Click "Inspect" to analyze the current page
              </div>
            )}
          </div>
        )}

        {tab === "html" && (
          <div className="text-[11px]">
            {inspection?.html ? (
              <pre className="font-mono text-fg/60 whitespace-pre-wrap break-all leading-relaxed p-2 bg-black/20 rounded max-h-[400px] overflow-y-auto">
                {inspection.html.slice(0, 5000)}
                {inspection.html.length > 5000 && "\n\n... (truncated)"}
              </pre>
            ) : (
              <div className="text-fg/30 text-center py-4">
                Click "Inspect" to capture page HTML
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="px-2 py-1.5 border-t border-border flex gap-1">
        <button
          onClick={() => {
            const [tab] = [chrome.tabs.query({ active: true, currentWindow: true })]
            tab.then(([t]) => {
              if (t?.id) chrome.runtime.sendMessage({ type: "INSPECT_TAB", tabId: t.id })
            })
          }}
          className="flex-1 text-[10px] py-1 rounded bg-info/20 text-info hover:bg-info/30 transition-colors"
        >
          Inspect
        </button>
        <button
          onClick={() => {
            if (inspection) {
              const summary = [
                `Page: ${inspection.title}`,
                `URL: ${inspection.url}`,
                inspection.css?.length ? `CSS Issues: ${inspection.css.length}` : "",
                consoleErrors.length ? `Console Errors: ${consoleErrors.length}` : "",
              ].filter(Boolean).join("\n")
              onSendToChat(`Review this page inspection:\n${summary}`)
            }
          }}
          className="flex-1 text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          Send to Chat
        </button>
      </div>
    </div>
  )
}
