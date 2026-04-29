import { useState } from "react"
import type { ExtensionInfo, Group } from "../types"
import { FuzzySearchInput } from "./FuzzySearchInput"
import { fuzzySearch } from "../utils/fuzzy"

interface Props {
  groups: Group[]
  extensions: ExtensionInfo[]
  onAdd: (name: string, ids: string[]) => void
  onRemove: (id: string) => void
  onToggle: (id: string) => void
}

export function GroupsSection({ groups, extensions, onAdd, onRemove, onToggle }: Props) {
  const [newName, setNewName] = useState("")
  const [selectedExts, setSelectedExts] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [extSearch, setExtSearch] = useState("")

  const fuzzyExts = fuzzySearch(extensions, extSearch, [(e) => e.name])
  const filteredExts = fuzzyExts.map((r) => r.item)
  const extSuggestions = extSearch.trim() ? fuzzyExts.slice(0, 6).map((r) => r.item.name) : []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Groups</h2>
          <p className="text-xs text-fg/40 mt-0.5">Layered toggles — enable/disable sets independently</p>
        </div>
        <button onClick={() => setCreating(!creating)} className="text-xs py-1.5 px-3 rounded bg-chart-1/20 text-chart-1 hover:bg-chart-1/30 transition-colors">
          {creating ? "Cancel" : "+ New Group"}
        </button>
      </div>

      {creating && (
        <div className="p-4 rounded-lg bg-card border border-border mb-4">
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Group name (e.g., Social, Dev Tools)"
            className="w-full text-sm py-2 px-3 rounded bg-bg border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 mb-3"
          />
          <FuzzySearchInput
            value={extSearch}
            onChange={setExtSearch}
            suggestions={extSuggestions}
            placeholder="Search extensions..."
            className="w-full text-xs py-1.5 px-3 rounded bg-bg border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 mb-2"
          />
          {selectedExts.length > 0 && <p className="text-[11px] text-chart-1 mb-2">{selectedExts.length} selected</p>}
          <div className="max-h-48 overflow-y-auto grid gap-1 mb-3">
            {filteredExts.map((ext) => (
              <label key={ext.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-bg/50 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedExts.includes(ext.id)}
                  onChange={(e) => setSelectedExts(e.target.checked ? [...selectedExts, ext.id] : selectedExts.filter((id) => id !== ext.id))}
                  className="accent-chart-1" />
                <span className={selectedExts.includes(ext.id) ? "text-fg" : "text-fg/60"}>{ext.name}</span>
              </label>
            ))}
          </div>
          <button
            onClick={() => { if (newName.trim()) { onAdd(newName.trim(), selectedExts); setNewName(""); setSelectedExts([]); setExtSearch(""); setCreating(false) } }}
            className="text-xs py-1.5 px-4 rounded bg-chart-1 text-bg font-medium hover:bg-chart-1/90 transition-colors">
            Create Group
          </button>
        </div>
      )}

      <div className="grid gap-2">
        {groups.map((g) => (
          <div key={g.id} className={`p-4 rounded-lg border transition-colors ${g.enabled ? "bg-card border-chart-2/40" : "bg-card/30 border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{g.name}</span>
                <span className="text-xs text-fg/30">{g.extensionIds.length} extensions</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => onToggle(g.id)} className={`text-xs py-1 px-3 rounded transition-colors ${g.enabled ? "bg-chart-2/20 text-chart-2" : "bg-accent text-fg/60 hover:text-fg"}`}>
                  {g.enabled ? "On" : "Off"}
                </button>
                <button onClick={() => onRemove(g.id)} className="text-xs py-1 px-2 rounded text-destructive hover:bg-destructive/10 transition-colors">Delete</button>
              </div>
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-sm text-fg/30">No groups yet. Create one to layer extensions on/off.</p>}
      </div>
    </div>
  )
}
