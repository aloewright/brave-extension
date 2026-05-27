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
    expect(sectionSource).toContain("Categories");
    expect(sectionSource).toContain("function BookmarkGroup");
    expect(sectionSource).toContain("persistBookmarkSnapshot(nextSnapshot)");
    expect(sectionSource).not.toContain("function markBookmarkNotFavorite");
    expect(typesSource).toContain('"bookmarks"');
    expect(sidepanelSource).toContain("<BookmarksSection />");
    expect(railSource).toContain('bookmarks: "product-bookmarks"');
    expect(backgroundSource).toContain("ensureBookmarkSnapshot()");
    expect(backgroundSource).toContain("SYNC_BOOKMARK_SNAPSHOT");
  });

  it("Favorites tab and related plumbing are gone from the section", () => {
    const sectionSource = readFileSync(
      join(process.cwd(), "src/sections/bookmarks/BookmarksSection.tsx"),
      "utf8",
    );
    expect(sectionSource).not.toContain('"favorites"');
    expect(sectionSource).not.toContain('label: "Favorites"');
    expect(sectionSource).not.toContain("BOOKMARK_HIDDEN_FAVORITES_KEY");
    expect(sectionSource).not.toContain("hiddenFavoriteIds");
    expect(sectionSource).not.toContain("removeFromFavorites");
    expect(sectionSource).not.toMatch(/Remove .* from Favorites/);
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
