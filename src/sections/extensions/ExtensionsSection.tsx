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

  return (
    <div className="h-full flex flex-col overflow-hidden">
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
      <div className="flex-1 overflow-y-auto p-4">
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
