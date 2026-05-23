import { OnboardingTour } from "@gfazioli/mantine-onboarding-tour"
import { useEffect, useRef, useState } from "react"
import type { SectionId } from "../sections/types"
import { SECTIONS } from "../sections/types"
import { cx, LeoIcon, type LeoIconName } from "./leo"
import {
  runPipQuickAction,
  runSaveLinkQuickAction,
  runScreenshotQuickAction
} from "../lib/quick-actions"

interface Props {
  active: SectionId
  onChange: (id: SectionId) => void
}

const ICONS: Record<SectionId, LeoIconName> = {
  terminal: "terminal",
  inspector: "search",
  extensions: "puzzle-piece",
  tech: "robot",
  session: "inbox",
  bookmarks: "product-bookmarks",
  captures: "camera",
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
  id: QuickActionId
  label: string
  icon: LeoIconName
  run: () => Promise<unknown>
}

type QuickActionId = "screenshot" | "pip" | "save-link"
type QuickActionStatus =
  | { kind: "idle" }
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }

const QUICK_ACTIONS: QuickActionDef[] = [
  { id: "screenshot", label: "Screenshot visible area", icon: "screenshot", run: runScreenshotQuickAction },
  { id: "pip", label: "Picture-in-picture", icon: "picture-in-picture", run: runPipQuickAction },
  { id: "save-link", label: "Save link", icon: "link-normal", run: runSaveLinkQuickAction }
]

const IDLE_QUICK_ACTION_STATUS: QuickActionStatus = { kind: "idle" }

export function SidebarRail({ active, onChange }: Props) {
  const [quickActionStatus, setQuickActionStatus] = useState<
    Partial<Record<QuickActionId, QuickActionStatus>>
  >({})
  const clearTimers = useRef<Partial<Record<QuickActionId, ReturnType<typeof setTimeout>>>>({})

  useEffect(() => {
    return () => {
      for (const timer of Object.values(clearTimers.current)) {
        if (timer) clearTimeout(timer)
      }
    }
  }, [])

  const handleQuickAction = async (def: QuickActionDef) => {
    if (quickActionStatus[def.id]?.kind === "loading") return
    if (clearTimers.current[def.id]) clearTimeout(clearTimers.current[def.id])

    setQuickActionStatus((current) => ({
      ...current,
      [def.id]: { kind: "loading", message: `${def.label} running` }
    }))

    try {
      const result = await def.run()
      const status =
        isQuickActionResult(result)
          ? { kind: result.kind, message: result.message }
          : { kind: "success", message: `${def.label} complete` }

      setQuickActionStatus((current) => ({ ...current, [def.id]: status }))
      clearTimers.current[def.id] = setTimeout(() => {
        setQuickActionStatus((current) => ({ ...current, [def.id]: IDLE_QUICK_ACTION_STATUS }))
      }, status.kind === "error" ? 2200 : 1400)
    } catch (err) {
      const message = err instanceof Error ? err.message : `${def.label} failed`
      setQuickActionStatus((current) => ({
        ...current,
        [def.id]: { kind: "error", message }
      }))
      clearTimers.current[def.id] = setTimeout(() => {
        setQuickActionStatus((current) => ({ ...current, [def.id]: IDLE_QUICK_ACTION_STATUS }))
      }, 2200)
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
          const tourId = `rail-${s.id}`
          return (
            <OnboardingTour.Target key={s.id} id={tourId}>
              <button
                onClick={() => onChange(s.id)}
                title={s.label}
                aria-label={s.label}
                aria-pressed={isActive}
                data-onboarding-tour-id={tourId}
                className={`p-2 rounded transition-colors ${
                  isActive
                    ? "bg-accent text-fg"
                    : "text-fg/40 hover:bg-accent/50 hover:text-fg"
                }`}
              >
                <LeoIcon name={ICONS[s.id]} size={16} />
              </button>
            </OnboardingTour.Target>
          )
        })}
      </div>

      <OnboardingTour.Target id="rail-quick-actions">
        <div
          className="flex flex-col items-center gap-1 pt-2 border-t border-border/50 w-full"
          data-testid="sidebar-rail-quick-actions"
          data-onboarding-tour-id="rail-quick-actions"
        >
          {QUICK_ACTIONS.map((def) => {
            const status = quickActionStatus[def.id] ?? IDLE_QUICK_ACTION_STATUS
            const icon = iconForQuickAction(def, status)
            const isLoading = status.kind === "loading"
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => handleQuickAction(def)}
                title={status.kind === "idle" ? def.label : status.message}
                aria-label={def.label}
                aria-busy={isLoading}
                data-feedback={status.kind}
                disabled={isLoading}
                className={cx(
                  "relative p-2 rounded transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-95",
                  status.kind === "idle" && "hover:bg-info/10",
                  status.kind === "loading" && "bg-info/15 text-info ring-1 ring-info/30",
                  status.kind === "success" && "bg-success/15 text-success ring-1 ring-success/35",
                  status.kind === "error" && "bg-error/15 text-error ring-1 ring-error/35",
                  isLoading && "cursor-progress"
                )}
                style={status.kind === "idle" ? { color: NORD_BLUE } : undefined}
              >
                <LeoIcon
                  name={icon}
                  size={16}
                  className={isLoading ? "animate-pulse" : undefined}
                />
                <span className="sr-only" role="status">
                  {status.kind === "idle" ? def.label : status.message}
                </span>
              </button>
            )
          })}
        </div>
      </OnboardingTour.Target>
    </nav>
  )
}

function isQuickActionResult(value: unknown): value is { kind: "success" | "error"; message: string } {
  if (!value || typeof value !== "object") return false
  const result = value as { kind?: unknown; message?: unknown }
  return (result.kind === "success" || result.kind === "error") && typeof result.message === "string"
}

function iconForQuickAction(def: QuickActionDef, status: QuickActionStatus): LeoIconName {
  if (status.kind === "success") return "check-normal"
  if (status.kind === "error") return "warning-triangle-outline"
  return def.icon
}
