export const BOOKMARK_SNAPSHOT_KEY = "bookmarks.snapshot.v1"

export interface StoredBookmark {
  id: string
  title: string
  url: string
  parentId?: string
  category: string
  path: string[]
  isFavorite: boolean
  dateAdded?: number
  index?: number
}

export interface BookmarkSnapshot {
  bookmarks: StoredBookmark[]
  pulledAt: string
}

function titleOrHost(title: string, url: string): string {
  const clean = title.trim()
  if (clean) return clean
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function isBookmarksBarPath(path: string[]): boolean {
  const first = path[0]?.toLowerCase() ?? ""
  return first.includes("bookmark") && first.includes("bar")
}

export function flattenBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[]
): StoredBookmark[] {
  const out: StoredBookmark[] = []

  const walk = (node: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    const nextPath = node.parentId ? [...path, node.title].filter(Boolean) : path
    if (node.url) {
      const category = path.length > 0 ? path.join(" / ") : "Unfiled"
      out.push({
        id: node.id,
        title: titleOrHost(node.title, node.url),
        url: node.url,
        parentId: node.parentId,
        category,
        path,
        isFavorite: isBookmarksBarPath(path),
        dateAdded: node.dateAdded,
        index: node.index
      })
      return
    }
    for (const child of node.children ?? []) walk(child, nextPath)
  }

  for (const node of nodes) walk(node, [])
  return out
}

export async function readBookmarkSnapshot(): Promise<BookmarkSnapshot | null> {
  const got = await chrome.storage.local.get(BOOKMARK_SNAPSHOT_KEY)
  const snapshot = got[BOOKMARK_SNAPSHOT_KEY] as BookmarkSnapshot | undefined
  if (!snapshot || !Array.isArray(snapshot.bookmarks)) return null
  return snapshot
}

export async function pullBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  const tree = await chrome.bookmarks.getTree()
  const snapshot: BookmarkSnapshot = {
    bookmarks: flattenBookmarkTree(tree),
    pulledAt: new Date().toISOString()
  }
  await chrome.storage.local.set({ [BOOKMARK_SNAPSHOT_KEY]: snapshot })
  return snapshot
}

export async function ensureBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  return (await readBookmarkSnapshot()) ?? (await pullBookmarkSnapshot())
}
