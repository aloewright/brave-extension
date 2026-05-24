import { useState } from "react"
import { NetworkPanel, TechPanel, useInfoPanels } from "../_lx/components/InfoPanels"

/**
 * Dedicated "Tech & IP" section (ALO-471). Splits Technologies + network
 * IP info out of the Extensions tab so each surface stays focused.
 *
 * RSS feeds moved out to the Session tab (ALO-470). The Network panel
 * still uses ipinfo.io/dns.google for resolution; the underlying data
 * fetch lives in useInfoPanels.
 */
export function TechSection() {
  const info = useInfoPanels()
  const [toast, setToast] = useState<string | null>(null)

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setToast(label)
        setTimeout(() => setToast(null), 1500)
      },
      () => {
        setToast("Copy failed")
        setTimeout(() => setToast(null), 1500)
      }
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="tech-section">
      <div className="px-3 py-2 border-b border-border flex items-center">
        <span className="text-xs font-medium text-fg/80 flex-1">Tech &amp; IP</span>
        {toast && <span className="text-[10px] text-success/80">{toast}</span>}
      </div>
      <div className="flex-1 overflow-y-auto">
        <NetworkPanel userIp={info.userIp} siteIp={info.siteIp} onCopy={copy} />
        <TechPanel techs={info.techs} />
      </div>
    </div>
  )
}
