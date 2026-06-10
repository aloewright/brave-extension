import { useEffect, useRef, useState } from "react"
import type { SectionId } from "../sections/types"
import { SECTIONS } from "../sections/types"
import { LeoIcon, type LeoIconName } from "./leo"
import {
  runPageAgentQuickAction,
  runPipQuickAction,
  type QuickActionResult,
  runSaveLinkQuickAction,
  runScreenshotQuickAction,
  runFullPagePdfQuickAction
} from "../lib/quick-actions"
import { openResizableSidebarWindow } from "../lib/sidebar-window"

interface Props {
  active: SectionId
  onChange: (id: SectionId) => void
}

const ICONS: Record<SectionId, LeoIconName> = {
  terminal: "terminal",
  inspector: "search",
  extensions: "puzzle-piece",
  tech: "cpu-chip",
  session: "inbox",
  email: "inbox",
  quickInfo: "avatar",
  tasks: "list-checks",
  passwords: "lock",
  bookmarks: "product-bookmarks",
  captures: "image-stack",
  cookies: "cookie",
  recorder: "radio-checked",
  eyedropper: "paint-brush",
  joplin: "file-export",
  agentChat: "robot",
  github: "github",
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

type QuickActionFeedback = QuickActionResult & { label: string }

const QUICK_ACTIONS: QuickActionDef[] = [
  { label: "Screenshot visible area", icon: "screenshot", run: runScreenshotQuickAction },
  { label: "Save full-page PDF", icon: "file-export", run: runFullPagePdfQuickAction },
  { label: "Picture-in-picture", icon: "picture-in-picture", run: runPipQuickAction },
  { label: "Save link", icon: "link-normal", run: runSaveLinkQuickAction },
  { label: "Page agent", icon: "cloud", run: runPageAgentQuickAction },
  {
    label: "Open resizable sidebar window",
    icon: "file-export",
    run: async () => {
      await openResizableSidebarWindow()
      return { kind: "success", message: "Opened resizable sidebar window" }
    }
  }
]

export function SidebarRail({ active, onChange }: Props) {
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<QuickActionFeedback | null>(null)
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    }
  }, [])

  const showFeedback = (label: string, result: QuickActionResult) => {
    setFeedback({ ...result, label })
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current)
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400)
  }

  const handleQuickAction = async (def: QuickActionDef) => {
    if (runningAction) return
    setRunningAction(def.label)
    setFeedback(null)
    try {
      showFeedback(def.label, await def.run())
    } catch (err) {
      showFeedback(def.label, {
        kind: "error",
        message: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setRunningAction(null)
    }
  }

  return (
    <nav
      className="relative flex flex-col items-center justify-between gap-1 px-1.5 py-2 border-r border-border bg-bg/50"
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
        {QUICK_ACTIONS.map((def) => {
          const isRunning = runningAction === def.label
          const currentFeedback = feedback?.label === def.label ? feedback : null
          const iconName =
            currentFeedback?.kind === "error"
              ? "warning-triangle-outline"
              : currentFeedback
                ? "check-normal"
                : def.icon
          const iconColor =
            currentFeedback?.kind === "error"
              ? "rgb(var(--error))"
              : currentFeedback
                ? "rgb(var(--success))"
                : NORD_BLUE
          return (
            <button
              key={def.label}
              type="button"
              onClick={() => handleQuickAction(def)}
              title={currentFeedback ? `${def.label}: ${currentFeedback.message}` : def.label}
              aria-label={currentFeedback ? `${def.label}: ${currentFeedback.message}` : def.label}
              aria-busy={isRunning ? true : undefined}
              disabled={runningAction !== null}
              data-feedback-kind={currentFeedback?.kind}
              className="grid h-8 w-8 place-items-center overflow-hidden rounded transition-colors duration-150 hover:bg-[rgba(136,192,208,0.15)] active:bg-[rgba(136,192,208,0.22)] disabled:cursor-wait disabled:opacity-60"
              style={{
                color: iconColor,
                backgroundColor: isRunning
                  ? "rgba(136, 192, 208, 0.16)"
                  : currentFeedback
                    ? "rgba(136, 192, 208, 0.08)"
                    : undefined
              }}
            >
              {isRunning ? (
                <span
                  aria-hidden="true"
                  className="block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"
                />
              ) : (
                <LeoIcon
                  name={iconName}
                  size={currentFeedback ? 12 : 16}
                  className={currentFeedback ? "animate-fade-in" : undefined}
                />
              )}
            </button>
          )
        })}
        <span className="sr-only" aria-live="polite">
          {feedback ? `${feedback.label}: ${feedback.message}` : ""}
        </span>
      </div>
    </nav>
  )
}
