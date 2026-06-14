import { useEffect, useRef, useState, type DragEvent } from "react";
import type { SectionDef, SectionId } from "../sections/types";
import { SECTIONS } from "../sections/types";
import { LeoIcon, type LeoIconName } from "./leo";
import { getSettings, setSettings } from "../storage";
import {
  moveRailSection,
  normalizeRailSectionOrder,
} from "../lib/rail-order";
import {
  runPipQuickAction,
  runScrapeCurrentPageQuickAction,
  type QuickActionResult,
  runSaveLinkQuickAction,
  runScreenshotQuickAction,
  runFullPagePdfQuickAction,
} from "../lib/quick-actions";
import { openResizableSidebarWindow } from "../lib/sidebar-window";

interface Props {
  active: SectionId;
  onChange: (id: SectionId) => void;
}

const ICONS: Record<SectionId, LeoIconName> = {
  terminal: "terminal",
  inspector: "search",
  pageStudio: "paint-brush",
  extensions: "puzzle-piece",
  session: "inbox",
  passwords: "lock",
  email: "mail",
  quickInfo: "avatar",
  perplexity: "search",
  tasks: "list-checks",
  bookmarks: "product-bookmarks",
  captures: "image-stack",
  cookies: "cookie",
  recorder: "radio-checked",
  eyedropper: "paint-brush",
  joplin: "file-export",
  agentChat: "robot",
  github: "github",
  lexicon: "book-open",
  settings: "settings",
};

const SECTIONS_BY_ID = new Map<SectionId, SectionDef>(
  SECTIONS.map((section) => [section.id, section]),
);

// Nord palette "frost" blue — locked here (rather than the theme tokens) so
// the bottom quick-action group has an obvious, distinct accent regardless
// of the active theme. ALO-471 spec calls these "nord blue".
const NORD_BLUE = "#88C0D0";

interface QuickActionDef {
  label: string;
  icon: LeoIconName;
  run: () => Promise<QuickActionResult>;
}

type QuickActionFeedback = QuickActionResult & { label: string };

const QUICK_ACTIONS: QuickActionDef[] = [
  {
    label: "Screenshot visible area",
    icon: "screenshot",
    run: runScreenshotQuickAction,
  },
  {
    label: "Save full-page PDF",
    icon: "file-export",
    run: runFullPagePdfQuickAction,
  },
  {
    label: "Scrape current page",
    icon: "search",
    run: runScrapeCurrentPageQuickAction,
  },
  {
    label: "Picture-in-picture",
    icon: "picture-in-picture",
    run: runPipQuickAction,
  },
  { label: "Save link", icon: "link-normal", run: runSaveLinkQuickAction },
  {
    label: "Open resizable sidebar window",
    icon: "file-export",
    run: async () => {
      await openResizableSidebarWindow();
      return { kind: "success", message: "Opened resizable sidebar window" };
    },
  },
];

