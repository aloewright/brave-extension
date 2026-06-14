import { useEffect, useState } from "react"
import { openExternalLink } from "../../lib/open-url"
import { PretextTextBlock } from "../../components/PretextTextBlock"
import { useLinks, useSettings as useLxSettings } from "../_lx/hooks/useStorage"
import { LinksSection as LxLinksSection } from "../_lx/components/LinksSection"
import {
  getSnippets,
  removeSnippet,
  subscribeToSnippets,
  type SessionSnippet
} from "../../lib/session-snippets"
import {
  addStickyNote,
  getStickyNotes,
  removeStickyNote,
  updateStickyNote,
  type StickyNote
} from "../../lib/sticky-notes"
import {
  closeCurrentWindowSavedTabs,
  getTabCollections,
  openSavedTab,
  openTabCollection,
  removeTabCollection,
  saveCurrentWindowTabs,
  type TabCollection
} from "../../lib/tab-collections"

/**
 * Session tab (ALO-470): consolidates the former Library Links,
 * context-menu highlights, sticky notes, and saved tab collections into one surface.
 *
 * Highlights are stored locally via lib/session-snippets and populated from
 * the "save-highlight" context menu (background.ts → addSessionSnippet).
 * Links carry over from the old Library, but with the new clipboard-backed
 * highlight workflow each highlight also copies to the user's clipboard.
 */
type Tab = "links" | "notes" | "tabs"

const TABS: { id: Tab; label: string }[] = [
  { id: "links", label: "Links" },
  { id: "notes", label: "Notes" },
  { id: "tabs", label: "Tabs" }
]

export function SessionSection() {
  const [tab, setTab] = useState<Tab>("links")
  const { settings, update: updateSettings } = useLxSettings()
  const { links, addLink, removeLink, updateLink, clearLinks } = useLinks()
  const [snippets, setSnippets] = useState<SessionSnippet[]>([])
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [tabCollections, setTabCollections] = useState<TabCollection[]>([])

  useEffect(() => {
    void getSnippets().then(setSnippets)
    return subscribeToSnippets(setSnippets)
  }, [])

  useEffect(() => {
    void refreshNotes()
    void refreshCollections()
  }, [])

  const refreshNotes = async () => {
    setNotes(await getStickyNotes())
  }

  const refreshCollections = async () => {
    setTabCollections(await getTabCollections())
  }

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
        {tab === "notes" && (
          <div className="session-section__panel">
              <SnippetsAndNotes
                snippets={snippets}
                notes={notes}
                onRemoveSnippet={(id) => removeSnippet(id).then(() => getSnippets()).then(setSnippets)}
                onAddNote={() => addStickyNote("").then(refreshNotes)}
              onUpdateNote={(id, text) => updateStickyNote(id, text).then(refreshNotes)}
                onRemoveNote={(id) => removeStickyNote(id).then(refreshNotes)}
              />
          </div>
        )}
        {tab === "tabs" && (
          <div className="session-section__panel">
            <TabsCollectionsPanel collections={tabCollections} onRefresh={refreshCollections} />
          </div>
        )}
      </div>
    </div>
  )
}

