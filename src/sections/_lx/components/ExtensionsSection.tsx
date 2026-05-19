import { useState } from "react"
import {
  LeoBadge,
  LeoButton,
  LeoIcon,
  LeoIconButton,
  LeoSwitch,
  cx
} from "../../../components/leo"
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

  const pinnedExtensions = (settings.alwaysEnabled || [])
    .map((id) => extensions.find((e) => e.id === id))
    .filter((e): e is ExtensionInfo => !!e)

  return (
    <div>
      {/* Pinned-extensions bar — quick toggle icons for pinned apps */}
      {pinnedExtensions.length > 0 && (
        <div className="mb-3 -mx-1 px-1 pb-2 flex gap-1.5 overflow-x-auto border-b border-border">
          {pinnedExtensions.map((ext) => {
            const iconUrl = ext.icons?.length ? ext.icons[ext.icons.length - 1].url : undefined
            return (
              <button
                key={ext.id}
                onClick={() => ext.mayDisable && onToggle(ext.id, !ext.enabled)}
                title={`${ext.name} — ${ext.enabled ? "enabled (click to disable)" : "disabled (click to enable)"}`}
                className={cx(
                  "relative flex-shrink-0 p-1 rounded-md transition-opacity",
                  ext.enabled ? "opacity-100" : "opacity-40 hover:opacity-70",
                  ext.mayDisable ? "cursor-pointer" : "cursor-not-allowed"
                )}>
                {iconUrl ? (
                  <img src={iconUrl} alt={ext.name} className="w-7 h-7 rounded" />
                ) : (
                  <div className="w-7 h-7 rounded bg-accent flex items-center justify-center text-xs text-fg/50">{ext.name[0]}</div>
                )}
                <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full ring-2 ring-bg ${ext.enabled ? "bg-success" : "bg-fg/30"}`} />
              </button>
            )
          })}
        </div>
      )}

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
        <LeoButton
          onClick={() => { onToggleAll(true, settings.alwaysEnabled); onUpdateSettings({ leanMode: false }) }}
          className="flex-1"
          size="md">
          Enable All
        </LeoButton>
        <LeoButton
          onClick={() => onToggleAll(false, settings.alwaysEnabled)}
          className="flex-1"
          size="md">
          Disable All
        </LeoButton>
        <LeoButton
          onClick={() => onUpdateSettings({ leanMode: !settings.leanMode })}
          title={settings.leanMode ? "Show all extensions" : "Show only Lean list"}
          active={settings.leanMode}
          className={settings.leanMode ? "" : "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"}
          size="md"
          variant="danger">
          Lean
        </LeoButton>
      </div>

      {/* Secondary actions — select / export */}
      <div className="flex gap-1.5 mb-3">
        <LeoButton
          onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}
          active={selectMode}
          size="xs"
          variant={selectMode ? "danger" : "neutral"}>
          {selectMode ? "Cancel" : "Select"}
        </LeoButton>
        <div className="flex-1" />
        <LeoButton onClick={() => exportAs("json")} title="Export as JSON" size="xs">
          JSON
        </LeoButton>
        <LeoButton onClick={() => exportAs("csv")} title="Export as CSV" size="xs">
          CSV
        </LeoButton>
      </div>

      <div className="flex gap-1.5 mb-2">
        <FuzzySearchInput
          value={search}
          onChange={setSearch}
          suggestions={suggestions}
          placeholder="Search…"
          className="flex-1 text-xs py-1.5 px-2.5 rounded bg-card border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 transition-colors"
        />
        <LeoButton
          onClick={() => {
            const q = search || ""
            chrome.tabs.create({ url: `https://chromewebstore.google.com/search/${encodeURIComponent(q)}` })
          }}
          title="Search the Chrome Web Store"
          size="sm"
          variant="success">
          Store <LeoIcon name="file-export" size={12} />
        </LeoButton>
      </div>

      {/* Filter chips — horizontally scrollable */}
      <div className="flex gap-1 mb-1.5 overflow-x-auto -mx-1 px-1 pb-0.5">
        {(["all", "enabled", "disabled", "pinned", "lean", "dev"] as FilterBy[]).map((f) => (
          <LeoButton
            key={f}
            onClick={() => setFilterBy(f)}
            active={filterBy === f}
            className="capitalize"
            size="xs"
            variant={filterBy === f ? "success" : "neutral"}>
            {f}
          </LeoButton>
        ))}
      </div>

      {/* Sort row */}
      <div className="flex items-center gap-1 mb-3">
        <span className="text-[10px] text-fg/30">Sort:</span>
        {(["name", "enabled", "type", "recent"] as SortBy[]).map((s) => (
          <LeoButton
            key={s}
            onClick={() => setSortBy(s)}
            active={sortBy === s}
            className="capitalize"
            size="xs"
            variant="ghost">
            {s}
          </LeoButton>
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
          <LeoBadge>{selected.size} selected</LeoBadge>
          <div className="flex-1" />
          <LeoButton onClick={selectAll} size="xs">All</LeoButton>
          <LeoButton onClick={() => setSelected(new Set())} size="xs">None</LeoButton>
          <LeoButton
            onClick={deleteSelected}
            disabled={selected.size === 0 || deleting}
            size="xs"
            variant="danger">
            {deleting ? `Uninstalling (${selected.size})…` : `Uninstall (${selected.size})`}
          </LeoButton>
        </div>
      )}

      {loading ? (
        <div className="text-fg/40 text-sm">Loading...</div>
      ) : (
        <div className="flex flex-col gap-1 min-w-0">
          {filtered.map((ext) => {
            const iconUrl = ext.icons?.length ? ext.icons[ext.icons.length - 1].url : undefined
            const isPinned = settings.alwaysEnabled?.includes(ext.id)
            const isLean = settings.leanExtensionIds?.includes(ext.id)
            const lastUsedDate = lastUsed[ext.id]
            return (
              <div key={ext.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg min-w-0 ${selected.has(ext.id) ? "bg-card/30" : ""}`}>
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
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className={`text-xs font-medium break-words cursor-pointer hover:underline ${ext.enabled ? "text-fg" : "text-fg/40"}`}
                      onClick={() => chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${ext.id}` })}>
                      {ext.name}
                    </span>
                    {lastUsedDate && (
                      <span className="text-[9px] text-fg/20 whitespace-nowrap" title={new Date(lastUsedDate).toLocaleString()}>
                        {relativeDate(lastUsedDate)}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-fg/30 break-words">{ext.description || `v${ext.version}`}</p>
                </div>
                {/* Action buttons — pinned/lean stay visible if active; others reveal on hover */}
                <LeoIconButton
                  onClick={() => {
                    const next = isPinned
                      ? settings.alwaysEnabled.filter((id) => id !== ext.id)
                      : [...(settings.alwaysEnabled || []), ext.id]
                    onUpdateSettings({ alwaysEnabled: next })
                  }}
                  title={isPinned ? "Unpin app" : "Pin app (always enabled)"}
                  aria-label={isPinned ? "Unpin app" : "Pin app"}
                  active={isPinned}
                  className="flex-shrink-0"
                  icon="pin"
                  iconSize={12}
                  variant={isPinned ? "warning" : "ghost"}
                />
                <LeoIconButton
                  onClick={() => {
                    const next = isLean
                      ? settings.leanExtensionIds.filter((id) => id !== ext.id)
                      : [...(settings.leanExtensionIds || []), ext.id]
                    onUpdateSettings({ leanExtensionIds: next })
                  }}
                  title={isLean ? "Remove from Lean list" : "Add to Lean list"}
                  aria-label={isLean ? "Remove from Lean list" : "Add to Lean list"}
                  active={isLean}
                  className="flex-shrink-0"
                  icon="star-outline"
                  iconSize={12}
                  variant={isLean ? "success" : "ghost"}
                />
                <LeoIconButton
                  onClick={() => {
                    const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${ext.id}%26uc`
                    chrome.tabs.create({ url: `https://www.virustotal.com/gui/search/${encodeURIComponent(crxUrl)}` })
                  }}
                  title="Scan with VirusTotal"
                  aria-label="Scan with VirusTotal"
                  className="flex-shrink-0 text-fg/30 hover:text-info"
                  icon="shield"
                  iconSize={12}
                  variant="ghost"
                />
                <LeoIconButton
                  onClick={() => { if (confirm(`Uninstall ${ext.name}?`)) onUninstall(ext.id) }}
                  title="Uninstall"
                  aria-label={`Uninstall ${ext.name}`}
                  className="flex-shrink-0 text-fg/30 hover:bg-destructive/10 hover:text-destructive"
                  icon="trash"
                  iconSize={12}
                  variant="ghost"
                />
                <LeoSwitch
                  aria-label={ext.enabled ? `Disable ${ext.name}` : `Enable ${ext.name}`}
                  checked={ext.enabled}
                  disabled={!ext.mayDisable}
                  onChange={() => onToggle(ext.id, !ext.enabled)}
                  className="flex-shrink-0 ml-0.5"
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
