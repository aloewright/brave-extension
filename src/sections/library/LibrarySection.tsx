import { useState } from "react"
import { LeoTabButton } from "../../components/leo"
import { useLinks, useSettings as useLxSettings } from "../_lx/hooks/useStorage"
import { LinksSection as LxLinksSection } from "../_lx/components/LinksSection"
import { CaptureSection as LxCaptureSection } from "../_lx/components/CaptureSection"

type Tab = "links" | "captures"

const TABS: { id: Tab; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "captures", label: "Captures" }
]

export function LibrarySection() {
  const [tab, setTab] = useState<Tab>("links")
  const { settings, update: updateSettings } = useLxSettings()
  const { links, addLink, removeLink, updateLink, clearLinks } = useLinks()

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex border-b border-border px-2 gap-1">
        {TABS.map((t) => (
          <LeoTabButton
            key={t.id}
            onClick={() => setTab(t.id)}
            active={tab === t.id}>
            {t.label}
          </LeoTabButton>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "links" && (
          <LxLinksSection
            links={links}
            onAdd={addLink}
            onRemove={removeLink}
            onUpdate={updateLink}
            onClear={clearLinks}
            settings={settings}
            onUpdateSettings={updateSettings}
          />
        )}
        {tab === "captures" && <LxCaptureSection />}
      </div>
    </div>
  )
}
