import { useEffect, useMemo, useState } from "react";
import { LeoButton, LeoIconButton, LeoTabButton } from "../../components/leo";
import {
  BOOKMARK_SNAPSHOT_KEY,
  type BookmarkSnapshot,
  type StoredBookmark,
} from "../../lib/bookmark-snapshot";
import {
  categorizeBookmarks,
  CategorizeError,
  MAX_BATCH,
  type ProposedCategory,
} from "../../lib/bookmark-categorize";
import { getSettings } from "../../storage";

type BookmarkView = "alphabetical" | "favorites" | "categories";

const VIEWS: { id: BookmarkView; label: string }[] = [
  { id: "alphabetical", label: "Alphabetical" },
  { id: "favorites", label: "Favorites" },
  { id: "categories", label: "Categories" },
];

const BOOKMARK_HIDDEN_FAVORITES_KEY = "bookmarks.hiddenFavorites.v1";

function sanitizeBookmarkIds(input: unknown): string[] {
  return Array.isArray(input)
    ? input.filter((id): id is string => typeof id === "string")
    : [];
}

function compareBookmarks(a: StoredBookmark, b: StoredBookmark) {
  return (
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
    a.url.localeCompare(b.url)
  );
}

function groupByCategory(bookmarks: StoredBookmark[]) {
  const groups = new Map<string, StoredBookmark[]>();
  for (const bookmark of bookmarks) {
    const key = bookmark.category || "Unfiled";
    groups.set(key, [...(groups.get(key) ?? []), bookmark]);
  }
  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort(compareBookmarks),
    }))
    .sort((a, b) =>
      a.category.localeCompare(b.category, undefined, { sensitivity: "base" }),
    );
}

