import { useEffect, useState } from "react"
import { openExternalLink } from "../../lib/open-url"
import { useLinks, useSettings as useLxSettings } from "../_lx/hooks/useStorage"
import { LinksSection as LxLinksSection } from "../_lx/components/LinksSection"
import {
  getSnippets,
  removeSnippet,
  subscribeToSnippets,
  type SessionSnippet
} from "../../lib/session-snippets"
import { StickyNotesPanel } from "./StickyNotesPanel"

/**
 * Session tab (ALO-470): consolidates the former Library Links,
 * context-menu snippets, and sticky notes into one surface.
 *
 * Snippets are stored locally via lib/session-snippets and populated from
 * the "save-highlight" context menu (background.ts → addSessionSnippet).
 * Links carry over from the old Library, but with the new clipboard-backed
 * snippet workflow each highlight also copies to the user's clipboard.
 */
type Tab = "links" | "snippets" | "notes"

const TABS: { id: Tab; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "snippets", label: "Snippets" },
  { id: "notes", label: "Notes" }
]

export function SessionSection() {
  const [tab, setTab] = useState<Tab>("links")
  const { settings, update: updateSettings } = useLxSettings()
  const { links, addLink, removeLink, updateLink, clearLinks } = useLinks()
  const [snippets, setSnippets] = useState<SessionSnippet[]>([])

  useEffect(() => {
    void getSnippets().then(setSnippets)
    return subscribeToSnippets(setSnippets)
  }, [])

  return (
    <div className="session-section" data-testid="session-section">
      <div className="session-tab-strip" role="tablist" aria-label="Session views">
        {TABS.map((t) => {
          const selected = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`session-tab-strip__tab${selected ? " session-tab-strip__tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="session-section__body">
        {tab === "links" && (
          <div className="session-section__panel">
          <LxLinksSection
            links={links}
            onAdd={addLink}
            onRemove={removeLink}
            onUpdate={updateLink}
            onClear={clearLinks}
            settings={settings}
            onUpdateSettings={updateSettings}
          />
          </div>
        )}
        {tab === "snippets" && (
          <div className="session-section__panel">
            <SnippetList snippets={snippets} onRemove={(id) => removeSnippet(id).then(() => getSnippets()).then(setSnippets)} />
          </div>
        )}
        {tab === "notes" && (
          <div className="session-section__panel">
            <StickyNotesPanel />
          </div>
        )}
      </div>
    </div>
  )
}

function SnippetList({
  snippets,
  onRemove
}: {
  snippets: SessionSnippet[]
  onRemove: (id: string) => void
}) {
  if (snippets.length === 0) {
    return (
      <div className="text-[11px] text-fg/40">
        Right-click selected text on any page → "Save snippet" to drop it here
        and copy it to your clipboard at the same time.
      </div>
    )
  }
  return (
    <ul className="space-y-2" data-testid="snippet-list">
      {snippets.map((s) => (
        <li key={s.id} className="bg-card/30 rounded p-2 text-[11px] space-y-1">
          <div className="text-fg/80 whitespace-pre-wrap break-words">{s.text}</div>
          <div className="flex items-center justify-between text-fg/40 text-[10px]">
            <a
              href={s.sourceUrl}
              target="_blank"
              rel="noreferrer"
              onClick={openExternalLink(s.sourceUrl)}
              className="truncate max-w-[70%] hover:text-primary"
              title={s.sourceUrl}
            >
              {s.sourceTitle || s.sourceUrl}
            </a>
            <button
              type="button"
              onClick={() => onRemove(s.id)}
              className="text-fg/40 hover:text-error"
              aria-label="Remove snippet"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
