import { useEffect, useMemo, useState } from "react";
import { LeoButton, LeoTabButton } from "../../components/leo";
import {
  BOOKMARK_SNAPSHOT_KEY,
  type BookmarkSnapshot,
  type StoredBookmark,
} from "../../lib/bookmark-snapshot";

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

function BookmarkRow({ bookmark }: { bookmark: StoredBookmark }) {
  let host = bookmark.url;
  try {
    host = new URL(bookmark.url).hostname.replace(/^www\./, "");
  } catch {
    // Keep the raw URL if parsing fails.
  }

  return (
    <a
      className="flex min-w-0 flex-col gap-0.5 rounded border border-transparent px-2.5 py-2 text-sm hover:border-border hover:bg-accent/60 focus-visible:border-primary focus-visible:bg-accent focus-visible:outline-none"
      href={bookmark.url}
      title={bookmark.url}
    >
      <span className="truncate font-medium text-fg">{bookmark.title}</span>
      <span className="truncate text-xs text-fg/45">
        {host}
        {bookmark.category ? ` · ${bookmark.category}` : ""}
      </span>
    </a>
  );
}

export function BookmarksSection() {
  const [view, setView] = useState<BookmarkView>("alphabetical");
  const [snapshot, setSnapshot] = useState<BookmarkSnapshot | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <LeoButton
            size="xs"
            variant="neutral"
            disabled={syncing}
            onClick={() => syncBookmarks(true)}
          >
            {syncing ? "Pulling" : "Pull"}
          </LeoButton>
        </div>
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
              <BookmarkRow key={bookmark.id} bookmark={bookmark} />
            ))}
          </div>
        )}

        {view === "favorites" && (
          <div className="flex flex-col gap-1">
            {favorites.length > 0 ? (
              favorites.map((bookmark) => (
                <BookmarkRow key={bookmark.id} bookmark={bookmark} />
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
                    <BookmarkRow key={bookmark.id} bookmark={bookmark} />
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
