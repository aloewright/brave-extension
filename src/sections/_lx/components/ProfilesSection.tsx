import { useState } from "react"
import type { ExtensionInfo, Profile, Settings } from "../types"
import { FuzzySearchInput } from "./FuzzySearchInput"
import { fuzzySearch } from "../utils/fuzzy"

interface Props {
  profiles: Profile[]
  extensions: ExtensionInfo[]
  settings: Settings
  onAdd: (name: string, ids: string[]) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, u: Partial<Profile>) => void
  onUpdateSettings: (u: Partial<Settings>) => void
}

export function ProfilesSection({
  profiles, extensions, settings, onAdd, onRemove, onUpdate, onUpdateSettings
}: Props) {
  const [newName, setNewName] = useState("")
  const [selectedExts, setSelectedExts] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [extSearch, setExtSearch] = useState("")

  const activateProfile = async (profile: Profile) => {
    chrome.runtime.sendMessage({
      type: "SWITCH_PROFILE",
      extensionIds: profile.extensionIds,
      alwaysEnabled: settings.alwaysEnabled || []
    })
    onUpdateSettings({ activeProfileId: profile.id })
  }

  // Fuzzy filter extensions when creating a profile
  const fuzzyExts = fuzzySearch(extensions, extSearch, [(e) => e.name, (e) => e.description])
  const filteredExts = fuzzyExts.map((r) => r.item)
  const extSuggestions = extSearch.trim()
    ? fuzzyExts.slice(0, 6).map((r) => r.item.name)
    : []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Profiles</h2>
          <p className="text-xs text-fg/40 mt-0.5">Full context switch — disables all, enables profile set</p>
        </div>
        <button onClick={() => setCreating(!creating)} className="text-xs py-1.5 px-3 rounded bg-chart-1/20 text-chart-1 hover:bg-chart-1/30 transition-colors">
          {creating ? "Cancel" : "+ New Profile"}
        </button>
      </div>

      {creating && (
        <div className="p-4 rounded-lg bg-card border border-border mb-4">
          <input
            type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Profile name (e.g., Work, Dev)"
            className="w-full text-sm py-2 px-3 rounded bg-bg border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 mb-3"
          />
          <p className="text-xs text-fg/40 mb-2">Select extensions for this profile:</p>

          <FuzzySearchInput
            value={extSearch}
            onChange={setExtSearch}
            suggestions={extSuggestions}
            placeholder="Search extensions to add..."
            className="w-full text-xs py-1.5 px-3 rounded bg-bg border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 mb-2"
          />

          {/* Selected count */}
          {selectedExts.length > 0 && (
            <p className="text-[11px] text-chart-1 mb-2">{selectedExts.length} selected</p>
          )}

          <div className="max-h-48 overflow-y-auto grid gap-1 mb-3">
            {filteredExts.map((ext) => (
              <label key={ext.id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-bg/50 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={selectedExts.includes(ext.id)}
                  onChange={(e) => {
                    setSelectedExts(e.target.checked ? [...selectedExts, ext.id] : selectedExts.filter((id) => id !== ext.id))
                  }}
                  className="accent-chart-1"
                />
                <span className={selectedExts.includes(ext.id) ? "text-fg" : "text-fg/60"}>{ext.name}</span>
              </label>
            ))}
          </div>
          <button
            onClick={() => { if (newName.trim()) { onAdd(newName.trim(), selectedExts); setNewName(""); setSelectedExts([]); setExtSearch(""); setCreating(false) } }}
            className="text-xs py-1.5 px-4 rounded bg-chart-1 text-bg font-medium hover:bg-chart-1/90 transition-colors">
            Create Profile
          </button>
        </div>
      )}

      <div className="grid gap-2">
        {profiles.map((p) => (
          <div key={p.id} className={`p-4 rounded-lg border transition-colors ${settings.activeProfileId === p.id ? "bg-card border-chart-1/40" : "bg-card/30 border-border"}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                {settings.activeProfileId === p.id && <span className="text-[10px] px-1.5 py-0.5 rounded bg-chart-1/20 text-chart-1">Active</span>}
                <span className="text-xs text-fg/30">{p.extensionIds.length} extensions</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => activateProfile(p)} className="text-xs py-1 px-3 rounded bg-accent hover:bg-accent/80 transition-colors">Activate</button>
                <button onClick={() => onRemove(p.id)} className="text-xs py-1 px-3 rounded text-destructive hover:bg-destructive/10 transition-colors">Delete</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {p.extensionIds.slice(0, 8).map((id) => {
                const ext = extensions.find((e) => e.id === id)
                return ext ? (
                  <span key={id} className="text-[10px] px-2 py-0.5 rounded bg-bg text-fg/50">{ext.name}</span>
                ) : null
              })}
              {p.extensionIds.length > 8 && <span className="text-[10px] px-2 py-0.5 rounded bg-bg text-fg/30">+{p.extensionIds.length - 8} more</span>}
            </div>
          </div>
        ))}
        {profiles.length === 0 && <p className="text-sm text-fg/30">No profiles yet. Create one to get started.</p>}
      </div>
    </div>
  )
}