function SnippetsAndNotes({
  snippets,
  notes,
  onRemoveSnippet,
  onAddNote,
  onUpdateNote,
  onRemoveNote
}: {
  snippets: SessionSnippet[]
  notes: StickyNote[]
  onRemoveSnippet: (id: string) => void
  onAddNote: () => void
  onUpdateNote: (id: string, text: string) => void
  onRemoveNote: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const items = [
    ...snippets.map((snippet) => ({
      kind: "snippet" as const,
      id: snippet.id,
      createdAt: snippet.createdAt,
      snippet
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      id: note.id,
      createdAt: note.updatedAt || note.createdAt,
      note
    }))
  ]
    .filter((item) => {
      if (!needle) return true
      if (item.kind === "snippet") {
        return `${item.snippet.text} ${item.snippet.sourceTitle || ""} ${item.snippet.sourceUrl || ""}`
          .toLowerCase()
          .includes(needle)
      }
      return item.note.text.toLowerCase().includes(needle)
    })
    .sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes and highlights..."
          className="min-w-0 flex-1 rounded border border-border/70 bg-bg/70 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={onAddNote}
          className="shrink-0 rounded bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
        >
          + Note
        </button>
      </div>
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-border/70 bg-card/20 p-3 text-[11px] text-fg/45">
          Right-click selected text to save a highlight, or add a note here. Both now live in one combined column.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="snippet-note-list">
          {items.map((item) =>
            item.kind === "snippet" ? (
              <li key={`snippet-${item.id}`} className="space-y-1 rounded border border-border/60 bg-card/30 p-2 text-[11px]">
                <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-primary/70">Highlight</div>
                <PretextTextBlock text={item.snippet.text} className="whitespace-pre-wrap break-words text-fg/80">
                  {item.snippet.text}
                </PretextTextBlock>
                <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] text-fg/40">
                  <a
                    href={item.snippet.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={openExternalLink(item.snippet.sourceUrl)}
                    className="min-w-0 flex-1 truncate hover:text-primary"
                    title={item.snippet.sourceUrl}
                  >
                    {item.snippet.sourceTitle || item.snippet.sourceUrl}
                  </a>
                  <button
                    type="button"
                    onClick={() => onRemoveSnippet(item.id)}
                    className="shrink-0 text-fg/40 hover:text-error"
                    aria-label="Remove highlight"
                  >
                    x
                  </button>
                </div>
              </li>
            ) : (
              <li key={`note-${item.id}`} className="space-y-2 rounded border border-border/60 bg-card/30 p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-300/80">Note</div>
                  <button
                    type="button"
                    onClick={() => onRemoveNote(item.id)}
                    className="text-fg/40 hover:text-error"
                    aria-label="Remove note"
                  >
                    x
                  </button>
                </div>
                <textarea
                  value={item.note.text}
                  onChange={(event) => onUpdateNote(item.id, event.target.value)}
                  placeholder="Write a note..."
                  rows={3}
                  className="w-full resize-y rounded border border-border/60 bg-bg/60 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-primary"
                />
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}

function TabsCollectionsPanel({
  collections,
  onRefresh
}: {
  collections: TabCollection[]
  onRefresh: () => void
}) {
  const [title, setTitle] = useState("")
  const [query, setQuery] = useState("")
  const [closeAfterSave, setCloseAfterSave] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [status, setStatus] = useState("")
  const needle = query.trim().toLowerCase()
  const filteredCollections = collections.filter((collection) => {
    if (!needle) return true
    return `${collection.title} ${collection.tabs.map((tab) => `${tab.title} ${tab.url}`).join(" ")}`
      .toLowerCase()
      .includes(needle)
  })

  const handleSave = async () => {
    setStatus("Saving current window...")
    const collection = await saveCurrentWindowTabs(title.trim() || undefined)
    setTitle("")
    onRefresh()
    if (closeAfterSave) {
      const closed = await closeCurrentWindowSavedTabs(collection)
      setStatus(`Saved ${collection.tabs.length} tabs and closed ${closed} matching tabs.`)
    } else {
      setStatus(`Saved ${collection.tabs.length} tabs.`)
    }
  }

  const handleRemove = async (id: string) => {
    await removeTabCollection(id)
    onRefresh()
  }

  if (collections.length === 0) {
    return (
      <div className="space-y-3">
        <TabSaveControls
          title={title}
          setTitle={setTitle}
          closeAfterSave={closeAfterSave}
          setCloseAfterSave={setCloseAfterSave}
          onSave={handleSave}
          status={status}
        />
        <div className="rounded border border-dashed border-border/70 bg-card/20 p-3 text-[11px] text-fg/45">
          Save your current window into a quick tab collection. Collections are stored locally first and synced to Hub when its Tabs endpoint is available.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <TabSaveControls
        title={title}
        setTitle={setTitle}
        closeAfterSave={closeAfterSave}
        setCloseAfterSave={setCloseAfterSave}
        onSave={handleSave}
        status={status}
      />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search open history, collections, and saved URLs..."
        className="w-full rounded border border-border/70 bg-bg/70 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-primary"
      />
      <div className="space-y-2" data-testid="tab-collections-list">
        {filteredCollections.map((collection) => {
          const expanded = expandedId === collection.id
          return (
            <div key={collection.id} className="overflow-hidden rounded border border-border/60 bg-card/30">
              <div className="flex min-w-0 items-center gap-2 p-2">
                <button
                  type="button"
                  onClick={() => void openTabCollection(collection)}
                  className="min-w-0 flex-1 text-left"
                  title="Open all tabs in this collection"
                >
                  <div className="truncate text-[12px] font-semibold text-fg">{collection.title}</div>
                  <div className="truncate text-[10px] text-fg/45">
                    {collection.tabs.length} tabs · {new Date(collection.createdAt).toLocaleString()}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : collection.id)}
                  className="rounded border border-border/60 px-2 py-1 text-[11px] text-fg/70 hover:bg-accent"
                  aria-label={expanded ? "Collapse collection" : "Expand collection"}
                >
                  {expanded ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(collection.id)}
                  className="rounded border border-border/60 px-2 py-1 text-[11px] text-fg/45 hover:border-error/60 hover:text-error"
                  aria-label="Remove tab collection"
                >
                  x
                </button>
              </div>
              {expanded && (
                <div className="border-t border-border/60 bg-bg/30 p-2">
                  <div className="space-y-1">
                    {collection.tabs.map((tab) => (
                      <button
                        key={`${collection.id}-${tab.url}`}
                        type="button"
                        onClick={() => void openSavedTab(tab)}
                        className="block w-full min-w-0 rounded border border-border/50 bg-card/40 px-2 py-1.5 text-left hover:bg-accent"
                        title={tab.url}
                      >
                        <div className="truncate text-[11px] font-medium text-fg/80">{tab.title || tab.url}</div>
                        <div className="truncate text-[10px] text-fg/40">{tab.url}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {filteredCollections.length === 0 && (
          <div className="rounded border border-dashed border-border/70 bg-card/20 p-3 text-[11px] text-fg/45">
            No saved tab collections match that search.
          </div>
        )}
      </div>
    </div>
  )
}

function TabSaveControls({
  title,
  setTitle,
  closeAfterSave,
  setCloseAfterSave,
  onSave,
  status
}: {
  title: string
  setTitle: (value: string) => void
  closeAfterSave: boolean
  setCloseAfterSave: (value: boolean) => void
  onSave: () => void
  status: string
}) {
  return (
    <div className="space-y-2 rounded border border-border/60 bg-card/30 p-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-primary/70">Tab collection</div>
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Collection title"
          className="min-w-0 flex-1 rounded border border-border/70 bg-bg/70 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={onSave}
          className="shrink-0 rounded bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
        >
          Save tabs
        </button>
      </div>
      <label className="flex items-center gap-2 text-[10px] text-fg/55">
        <input
          type="checkbox"
          checked={closeAfterSave}
          onChange={(event) => setCloseAfterSave(event.target.checked)}
        />
        Close saved tabs after saving
      </label>
      <div className="flex items-center justify-between gap-2 text-[10px] text-fg/45">
        <span className="min-w-0 flex-1">{status || "Keyboard shortcut can be wired once a command slot is freed."}</span>
        <a
          href="https://hub.copythe.link/tabs"
          target="_blank"
          rel="noreferrer"
          onClick={openExternalLink("https://hub.copythe.link/tabs")}
          className="shrink-0 hover:text-primary"
        >
          Hub Tabs
        </a>
      </div>
    </div>
  )
}