function BookmarkRow({
  bookmark,
  proposedCategory,
  onRemoveFromFavorites,
}: {
  bookmark: StoredBookmark;
  proposedCategory?: ProposedCategory;
  onRemoveFromFavorites?: (bookmark: StoredBookmark) => void;
}) {
  let host = bookmark.url;
  try {
    host = new URL(bookmark.url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the raw URL if parsing fails.
  }

  // ALO-469: clicking a row opens the bookmark in a new tab via
  // chrome.tabs.create — keeps the sidebar open instead of navigating it
  // out of the side panel (which the default <a> click could do depending
  // on the user's browser config).
  const onOpen = () => {
    chrome.tabs.create({ url: bookmark.url, active: true });
  };

  const canRemoveFromFavorites = bookmark.isFavorite && onRemoveFromFavorites;

  return (
    <div
      title={bookmark.url}
      className="group flex min-w-0 items-center rounded border border-transparent hover:border-border hover:bg-accent/60 focus-within:border-primary focus-within:bg-accent"
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left text-sm focus-visible:outline-none"
      >
        <span className="truncate font-medium text-fg">{bookmark.title}</span>
        <span className="truncate text-xs text-fg/45">
          {host}
          {bookmark.category ? ` · ${bookmark.category}` : ""}
          {proposedCategory && (
            <span className="ml-2 inline-flex items-center rounded bg-primary/20 px-1.5 text-[10px] text-primary">
              AI: {proposedCategory.category} ({proposedCategory.confidence})
            </span>
          )}
        </span>
      </button>
      {canRemoveFromFavorites && (
        <LeoIconButton
          aria-label={`Remove ${bookmark.title} from Favorites`}
          className="mr-1 shrink-0 text-fg/45 hover:text-destructive focus-visible:text-destructive"
          icon="close"
          iconSize={12}
          onClick={() => onRemoveFromFavorites(bookmark)}
          title={`Remove ${bookmark.title} from Favorites`}
          variant="ghost"
        />
      )}
    </div>
  );
}

function markBookmarkNotFavorite(
  snapshot: BookmarkSnapshot,
  bookmarkId: string,
): BookmarkSnapshot {
  return {
    ...snapshot,
    bookmarks: snapshot.bookmarks.map((bookmark) =>
      bookmark.id === bookmarkId
        ? {
            ...bookmark,
            isFavorite: false,
          }
        : bookmark,
    ),
  };
}

function persistBookmarkSnapshot(snapshot: BookmarkSnapshot) {
  void chrome.storage.local.set({ [BOOKMARK_SNAPSHOT_KEY]: snapshot });
}

function EmptyState({ children }: { children: string }) {
  return (
    <div className="rounded border border-border p-4 text-sm text-fg/50">
      {children}
    </div>
  );
}

function BookmarkGroup({
  category,
  items,
  proposedCategories,
  onRemoveFromFavorites,
}: {
  category: string;
  items: StoredBookmark[];
  proposedCategories: Record<string, ProposedCategory>;
  onRemoveFromFavorites?: (bookmark: StoredBookmark) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="min-w-0 rounded border border-border/60">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-fg/60">
          {category}
        </span>
        <span className="text-[11px] text-fg/35">{items.length}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 border-t border-border/50 p-1.5">
          {items.map((bookmark) => (
            <BookmarkRow
              key={bookmark.id}
              bookmark={bookmark}
              proposedCategory={proposedCategories[bookmark.id]}
              onRemoveFromFavorites={onRemoveFromFavorites}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function BookmarksSection() {
  const [view, setView] = useState<BookmarkView>("alphabetical");
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposedCategories, setProposedCategories] = useState<
    Record<string, ProposedCategory>
  >({});
  const [hiddenFavoriteIds, setHiddenFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeError, setCategorizeError] = useState<string | null>(null);

  const syncBookmarks = (force = false) => {
    setSyncing(true);
    setError(null);
    chrome.runtime.sendMessage(
      { type: "SYNC_BOOKMARK_SNAPSHOT", force },
      (res: { ok?: boolean; snapshot?: BookmarkSnapshot; error?: string }) => {
        setSyncing(false);
        if (res?.ok && res.snapshot) {
          setSnapshot(res.snapshot);
          return;
        }
        setError(res?.error || "Could not load bookmarks");
      },
    );
  };

  useEffect(() => {
    chrome.storage.local
      .get([BOOKMARK_SNAPSHOT_KEY, BOOKMARK_HIDDEN_FAVORITES_KEY])
      .then((got) => {
        const stored = got[BOOKMARK_SNAPSHOT_KEY] as
          | BookmarkSnapshot
          | undefined;
        setHiddenFavoriteIds(
          new Set(sanitizeBookmarkIds(got[BOOKMARK_HIDDEN_FAVORITES_KEY])),
        );
        if (stored?.bookmarks) setSnapshot(stored);
        else syncBookmarks(false);
      });

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      if (BOOKMARK_SNAPSHOT_KEY in changes) {
        const next = changes[BOOKMARK_SNAPSHOT_KEY].newValue as
          | BookmarkSnapshot
          | undefined;
        if (next?.bookmarks) setSnapshot(next);
      }
      if (BOOKMARK_HIDDEN_FAVORITES_KEY in changes) {
        setHiddenFavoriteIds(
          new Set(
            sanitizeBookmarkIds(
              changes[BOOKMARK_HIDDEN_FAVORITES_KEY].newValue,
            ),
          ),
        );
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const bookmarks = snapshot?.bookmarks ?? [];

  const removeFromFavorites = (bookmark: StoredBookmark) => {
    const nextHidden = new Set(hiddenFavoriteIds);
    nextHidden.add(bookmark.id);
    setHiddenFavoriteIds(nextHidden);
    void chrome.storage.local.set({
      [BOOKMARK_HIDDEN_FAVORITES_KEY]: [...nextHidden],
    });

    if (snapshot) {
      const nextSnapshot = markBookmarkNotFavorite(snapshot, bookmark.id);
      setSnapshot(nextSnapshot);
      persistBookmarkSnapshot(nextSnapshot);
    }
  };

  const runCategorize = async () => {
    setCategorizing(true);
    setCategorizeError(null);
    try {
      const settings = await getSettings();
      if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
        throw new CategorizeError(
          "Configure Sidebar API URL + token in Settings first",
          0,
          "not_configured",
        );
      }
      if (bookmarks.length === 0) {
        setCategorizing(false);
        return;
      }
      const merged: Record<string, ProposedCategory> = { ...proposedCategories };
      for (let i = 0; i < bookmarks.length; i += MAX_BATCH) {
        const slice = bookmarks.slice(i, i + MAX_BATCH).map((b) => ({
          id: b.id,
          title: b.title,
          url: b.url,
          folder: b.category,
        }));
        const res = await categorizeBookmarks({
          apiUrl: settings.sidebarApiUrl,
          apiToken: settings.sidebarApiToken,
          items: slice,
        });
        for (const p of res.proposals) merged[p.id] = p;
      }
      setProposedCategories(merged);
    } catch (err) {
      const msg =
        err instanceof CategorizeError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setCategorizeError(msg);
    } finally {
      setCategorizing(false);
    }
  };

  const applyProposed = () => {
    if (snapshot && Object.keys(proposedCategories).length > 0) {
      const nextSnapshot: BookmarkSnapshot = {
        ...snapshot,
        bookmarks: snapshot.bookmarks.map((bookmark) => {
          const proposed = proposedCategories[bookmark.id];
          if (!proposed) return bookmark;
          return {
            ...bookmark,
            category: proposed.category,
            path: [proposed.category],
            isFavorite: true,
          };
        }),
      };
      setSnapshot(nextSnapshot);
      persistBookmarkSnapshot(nextSnapshot);
      const acceptedIds = new Set(Object.keys(proposedCategories));
      const nextHidden = [...hiddenFavoriteIds].filter(
        (id) => !acceptedIds.has(id),
      );
      setHiddenFavoriteIds(new Set(nextHidden));
      void chrome.storage.local.set({
        [BOOKMARK_HIDDEN_FAVORITES_KEY]: nextHidden,
      });
      setView("favorites");
    }
    setProposedCategories({});
  };

  const dismissProposed = () => {
    setProposedCategories({});
    setCategorizeError(null);
  };

  const alphabetical = useMemo(
    () => [...bookmarks].sort(compareBookmarks),
    [bookmarks],
  );
  const favorites = useMemo(
    () =>
      bookmarks
        .filter(
          (bookmark) =>
            bookmark.isFavorite && !hiddenFavoriteIds.has(bookmark.id),
        )
        .sort(compareBookmarks),
    [bookmarks, hiddenFavoriteIds],
  );
  const favoriteGroups = useMemo(() => groupByCategory(favorites), [favorites]);
  const categories = useMemo(() => groupByCategory(bookmarks), [bookmarks]);
  const pulledLabel = snapshot?.pulledAt
    ? new Date(snapshot.pulledAt).toLocaleString()
    : "Not pulled yet";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-fg">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Bookmarks</div>
            <div className="text-xs text-fg/45">
              {bookmarks.length} stored · {pulledLabel}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LeoButton
              size="xs"
              variant="neutral"
              disabled={syncing}
              onClick={() => syncBookmarks(true)}
            >
              {syncing ? "Pulling" : "Pull"}
            </LeoButton>
            <LeoButton
              size="xs"
              variant="primary"
              disabled={categorizing || bookmarks.length === 0}
              onClick={runCategorize}
              title="Send minimal bookmark fields (title, domain, folder) to Cloudflare AI Gateway"
            >
              {categorizing ? "Categorizing…" : "AI categorize"}
            </LeoButton>
          </div>
        </div>
        {Object.keys(proposedCategories).length > 0 && (
          <div
            className="mt-2 flex items-center justify-between rounded bg-primary/10 px-2 py-1 text-[11px] text-primary"
            data-testid="bookmark-categorize-banner"
          >
            <span>
              {Object.keys(proposedCategories).length} proposed categor
              {Object.keys(proposedCategories).length === 1 ? "y" : "ies"} —
              review below
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="rounded bg-primary/30 px-2 py-0.5 hover:bg-primary/40"
                onClick={applyProposed}
              >
                Accept
              </button>
              <button
                type="button"
                className="rounded bg-card/40 px-2 py-0.5 text-fg/60 hover:bg-card/60"
                onClick={dismissProposed}
              >
                Dismiss
              </button>
            </span>
          </div>
        )}
        {categorizeError && (
          <div className="mt-2 rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">
            {categorizeError}
          </div>
        )}
        <div className="mt-3 flex gap-1">
          {VIEWS.map((item) => (
            <LeoTabButton
              key={item.id}
              active={view === item.id}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </LeoTabButton>
          ))}
        </div>
      </div>

      {error && (
        <div className="border-b border-border px-4 py-2 text-xs text-red-500">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {view === "alphabetical" && (
          <div className="flex flex-col gap-1">
            {alphabetical.map((bookmark) => (
              <BookmarkRow
                key={bookmark.id}
                bookmark={bookmark}
                proposedCategory={proposedCategories[bookmark.id]}
              />
            ))}
          </div>
        )}

        {view === "favorites" && (
          <div className="flex flex-col gap-2">
            {favorites.length > 0 ? (
              favoriteGroups.map((group) => (
                <BookmarkGroup
                  key={group.category}
                  category={group.category}
                  items={group.items}
                  proposedCategories={proposedCategories}
                  onRemoveFromFavorites={removeFromFavorites}
                />
              ))
            ) : (
              <EmptyState>No bookmarks stored in Favorites.</EmptyState>
            )}
          </div>
        )}

        {view === "categories" && (
          <div className="flex flex-col gap-2">
            {categories.map((group) => (
              <BookmarkGroup
                key={group.category}
                category={group.category}
                items={group.items}
                proposedCategories={proposedCategories}
                onRemoveFromFavorites={removeFromFavorites}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
