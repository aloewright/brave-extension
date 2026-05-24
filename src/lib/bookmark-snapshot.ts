export const BOOKMARK_SNAPSHOT_KEY = "bookmarks.snapshot.v1";

export interface StoredBookmark {
  id: string;
  title: string;
  url: string;
  parentId?: string;
  category: string;
  path: string[];
  isFavorite: boolean;
  favoriteOrder?: number;
  dateAdded?: number;
  index?: number;
}

export interface BookmarkSnapshot {
  bookmarks: StoredBookmark[];
  pulledAt: string;
}

export interface BookmarkCategoryProposal {
  id: string;
  category: string;
}

export function applyBookmarkCategoryProposals(
  snapshot: BookmarkSnapshot,
  proposals: BookmarkCategoryProposal[],
): BookmarkSnapshot {
  const byId = new Map(
    proposals
      .map((proposal) => [proposal.id, proposal.category.trim()] as const)
      .filter(([, category]) => category.length > 0),
  );
  if (byId.size === 0) return snapshot;

  const nextBookmarks = snapshot.bookmarks.map((bookmark) => {
    const category = byId.get(bookmark.id);
    if (!category) return bookmark;
    return {
      ...bookmark,
      category,
      isFavorite: true,
    };
  });

  return {
    ...snapshot,
    bookmarks: assignMissingFavoriteOrders(nextBookmarks),
  };
}

export function moveFavoriteBookmarkToCategory(
  snapshot: BookmarkSnapshot,
  id: string,
  category: string,
): BookmarkSnapshot {
  const clean = category.trim() || "Unfiled";
  const maxOrder = Math.max(
    -1,
    ...snapshot.bookmarks
      .filter((bookmark) => bookmark.isFavorite && bookmark.category === clean && bookmark.id !== id)
      .map((bookmark) => bookmark.favoriteOrder ?? 0),
  );

  return {
    ...snapshot,
    bookmarks: snapshot.bookmarks.map((bookmark) =>
      bookmark.id === id
        ? {
            ...bookmark,
            category: clean,
            isFavorite: true,
            favoriteOrder: maxOrder + 1,
          }
        : bookmark,
    ),
  };
}

export function removeBookmarkFromFavorites(
  snapshot: BookmarkSnapshot,
  id: string,
): BookmarkSnapshot {
  return {
    ...snapshot,
    bookmarks: snapshot.bookmarks.map((bookmark) =>
      bookmark.id === id
        ? {
            ...bookmark,
            isFavorite: false,
          }
        : bookmark,
    ),
  };
}

export function moveFavoriteBookmark(
  snapshot: BookmarkSnapshot,
  id: string,
  direction: "up" | "down",
): BookmarkSnapshot {
  const current = snapshot.bookmarks.find((bookmark) => bookmark.id === id);
  if (!current?.isFavorite) return snapshot;

  const ordered = snapshot.bookmarks
    .filter(
      (bookmark) =>
        bookmark.isFavorite && bookmark.category === current.category,
    )
    .sort(compareFavoriteBookmarks);
  const index = ordered.findIndex((bookmark) => bookmark.id === id);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) {
    return snapshot;
  }

  const orderById = new Map(
    ordered.map((bookmark, order) => [bookmark.id, order] as const),
  );
  const currentOrder = orderById.get(ordered[index].id);
  const swapOrder = orderById.get(ordered[swapIndex].id);
  if (currentOrder === undefined || swapOrder === undefined) return snapshot;
  orderById.set(ordered[index].id, swapOrder);
  orderById.set(ordered[swapIndex].id, currentOrder);

  return {
    ...snapshot,
    bookmarks: snapshot.bookmarks.map((bookmark) => {
      const favoriteOrder = orderById.get(bookmark.id);
      return favoriteOrder === undefined
        ? bookmark
        : { ...bookmark, favoriteOrder };
    }),
  };
}

export function compareFavoriteBookmarks(
  a: StoredBookmark,
  b: StoredBookmark,
): number {
  return (
    (a.favoriteOrder ?? Number.MAX_SAFE_INTEGER) -
      (b.favoriteOrder ?? Number.MAX_SAFE_INTEGER) ||
    (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER) ||
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
    a.url.localeCompare(b.url)
  );
}

function assignMissingFavoriteOrders(bookmarks: StoredBookmark[]): StoredBookmark[] {
  const nextOrderByCategory = new Map<string, number>();
  for (const bookmark of bookmarks) {
    if (!bookmark.isFavorite) continue;
    const existing = nextOrderByCategory.get(bookmark.category) ?? 0;
    nextOrderByCategory.set(
      bookmark.category,
      Math.max(existing, (bookmark.favoriteOrder ?? -1) + 1),
    );
  }

  return bookmarks.map((bookmark) => {
    if (!bookmark.isFavorite || bookmark.favoriteOrder !== undefined) {
      return bookmark;
    }
    const nextOrder = nextOrderByCategory.get(bookmark.category) ?? 0;
    nextOrderByCategory.set(bookmark.category, nextOrder + 1);
    return {
      ...bookmark,
      favoriteOrder: nextOrder,
    };
  });
}

function titleOrHost(title: string, url: string): string {
  const clean = title.trim();
  if (clean) return clean;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isBookmarksBarPath(path: string[]): boolean {
  const first = path[0]?.toLowerCase() ?? "";
  return first.includes("bookmark") && first.includes("bar");
}

export function flattenBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
): StoredBookmark[] {
  const out: StoredBookmark[] = [];

  const walk = (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    const nextPath = node.parentId
      ? [...path, node.title].filter(Boolean)
      : path;

    if (node.url) {
      const category = path.length > 0 ? path.join(" / ") : "Unfiled";
      out.push({
        id: node.id,
        title: titleOrHost(node.title, node.url),
        url: node.url,
        parentId: node.parentId,
        category,
        path,
        isFavorite: isBookmarksBarPath(path),
        dateAdded: node.dateAdded,
        index: node.index,
      });
      return;
    }

    for (const child of node.children ?? []) {
      walk(child, nextPath);
    }
  };

  for (const node of nodes) walk(node, []);
  return out;
}

export async function readBookmarkSnapshot(): Promise<BookmarkSnapshot | null> {
  const got = await chrome.storage.local.get(BOOKMARK_SNAPSHOT_KEY);
  const snapshot = got[BOOKMARK_SNAPSHOT_KEY] as BookmarkSnapshot | undefined;
  if (!snapshot || !Array.isArray(snapshot.bookmarks)) return null;
  return snapshot;
}

export async function pullBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  const tree = await chrome.bookmarks.getTree();
  const snapshot: BookmarkSnapshot = {
    bookmarks: flattenBookmarkTree(tree),
    pulledAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [BOOKMARK_SNAPSHOT_KEY]: snapshot });
  return snapshot;
}

export async function ensureBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  return (await readBookmarkSnapshot()) ?? (await pullBookmarkSnapshot());
}
