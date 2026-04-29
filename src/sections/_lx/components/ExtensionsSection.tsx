import { useState } from "react"
import type { ExtensionInfo, Settings } from "../types"
import { FuzzySearchInput } from "./FuzzySearchInput"
import { fuzzySearch } from "../utils/fuzzy"

interface Props {
  extensions: ExtensionInfo[]
  loading: boolean
  settings: Settings
  lastUsed: Record<string, string>
  onToggle: (id: string, enabled: boolean) => void
  onUninstall: (id: string) => void
  onToggleAll: (enabled: boolean, alwaysEnabled: string[]) => void
  onUpdateSettings: (u: Partial<Settings>) => void
}

type SortBy = "name" | "enabled" | "type" | "recent"
type FilterBy = "all" | "enabled" | "disabled" | "pinned" | "lean" | "dev"

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function ExtensionsSection({
  extensions, loading, settings, lastUsed, onToggle, onUninstall, onToggleAll, onUpdateSettings
}: Props) {
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState<SortBy>("name")
  const [filterBy, setFilterBy] = useState<FilterBy>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectMode, setSelectMode] = useState(false)

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const [deleting, setDeleting] = useState(false)

  const deleteSelected = async () => {
    if (selected.size === 0 || deleting) return
    setDeleting(true)
    const ids = [...selected]
    let removed = 0
    // Uninstall one at a time — each shows a browser confirmation dialog
    for (const id of ids) {
      try {
        await chrome.management.uninstall(id, { showConfirmDialog: true })
        removed++
        setSelected((prev) => { const next = new Set(prev); next.delete(id); return next })
      } catch {
        // User cancelled this one — keep going with the rest
      }
    }
    setDeleting(false)
    if (removed === ids.length) {
      setSelected(new Set())
      setSelectMode(false)
    }
  }

  const selectAll = () => {
    const ids = filtered.filter((e) => e.mayDisable).map((e) => e.id)
    setSelected(new Set(ids))
  }

  // Fuzzy search
  const fuzzyResults = fuzzySearch(
    extensions,
    search,
    [(e) => e.name, (e) => e.description]
  )
  let filtered = fuzzyResults.map((r) => r.item)

  // Suggestions for autocomplete
  const suggestions = search.trim()
    ? fuzzyResults.slice(0, 6).map((r) => r.item.name)
    : []

  // When lean-mode is on, the whole list collapses to the lean set regardless of the filter chip.
  if (settings.leanMode) {
    filtered = filtered.filter((e) => settings.leanExtensionIds?.includes(e.id))
  }

  if (filterBy === "enabled") filtered = filtered.filter((e) => e.enabled)
  else if (filterBy === "disabled") filtered = filtered.filter((e) => !e.enabled)
  else if (filterBy === "pinned") filtered = filtered.filter((e) => settings.alwaysEnabled?.includes(e.id))
  else if (filterBy === "lean") filtered = filtered.filter((e) => settings.leanExtensionIds?.includes(e.id))
  else if (filterBy === "dev") filtered = filtered.filter((e) => e.installType === "development")

  if (sortBy === "enabled") filtered = [...filtered].sort((a, b) => Number(b.enabled) - Number(a.enabled))
  else if (sortBy === "type") filtered = [...filtered].sort((a, b) => a.installType.localeCompare(b.installType))
  else if (sortBy === "recent") {
    filtered = [...filtered].sort((a, b) => {
      const aDate = lastUsed[a.id] || ""
      const bDate = lastUsed[b.id] || ""
      return bDate.localeCompare(aDate)
    })
  } else if (!search.trim()) {
    // Default name sort preserves enabled-first from the hook
  }

  const enabledCount = extensions.filter((e) => e.enabled).length
  const devCount = extensions.filter((e) => e.installType === "development").length
  const pinnedCount = settings.alwaysEnabled?.length || 0
  const leanCount = settings.leanExtensionIds?.length || 0

  const exportAs = (format: "json" | "csv") => {
    const data = extensions.map((e) => ({
      name: e.name, id: e.id, version: e.version, enabled: e.enabled, description: e.description
    }))

    let content: string, mime: string, ext: string
    if (format === "json") {
      content = JSON.stringify(data, null, 2)
      mime = "application/json"
      ext = "json"
    } else {
      const header = "name,id,version,enabled,description"
      const rows = data.map((d) =>
        `"${d.name}","${d.id}","${d.version}",${d.enabled},"${d.description.replace(/"/g, '""')}"`
      )
      content = [header, ...rows].join("\n")
      mime = "text/csv"
      ext = "csv"
    }

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `extensions-${Date.now()}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {/* Header + compact stats line */}
      <div className="mb-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Extensions</h2>
          <span className="text-[10px] text-fg/30">{extensions.length} installed</span>
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          <span className="text-success"><span className="font-semibold">{enabledCount}</span> on</span>
          <span className="text-fg/40"><span className="font-semibold">{extensions.length - enabledCount}</span> off</span>
          {pinnedCount > 0 && <span className="text-warning"><span className="font-semibold">{pinnedCount}</span> pinned</span>}
          {leanCount > 0 && <span className="text-success"><span className="font-semibold">{leanCount}</span> lean</span>}
          {devCount > 0 && <span className="text-info"><span className="font-semibold">{devCount}</span> dev</span>}
        </div>
      </div>

      {/* Big quick-actions row — Enable All / Disable All / Lean (matches lean-extensions popup) */}
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => { onToggleAll(true, settings.alwaysEnabled); onUpdateSettings({ leanMode: false }) }}
          className="flex-1 text-xs py-2 px-3 rounded bg-accent hover:bg-accent/80 text-fg transition-colors">
          Enable All
        </button>
        <button
          onClick={() => onToggleAll(false, settings.alwaysEnabled)}
          className="flex-1 text-xs py-2 px-3 rounded bg-accent hover:bg-accent/80 text-fg transition-colors">
          Disable All
        </button>
        <button
          onClick={() => onUpdateSettings({ leanMode: !settings.leanMode })}
          title={settings.leanMode ? "Show all extensions" : "Show only Lean list"}
          className={`text-xs py-2 px-4 rounded whitespace-nowrap transition-colors ${
            settings.leanMode
              ? "bg-rose-500/30 text-rose-200 ring-1 ring-rose-400/40"
              : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
          }`}>
          Lean
        </button>
      </div>

      {/* Secondary actions — select / export */}
      <div className="flex gap-1.5 mb-3">
        <button onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}
          className={`text-[11px] py-1 px-2 rounded transition-colors ${selectMode ? "bg-destructive/20 text-destructive" : "bg-accent/60 hover:bg-accent"}`}>
          {selectMode ? "Cancel" : "Select"}
        </button>
        <div className="flex-1" />
        <button onClick={() => exportAs("json")} title="Export as JSON" className="text-[11px] py-1 px-2 rounded bg-accent/60 hover:bg-accent transition-colors">JSON</button>
        <button onClick={() => exportAs("csv")} title="Export as CSV" className="text-[11px] py-1 px-2 rounded bg-accent/60 hover:bg-accent transition-colors">CSV</button>
      </div>

      <div className="flex gap-1.5 mb-2">
        <FuzzySearchInput
          value={search}
          onChange={setSearch}
          suggestions={suggestions}
          placeholder="Search…"
          className="flex-1 text-xs py-1.5 px-2.5 rounded bg-card border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 transition-colors"
        />
        <button
          onClick={() => {
            const q = search || ""
            chrome.tabs.create({ url: `https://chromewebstore.google.com/search/${encodeURIComponent(q)}` })
          }}
          title="Search the Chrome Web Store"
          className="text-[11px] py-1.5 px-2 rounded bg-success/15 text-success hover:bg-success/25 transition-colors whitespace-nowrap">
          Store ↗
        </button>
      </div>

      {/* Filter chips — horizontally scrollable */}
      <div className="flex gap-1 mb-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
        {(["all", "enabled", "disabled", "pinned", "lean", "dev"] as FilterBy[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilterBy(f)}
            className={`text-[11px] py-0.5 px-2 rounded capitalize whitespace-nowrap transition-colors ${
              filterBy === f ? "bg-success/20 text-success" : "bg-accent/50 text-fg/40 hover:text-fg/60"
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* Sort row */}
      <div className="flex items-center gap-1 mb-3">
        <span className="text-[10px] text-fg/30">Sort:</span>
        {(["name", "enabled", "type", "recent"] as SortBy[]).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`text-[11px] py-0.5 px-1.5 rounded capitalize transition-colors ${
              sortBy === s ? "bg-accent text-fg" : "text-fg/30 hover:text-fg/50"
            }`}>
            {s}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectMode && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-2 rounded-lg bg-card border border-border">
          <input
            type="checkbox"
            checked={selected.size > 0 && selected.size === filtered.filter((e) => e.mayDisable).length}
            onChange={(e) => e.target.checked ? selectAll() : setSelected(new Set())}
            className="accent-success"
          />
          <span className="text-[11px] text-fg/50">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={selectAll} className="text-[11px] py-0.5 px-2 rounded bg-accent hover:bg-accent/80 text-fg/60 transition-colors">All</button>
          <button onClick={() => setSelected(new Set())} className="text-[11px] py-0.5 px-2 rounded bg-accent hover:bg-accent/80 text-fg/60 transition-colors">None</button>
          <button onClick={deleteSelected} disabled={selected.size === 0 || deleting}
            className="text-[11px] py-0.5 px-2 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 disabled:opacity-30 transition-colors">
            {deleting ? `Uninstalling (${selected.size})…` : `Uninstall (${selected.size})`}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-fg/40 text-sm">Loading...</div>
      ) : (
        <div className="grid gap-1">
          {filtered.map((ext) => {
            const iconUrl = ext.icons?.length ? ext.icons[ext.icons.length - 1].url : undefined
            const isPinned = settings.alwaysEnabled?.includes(ext.id)
            const isLean = settings.leanExtensionIds?.includes(ext.id)
            const lastUsedDate = lastUsed[ext.id]
            return (
              <div key={ext.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-card/50 transition-colors group ${selected.has(ext.id) ? "bg-card/30" : ""}`}>
                {selectMode && (
                  <input
                    type="checkbox"
                    checked={selected.has(ext.id)}
                    onChange={() => toggleSelected(ext.id)}
                    disabled={!ext.mayDisable}
                    className="accent-success flex-shrink-0"
                  />
                )}
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="w-7 h-7 rounded flex-shrink-0" />
                ) : (
                  <div className="w-7 h-7 rounded bg-accent flex-shrink-0 flex items-center justify-center text-xs text-fg/50">{ext.name[0]}</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-medium truncate cursor-pointer hover:underline ${ext.enabled ? "text-fg" : "text-fg/40"}`}
                      onClick={() => chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${ext.id}` })}>
                      {ext.name}
                    </span>
                    {lastUsedDate && (
                      <span className="text-[9px] text-fg/20 whitespace-nowrap" title={new Date(lastUsedDate).toLocaleString()}>
                        {relativeDate(lastUsedDate)}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-fg/30 truncate">{ext.description || `v${ext.version}`}</p>
                </div>
                {/* Action buttons — pinned/lean stay visible if active; others reveal on hover */}
                <button
                  onClick={() => {
                    const next = isPinned
                      ? settings.alwaysEnabled.filter((id) => id !== ext.id)
                      : [...(settings.alwaysEnabled || []), ext.id]
                    onUpdateSettings({ alwaysEnabled: next })
                  }}
                  title={isPinned ? "Unpin app" : "Pin app (always enabled)"}
                  className={`p-1 rounded flex-shrink-0 transition-all ${isPinned ? "text-warning" : "text-fg/20 opacity-0 group-hover:opacity-100 hover:text-fg/50"}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <path d="M12 17v5M9 2h6l1 7h2l-1 4H7L6 9h2l1-7z" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    const next = isLean
                      ? settings.leanExtensionIds.filter((id) => id !== ext.id)
                      : [...(settings.leanExtensionIds || []), ext.id]
                    onUpdateSettings({ leanExtensionIds: next })
                  }}
                  title={isLean ? "Remove from Lean list" : "Add to Lean list"}
                  className={`p-1 rounded flex-shrink-0 transition-all ${isLean ? "text-success" : "text-fg/20 opacity-0 group-hover:opacity-100 hover:text-success"}`}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill={isLean ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </button>
                <button
                  onClick={() => {
                    const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${ext.id}%26uc`
                    chrome.tabs.create({ url: `https://www.virustotal.com/gui/search/${encodeURIComponent(crxUrl)}` })
                  }}
                  title="Scan with VirusTotal"
                  className="p-1 rounded flex-shrink-0 text-fg/20 opacity-0 group-hover:opacity-100 hover:text-info transition-all">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </button>
                <button
                  onClick={() => { if (confirm(`Uninstall ${ext.name}?`)) onUninstall(ext.id) }}
                  title="Uninstall"
                  className="p-1 rounded flex-shrink-0 text-fg/20 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-0.5">
                  <input type="checkbox" checked={ext.enabled} onChange={() => onToggle(ext.id, !ext.enabled)} disabled={!ext.mayDisable} className="sr-only peer" />
                  <div className="w-10 h-[22px] bg-secondary rounded-full transition-colors peer peer-checked:bg-sky-500/70 peer-disabled:opacity-30 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-[18px] after:w-[18px] after:shadow-md after:transition-all peer-checked:after:translate-x-[18px]" />
                </label>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
