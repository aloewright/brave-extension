import { useState } from "react"
import { useExtensions } from "../_lx/hooks/useExtensions"
import {
  useGroups,
  useLastUsed,
  useProfiles,
  useSettings as useLxSettings
} from "../_lx/hooks/useStorage"
import { ExtensionsSection as LxExtensionsSection } from "../_lx/components/ExtensionsSection"
import { ProfilesSection as LxProfilesSection } from "../_lx/components/ProfilesSection"
import { GroupsSection as LxGroupsSection } from "../_lx/components/GroupsSection"
import { QuickActionsBar } from "./QuickActionsBar"

type Tab = "extensions" | "profiles" | "groups"

const TABS: { id: Tab; label: string }[] = [
  { id: "extensions", label: "All" },
  { id: "profiles", label: "Profiles" },
  { id: "groups", label: "Groups" }
]

export function ExtensionsSection() {
  const [tab, setTab] = useState<Tab>("extensions")
  const { extensions, loading, toggleExtension, uninstallExtension, toggleAll } = useExtensions()
  const { settings, update: updateSettings } = useLxSettings()
  const { profiles, addProfile, removeProfile, updateProfile } = useProfiles()
  const { groups, addGroup, removeGroup, toggleGroup } = useGroups()
  const { lastUsed } = useLastUsed()

  const switchProfile = (profile: { id: string; extensionIds: string[] }) => {
    // Enable everything in the profile (and pinned/alwaysEnabled), disable the rest.
    const allow = new Set([...profile.extensionIds, ...(settings.alwaysEnabled || [])])
    extensions
      .filter((e) => e.mayDisable)
      .forEach((e) => {
        const target = allow.has(e.id)
        if (e.enabled !== target) toggleExtension(e.id, target)
      })
    updateSettings({ activeProfileId: profile.id })
  }

  const navigate = (id: "library" | "recorder") => {
    void chrome.storage.local.set({ "ui.activeSection": id })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Quick-actions icon row (network/tech/RSS info, PiP, save link, screenshot, PDF) */}
      <QuickActionsBar onNavigate={navigate} />
      {/* Profile pill row — visible across all tabs, mirrors the lean-extensions popup */}
      {profiles.length > 0 && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <span className="text-[10px] text-fg/30 uppercase tracking-wider">Profile</span>
          <div className="flex gap-1 flex-1 overflow-x-auto">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => switchProfile(p)}
                className={`text-[11px] py-1 px-2.5 rounded whitespace-nowrap transition-colors ${
                  settings.activeProfileId === p.id
                    ? "bg-primary/30 text-primary-foreground ring-1 ring-primary/50"
                    : "bg-accent/50 text-fg/50 hover:text-fg hover:bg-accent"
                }`}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex border-b border-border px-2 gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs transition-colors ${
              tab === t.id ? "text-fg border-b-2 border-primary -mb-px" : "text-fg/40 hover:text-fg"
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 min-w-0">
        {tab === "extensions" && (
          <LxExtensionsSection
            extensions={extensions}
            loading={loading}
            settings={settings}
            lastUsed={lastUsed}
            onToggle={toggleExtension}
            onUninstall={uninstallExtension}
            onToggleAll={toggleAll}
            onUpdateSettings={updateSettings}
          />
        )}
        {tab === "profiles" && (
          <LxProfilesSection
            profiles={profiles}
            extensions={extensions}
            settings={settings}
            onAdd={addProfile}
            onRemove={removeProfile}
            onUpdate={updateProfile}
            onUpdateSettings={updateSettings}
          />
        )}
        {tab === "groups" && (
          <LxGroupsSection
            groups={groups}
            extensions={extensions}
            onAdd={addGroup}
            onRemove={removeGroup}
            onToggle={toggleGroup}
          />
        )}
      </div>
    </div>
  )
}
