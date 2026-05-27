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
import {
  compareByVisit,
  loadLastVisitMap,
  normalizeUrl,
} from "../../lib/bookmark-history";
import { getSettings } from "../../storage";

type BookmarkView = "alphabetical" | "categories";

const VIEWS: { id: BookmarkView; label: string }[] = [
  { id: "alphabetical", label: "Alphabetical" },
  { id: "categories", label: "Categories" },
];

type BookmarkSort = "alpha" | "visit-new" | "visit-old" | "added-new" | "added-old";

const SORT_OPTIONS: { id: BookmarkSort; label: string }[] = [
  { id: "alpha", label: "A → Z" },
  { id: "visit-new", label: "Recently visited" },
  { id: "visit-old", label: "Least recently visited" },
  { id: "added-new", label: "Recently added" },
  { id: "added-old", label: "Oldest added" },
];

const BOOKMARK_SORT_KEY = "bookmarks.sort.v1";

function isBookmarkSort(value: unknown): value is BookmarkSort {
  return (
    typeof value === "string" &&
    SORT_OPTIONS.some((option) => option.id === value)
  );
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "soon";
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < m) return "now";
  if (diff < h) return `${Math.floor(diff / m)}m ago`;
  if (diff < d) return `${Math.floor(diff / h)}h ago`;
  if (diff < 30 * d) return `${Math.floor(diff / d)}d ago`;
  if (diff < 365 * d) return `${Math.floor(diff / (30 * d))}mo ago`;
  return `${Math.floor(diff / (365 * d))}y ago`;
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: ms < Date.now() - 365 * 24 * 60 * 60 * 1000 ? "numeric" : undefined,
  });
}

function compareBookmarks(a: StoredBookmark, b: StoredBookmark) {
  return (
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
    a.url.localeCompare(b.url)
  );
}

function compareByDateAdded(
  a: StoredBookmark,
  b: StoredBookmark,
  direction: "newest-first" | "oldest-first",
): number {
  const ta = a.dateAdded;
  const tb = b.dateAdded;
  const aMissing = ta == null;
  const bMissing = tb == null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return direction === "newest-first" ? tb - ta : ta - tb;
}

function makeComparator(
  sort: BookmarkSort,
  visitMap: Map<string, number>,
): (a: StoredBookmark, b: StoredBookmark) => number {
  switch (sort) {
    case "visit-new":
      return (a, b) =>
        compareByVisit(a, b, visitMap, "newest-first") || compareBookmarks(a, b);
    case "visit-old":
      return (a, b) =>
        compareByVisit(a, b, visitMap, "oldest-first") || compareBookmarks(a, b);
    case "added-new":
      return (a, b) =>
        compareByDateAdded(a, b, "newest-first") || compareBookmarks(a, b);
    case "added-old":
      return (a, b) =>
        compareByDateAdded(a, b, "oldest-first") || compareBookmarks(a, b);
    case "alpha":
    default:
      return compareBookmarks;
  }
}

function groupByCategory(
  bookmarks: StoredBookmark[],
  comparator: (a: StoredBookmark, b: StoredBookmark) => number = compareBookmarks,
) {
  const groups = new Map<string, StoredBookmark[]>();
  for (const bookmark of bookmarks) {
    const key = bookmark.category || "Unfiled";
    groups.set(key, [...(groups.get(key) ?? []), bookmark]);
  }
  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort(comparator),
    }))
    .sort((a, b) =>
      a.category.localeCompare(b.category, undefined, { sensitivity: "base" }),
    );
}

