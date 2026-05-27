import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOKMARK_SNAPSHOT_KEY,
  flattenBookmarkTree,
} from "../src/lib/bookmark-snapshot";

describe("bookmark snapshot and section", () => {
  it("flattens the browser bookmark tree into stored categories and favorites", () => {
    const tree = [
      {
        id: "0",
        title: "",
        children: [
          {
            id: "1",
            title: "Bookmarks Bar",
            parentId: "0",
            children: [
              {
                id: "2",
                title: "Example",
                url: "https://example.com",
                parentId: "1",
                index: 0,
              },
            ],
          },
          {
            id: "3",
            title: "Work",
            parentId: "0",
            children: [
              {
                id: "4",
                title: "",
                url: "https://docs.example.com",
                parentId: "3",
                index: 0,
              },
            ],
          },
        ],
      },
    ] as chrome.bookmarks.BookmarkTreeNode[];

    expect(flattenBookmarkTree(tree)).toEqual([
      expect.objectContaining({
        id: "2",
        title: "Example",
        category: "Bookmarks Bar",
        isFavorite: true,
      }),
      expect.objectContaining({
        id: "4",
        title: "docs.example.com",
        category: "Work",
        isFavorite: false,
      }),
    ]);
  });

  it("adds a bookmarks rail tab backed by the stored snapshot", () => {
    const sectionSource = readFileSync(
      join(process.cwd(), "src/sections/bookmarks/BookmarksSection.tsx"),
      "utf8",
    );
    const typesSource = readFileSync(
      join(process.cwd(), "src/sections/types.ts"),
      "utf8",
    );
    const sidepanelSource = readFileSync(
      join(process.cwd(), "src/sidepanel.tsx"),
      "utf8",
    );
    const railSource = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8",
    );
    const backgroundSource = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );

    expect(BOOKMARK_SNAPSHOT_KEY).toBe("bookmarks.snapshot.v1");
    expect(sectionSource).toContain("BOOKMARK_SNAPSHOT_KEY");
    expect(sectionSource).toContain("Alphabetical");
    expect(sectionSource).toContain("Favorites");
    expect(sectionSource).toContain("Categories");
    expect(sectionSource).toContain("function BookmarkGroup");
    expect(sectionSource).toContain('const BOOKMARK_HIDDEN_FAVORITES_KEY = "bookmarks.hiddenFavorites.v1"');
    expect(sectionSource).toContain("Remove ${bookmark.title} from Favorites");
    expect(sectionSource).toContain("[BOOKMARK_HIDDEN_FAVORITES_KEY]: [...nextHidden]");
    expect(sectionSource).toContain("!hiddenFavoriteIds.has(bookmark.id)");
    expect(sectionSource).toContain("persistBookmarkSnapshot(nextSnapshot)");
    expect(sectionSource).not.toContain("function markBookmarkNotFavorite");
    expect(sectionSource).not.toContain("isFavorite: false");
    expect(sectionSource).not.toContain("isFavorite: true");
    expect(sectionSource).toContain('setView("favorites")');
    expect(typesSource).toContain('"bookmarks"');
    expect(sidepanelSource).toContain("<BookmarksSection />");
    expect(railSource).toContain('bookmarks: "product-bookmarks"');
    expect(backgroundSource).toContain("ensureBookmarkSnapshot()");
    expect(backgroundSource).toContain("SYNC_BOOKMARK_SNAPSHOT");
  });

  it("renders a sort dropdown wired to bookmark-history and persisted under bookmarks.sort.v1", () => {
    const sectionSource = readFileSync(
      join(process.cwd(), "src/sections/bookmarks/BookmarksSection.tsx"),
      "utf8",
    );
    expect(sectionSource).toContain('const BOOKMARK_SORT_KEY = "bookmarks.sort.v1"');
    expect(sectionSource).toContain("loadLastVisitMap");
    expect(sectionSource).toContain("compareByVisit");
    // Five sort options visible to the user
    expect(sectionSource).toMatch(/A\s*[→-]\s*Z/);
    expect(sectionSource).toContain("Recently visited");
    expect(sectionSource).toContain("Least recently visited");
    expect(sectionSource).toContain("Recently added");
    expect(sectionSource).toContain("Oldest added");
  });

  it("favorites view renders a flat list (no category pagination/grouping)", () => {
    const sectionSource = readFileSync(
      join(process.cwd(), "src/sections/bookmarks/BookmarksSection.tsx"),
      "utf8",
    );
    // The favorites tab used to render <BookmarkGroup> per category; removed
    // per user request — favorites is now a flat list sorted by current sort.
    expect(sectionSource).not.toMatch(/favoriteGroups\.map/);
    expect(sectionSource).not.toContain("const favoriteGroups");
  });

  it("rows expose copy-URL and delete actions wired to navigator.clipboard and chrome.bookmarks.remove", () => {
    const sectionSource = readFileSync(
      join(process.cwd(), "src/sections/bookmarks/BookmarksSection.tsx"),
      "utf8",
    );
    expect(sectionSource).toContain('icon="copy"');
    expect(sectionSource).toContain('icon="trash"');
    expect(sectionSource).toContain("navigator.clipboard.writeText");
    expect(sectionSource).toContain("chrome.bookmarks.remove");
    expect(sectionSource).toMatch(/aria-label=["']?Copy URL/i);
    expect(sectionSource).toMatch(/aria-label=["']?Delete bookmark/i);
  });
});
