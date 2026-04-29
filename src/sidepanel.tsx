import { useEffect, useState } from "react"
import "./style.css"
import { SidebarRail } from "./components/SidebarRail"
import type { SectionId } from "./sections/types"
import { TerminalSection } from "./sections/terminal/TerminalSection"
import { InspectorSection } from "./sections/inspector/InspectorSection"
import { ExtensionsSection } from "./sections/extensions/ExtensionsSection"
import { LibrarySection } from "./sections/library/LibrarySection"
import { CookiesSection } from "./sections/cookies/CookiesSection"
import { RecorderSection } from "./sections/recorder/RecorderSection"
import { SettingsSection } from "./sections/settings/SettingsSection"

const ACTIVE_KEY = "ui.activeSection"

function SidePanel() {
  const [active, setActive] = useState<SectionId>("terminal")

  useEffect(() => {
    chrome.storage.local.get(ACTIVE_KEY).then((res) => {
      const stored = res[ACTIVE_KEY] as SectionId | undefined
      if (stored) setActive(stored)
    })
  }, [])

  const change = (id: SectionId) => {
    setActive(id)
    void chrome.storage.local.set({ [ACTIVE_KEY]: id })
  }

  return (
    <div className="w-full h-screen bg-bg text-fg font-sans flex">
      <SidebarRail active={active} onChange={change} />
      <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {active === "terminal" && <TerminalSection />}
        {active === "inspector" && <InspectorSection />}
        {active === "extensions" && <ExtensionsSection />}
        {active === "library" && <LibrarySection />}
        {active === "cookies" && <CookiesSection />}
        {active === "recorder" && <RecorderSection />}
        {active === "settings" && <SettingsSection />}
      </main>
    </div>
  )
}

export default SidePanel