function BookmarkRow({
  bookmark,
  proposedCategory,
  onCopy,
  onDelete,
  metaSuffix,
}: {
  bookmark: StoredBookmark;
  proposedCategory?: ProposedCategory;
  onCopy?: (bookmark: StoredBookmark) => void;
  onDelete?: (bookmark: StoredBookmark) => void;
  metaSuffix?: string;
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
          {metaSuffix !== undefined
            ? metaSuffix
              ? ` · ${metaSuffix}`
              : ""
            : bookmark.category
              ? ` · ${bookmark.category}`
              : ""}
          {proposedCategory && (
            <span className="ml-2 inline-flex items-center rounded bg-primary/20 px-1.5 text-[10px] text-primary">
              AI: {proposedCategory.category} ({proposedCategory.confidence})
            </span>
          )}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {onCopy && (
          <LeoIconButton
            aria-label="Copy URL"
            className="text-fg/45 hover:text-fg focus-visible:text-fg"
            icon="copy"
            iconSize={12}
            onClick={() => onCopy(bookmark)}
            title="Copy URL"
            variant="ghost"
          />
        )}
        {onDelete && (
          <LeoIconButton
            aria-label="Delete bookmark"
            className="mr-1 text-fg/45 hover:text-destructive focus-visible:text-destructive"
            icon="trash"
            iconSize={12}
            onClick={() => onDelete(bookmark)}
            title="Delete bookmark"
            variant="ghost"
          />
        )}
      </div>
    </div>
  );
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
  onCopy,
  onDelete,
  rowMeta,
}: {
  category: string;
  items: StoredBookmark[];
  proposedCategories: Record<string, ProposedCategory>;
  onCopy?: (bookmark: StoredBookmark) => void;
  onDelete?: (bookmark: StoredBookmark) => void;
  rowMeta?: (bookmark: StoredBookmark) => string | undefined;
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
              onCopy={onCopy}
              onDelete={onDelete}
              metaSuffix={rowMeta ? rowMeta(bookmark) : undefined}
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
  const [categorizing, setCategorizing] = useState(false);
  const [categorizeError, setCategorizeError] = useState<string | null>(null);
  const [sort, setSort] = useState<BookmarkSort>("alpha");
  const [lastVisitMap, setLastVisitMap] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [historyAvailable, setHistoryAvailable] = useState(true);

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
      .get([BOOKMARK_SNAPSHOT_KEY, BOOKMARK_SORT_KEY])
      .then((got) => {
        const stored = got[BOOKMARK_SNAPSHOT_KEY] as
          | BookmarkSnapshot
          | undefined;
        const storedSort = got[BOOKMARK_SORT_KEY];
        if (isBookmarkSort(storedSort)) setSort(storedSort);
        if (stored?.bookmarks) setSnapshot(stored);
        else syncBookmarks(false);
      });

    const searchFn = chrome.history?.search?.bind(chrome.history);
    if (!searchFn) {
      setHistoryAvailable(false);
    } else {
      void loadLastVisitMap(searchFn).then((map) => {
        setLastVisitMap(map);
        // Empty map after a successful search likely means no history at all
        // (fresh profile) — don't show the unavailable banner in that case.
        // Only treat truly-broken APIs as unavailable; loadLastVisitMap
        // already swallows thrown errors and returns an empty map, so we
        // can't distinguish here. Default to available; the banner only
        // appears when chrome.history.search itself is missing.
      });
    }

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
      if (BOOKMARK_SORT_KEY in changes) {
        const next = changes[BOOKMARK_SORT_KEY].newValue;
        if (isBookmarkSort(next)) setSort(next);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const onSortChange = (next: BookmarkSort) => {
    setSort(next);
    void chrome.storage.local.set({ [BOOKMARK_SORT_KEY]: next });
  };

  const bookmarks = snapshot?.bookmarks ?? [];

  const copyUrl = (bookmark: StoredBookmark) => {
    void navigator.clipboard.writeText(bookmark.url).catch(() => {
      setError("Could not copy URL");
    });
  };

  const deleteBookmark = (bookmark: StoredBookmark) => {
    // Optimistic removal — chrome.bookmarks.onRemoved in the background
    // rebuilds the snapshot and chrome.storage.onChanged will reconcile
    // any drift on the next render.
    if (snapshot) {
      const nextSnapshot: BookmarkSnapshot = {
        ...snapshot,
        bookmarks: snapshot.bookmarks.filter((b) => b.id !== bookmark.id),
      };
      setSnapshot(nextSnapshot);
    }
    chrome.bookmarks.remove(bookmark.id).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not delete bookmark"),
    );
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
          };
        }),
      };
      setSnapshot(nextSnapshot);
      persistBookmarkSnapshot(nextSnapshot);
      setView("categories");
    }
    setProposedCategories({});
  };

  const dismissProposed = () => {
    setProposedCategories({});
    setCategorizeError(null);
  };

  const comparator = useMemo(
    () => makeComparator(sort, lastVisitMap),
    [sort, lastVisitMap],
  );
  const alphabetical = useMemo(
    () => [...bookmarks].sort(comparator),
    [bookmarks, comparator],
  );
  const categories = useMemo(
    () => groupByCategory(bookmarks, comparator),
    [bookmarks, comparator],
  );

  const metaFor = (bookmark: StoredBookmark): string | undefined => {
    if (sort === "visit-new" || sort === "visit-old") {
      const t = lastVisitMap.get(normalizeUrl(bookmark.url));
      return t == null ? "never visited" : relativeTime(t);
    }
    if (sort === "added-new" || sort === "added-old") {
      return bookmark.dateAdded == null ? "no add date" : `added ${shortDate(bookmark.dateAdded)}`;
    }
    return undefined;
  };
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
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex gap-1">
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
          <label className="flex items-center gap-1.5 text-[11px] text-fg/50">
            <span>Sort:</span>
            <select
              className="rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-fg focus:border-primary focus:outline-none"
              value={sort}
              onChange={(event) =>
                onSortChange(event.currentTarget.value as BookmarkSort)
              }
              aria-label="Sort bookmarks"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!historyAvailable && (sort === "visit-new" || sort === "visit-old") && (
          <div className="mt-2 rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">
            Visit data unavailable — sorting by title instead.
          </div>
        )}
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
                onCopy={copyUrl}
                onDelete={deleteBookmark}
                metaSuffix={metaFor(bookmark)}
              />
            ))}
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
                onCopy={copyUrl}
                onDelete={deleteBookmark}
                rowMeta={metaFor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