export function SidebarRail({ active, onChange }: Props) {
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<QuickActionFeedback | null>(null);
  const [hiddenSections, setHiddenSections] = useState<Set<string>>(new Set());
  const [hideQuickActions, setHideQuickActions] = useState(false);
  const [sectionOrder, setSectionOrder] = useState<SectionId[]>(() =>
    normalizeRailSectionOrder(undefined),
  );
  const [draggingSection, setDraggingSection] = useState<SectionId | null>(
    null,
  );
  const [dragOverSection, setDragOverSection] = useState<SectionId | null>(
    null,
  );
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickAfterDrag = useRef(false);

  useEffect(() => {
    return () => {
      if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    };
  }, []);

  useEffect(() => {
    const applyRailPrefs = (settings: {
      hiddenRailSections?: string[];
      hideRailQuickActions?: boolean;
      railSectionOrder?: string[];
    }) => {
      setHiddenSections(new Set(settings.hiddenRailSections ?? []));
      setHideQuickActions(Boolean(settings.hideRailQuickActions));
      setSectionOrder(normalizeRailSectionOrder(settings.railSectionOrder));
    };
    void getSettings().then(applyRailPrefs);
    const onChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      area: string,
    ) => {
      if (area !== "local" || !changes["ai-dev-settings"]) return;
      applyRailPrefs(changes["ai-dev-settings"].newValue ?? {});
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const showFeedback = (label: string, result: QuickActionResult) => {
    setFeedback({ ...result, label });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1400);
  };

  const handleQuickAction = async (def: QuickActionDef) => {
    if (runningAction) return;
    setRunningAction(def.label);
    setFeedback(null);
    try {
      showFeedback(def.label, await def.run());
    } catch (err) {
      showFeedback(def.label, {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleSectionClick = (id: SectionId) => {
    if (suppressClickAfterDrag.current) {
      suppressClickAfterDrag.current = false;
      return;
    }
    onChange(id);
  };

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    id: SectionId,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDraggingSection(id);
  };

  const handleDragOver = (
    event: DragEvent<HTMLButtonElement>,
    id: SectionId,
  ) => {
    if (!draggingSection || draggingSection === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverSection(id);
  };

  const handleDrop = async (
    event: DragEvent<HTMLButtonElement>,
    id: SectionId,
  ) => {
    event.preventDefault();
    const draggedId = (event.dataTransfer.getData("text/plain") ||
      draggingSection) as SectionId | null;
    if (!draggedId || draggedId === id || !sectionOrder.includes(draggedId)) {
      return;
    }

    const nextOrder = moveRailSection(sectionOrder, draggedId, id);
    setSectionOrder(nextOrder);
    suppressClickAfterDrag.current = true;
    try {
      await setSettings({ railSectionOrder: nextOrder });
    } catch (error) {
      console.warn("Failed to save sidebar rail order", error);
    }
  };

  const handleDragEnd = () => {
    setDraggingSection(null);
    setDragOverSection(null);
    window.setTimeout(() => {
      suppressClickAfterDrag.current = false;
    }, 120);
  };

  const orderedSections = sectionOrder
    .map((id) => SECTIONS_BY_ID.get(id))
    .filter((section): section is SectionDef => Boolean(section))
    .filter(
      (s) =>
        s.id === "settings" || s.id === active || !hiddenSections.has(s.id),
    );

  return (
    <nav
      className="relative flex flex-col items-center justify-between gap-1 px-1.5 py-2 bg-bg/50"
      data-testid="sidebar-rail"
    >
      <div
        className="flex flex-col items-center gap-1"
        data-testid="sidebar-rail-sections"
      >
        {orderedSections.map((s) => {
          const isActive = s.id === active;
          const isDragging = draggingSection === s.id;
          const isDropTarget = dragOverSection === s.id;
          return (
            <button
              key={s.id}
              type="button"
              draggable
              onClick={() => handleSectionClick(s.id)}
              onDragStart={(event) => handleDragStart(event, s.id)}
              onDragOver={(event) => handleDragOver(event, s.id)}
              onDragLeave={() => {
                if (dragOverSection === s.id) setDragOverSection(null);
              }}
              onDrop={(event) => void handleDrop(event, s.id)}
              onDragEnd={handleDragEnd}
              title={s.label}
              aria-label={s.label}
              aria-pressed={isActive}
              aria-grabbed={isDragging || undefined}
              data-dragging={isDragging ? "true" : undefined}
              data-drop-target={isDropTarget ? "true" : undefined}
              className={`p-2 rounded transition-colors ${
                isActive
                  ? "bg-accent text-fg"
                  : "text-fg/40 hover:bg-accent/50 hover:text-fg"
              } ${isDragging ? "opacity-45" : ""} ${
                isDropTarget ? "ring-1 ring-primary/60 bg-primary/10" : ""
              }`}
            >
              <LeoIcon name={ICONS[s.id]} size={16} />
            </button>
          );
        })}
      </div>

      <div
        className={`flex flex-col items-center gap-1 pt-2 border-t border-border/50 w-full ${hideQuickActions ? "hidden" : ""}`}
        data-testid="sidebar-rail-quick-actions"
      >
        {QUICK_ACTIONS.map((def) => {
          const isRunning = runningAction === def.label;
          const currentFeedback =
            feedback?.label === def.label ? feedback : null;
          const iconName =
            currentFeedback?.kind === "error"
              ? "warning-triangle-outline"
              : currentFeedback
                ? "check-normal"
                : def.icon;
          const iconColor =
            currentFeedback?.kind === "error"
              ? "rgb(var(--error))"
              : currentFeedback
                ? "rgb(var(--success))"
                : NORD_BLUE;
          return (
            <button
              key={def.label}
              type="button"
              onClick={() => handleQuickAction(def)}
              title={
                currentFeedback
                  ? `${def.label}: ${currentFeedback.message}`
                  : def.label
              }
              aria-label={
                currentFeedback
                  ? `${def.label}: ${currentFeedback.message}`
                  : def.label
              }
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
                    : undefined,
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
          );
        })}
        <span className="sr-only" aria-live="polite">
          {feedback ? `${feedback.label}: ${feedback.message}` : ""}
        </span>
      </div>
    </nav>
  );
}
