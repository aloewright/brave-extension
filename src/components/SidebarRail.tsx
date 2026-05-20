import { useState } from "react"
import type { SectionId } from "../sections/types"
import { SECTIONS } from "../sections/types"
import { LeoIcon, type LeoIconName } from "./leo"
import {
  runPipQuickAction,
  runSaveLinkQuickAction,
  runScreenshotQuickAction,
  type QuickActionResult
} from "../lib/quick-actions"

interface Props {
  active: SectionId
  onChange: (id: SectionId) => void
}

const ICONS: Record<SectionId, LeoIconName> = {
  terminal: "terminal",
  inspector: "search",
  extensions: "puzzle-piece",
  tech: "browser-extensions",
  session: "inbox",
  bookmarks: "product-bookmarks",
  cookies: "cookie",
  recorder: "radio-checked",
  eyedropper: "paint-brush",
  settings: "settings"
}

// Nord palette "frost" blue — locked here (rather than the theme tokens) so
// the bottom quick-action group has an obvious, distinct accent regardless
// of the active theme. ALO-471 spec calls these "nord blue".
const NORD_BLUE = "#88C0D0"

interface QuickActionDef {
  label: string
  icon: LeoIconName
  run: () => Promise<QuickActionResult>
}

const QUICK_ACTIONS: QuickActionDef[] = [
  { label: "Screenshot visible area", icon: "screenshot", run: runScreenshotQuickAction },
  { label: "Picture-in-picture", icon: "picture-in-picture", run: runPipQuickAction },
  { label: "Save link", icon: "link-normal", run: runSaveLinkQuickAction }
]

export function SidebarRail({ active, onChange }: Props) {
  const [toast, setToast] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const handleQuickAction = async (def: QuickActionDef) => {
    setPending(def.label)
    try {
      const res = await def.run()
      setToast(res.message)
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(null)
      setTimeout(() => setToast(null), 2400)
    }
  }

  return (
    <nav
      className="flex flex-col items-center justify-between gap-1 px-1.5 py-2 border-r border-border bg-bg/50"
      data-testid="sidebar-rail"
    >
      <div className="flex flex-col items-center gap-1" data-testid="sidebar-rail-sections">
        {SECTIONS.map((s) => {
          const isActive = s.id === active
          return (
            <button
              key={s.id}
              onClick={() => onChange(s.id)}
              title={s.label}
              aria-label={s.label}
              aria-pressed={isActive}
              className={`p-2 rounded transition-colors ${
                isActive
                  ? "bg-accent text-fg"
                  : "text-fg/40 hover:bg-accent/50 hover:text-fg"
              }`}
            >
              <LeoIcon name={ICONS[s.id]} size={16} />
            </button>
          )
        })}
      </div>

      <div
        className="flex flex-col items-center gap-1 pt-2 border-t border-border/50 w-full"
        data-testid="sidebar-rail-quick-actions"
      >
        {QUICK_ACTIONS.map((def) => (
          <button
            key={def.label}
            type="button"
            onClick={() => handleQuickAction(def)}
            title={def.label}
            aria-label={def.label}
            disabled={pending !== null}
            className={`p-2 rounded transition-colors disabled:opacity-50 hover:bg-[${NORD_BLUE}]/15`}
            style={{ color: NORD_BLUE }}
          >
            <LeoIcon name={def.icon} size={16} />
          </button>
        ))}
        {toast && (
          <div
            className="text-[8px] text-fg/70 text-center px-1 leading-tight break-words max-w-[60px]"
            data-testid="sidebar-rail-toast"
          >
            {toast}
          </div>
        )}
      </div>
    </nav>
  )
}
