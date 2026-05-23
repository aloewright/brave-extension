import { useEffect, useMemo, useState } from "react";
import { LeoButton, LeoTabButton } from "../../components/leo";
import {
  applyBookmarkCategoryProposals,
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
}: {
  bookmark: StoredBookmark;
  proposedCategory?: ProposedCategory;
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

  return (
    <button
      type="button"
      onClick={onOpen}
      title={bookmark.url}
      className="flex min-w-0 flex-col gap-0.5 rounded border border-transparent px-2.5 py-2 text-left text-sm hover:border-border hover:bg-accent/60 focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none"
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
    chrome.storage.local.get(BOOKMARK_SNAPSHOT_KEY).then((got) => {
      const stored = got[BOOKMARK_SNAPSHOT_KEY] as BookmarkSnapshot | undefined;
      if (stored?.bookmarks) setSnapshot(stored);
      else syncBookmarks(false);
    });

    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local" || !(BOOKMARK_SNAPSHOT_KEY in changes)) return;
      const next = changes[BOOKMARK_SNAPSHOT_KEY].newValue as
        | BookmarkSnapshot
        | undefined;
      if (next?.bookmarks) setSnapshot(next);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const bookmarks = snapshot?.bookmarks ?? [];

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
      if (snapshot) {
        const next = applyBookmarkCategoryProposals(
          snapshot,
          Object.values(merged),
        );
        setSnapshot(next);
        await chrome.storage.local.set({ [BOOKMARK_SNAPSHOT_KEY]: next });
        setView("favorites");
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
        .filter((bookmark) => bookmark.isFavorite)
        .sort(compareBookmarks),
    [bookmarks],
  );
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
              {Object.keys(proposedCategories).length} AI categor
              {Object.keys(proposedCategories).length === 1 ? "y" : "ies"} applied —
              grouped under Favorites
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                className="rounded bg-card/40 px-2 py-0.5 text-fg/60 hover:bg-card/60"
                onClick={dismissProposed}
              >
                Hide
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
          <div className="flex flex-col gap-1">
            {favorites.length > 0 ? (
              favorites.map((bookmark) => (
                <BookmarkRow
                  key={bookmark.id}
                  bookmark={bookmark}
                  proposedCategory={proposedCategories[bookmark.id]}
                />
              ))
            ) : (
              <div className="rounded border border-border p-4 text-sm text-fg/50">
                No bookmarks stored from the bookmarks bar.
              </div>
            )}
          </div>
        )}

        {view === "categories" && (
          <div className="flex flex-col gap-4">
            {categories.map((group) => (
              <section key={group.category} className="min-w-0">
                <div className="mb-1 flex items-center justify-between gap-3 px-1">
                  <h2 className="truncate text-xs font-semibold uppercase tracking-wide text-fg/45">
                    {group.category}
                  </h2>
                  <span className="text-[11px] text-fg/35">
                    {group.items.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {group.items.map((bookmark) => (
                    <BookmarkRow
                      key={bookmark.id}
                      bookmark={bookmark}
                      proposedCategory={proposedCategories[bookmark.id]}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
