import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyBookmarkCategoryProposals,
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
    expect(typesSource).toContain('"bookmarks"');
    expect(sidepanelSource).toContain("<BookmarksSection />");
    expect(railSource).toContain('bookmarks: "product-bookmarks"');
    expect(backgroundSource).toContain("ensureBookmarkSnapshot()");
    expect(backgroundSource).toContain("SYNC_BOOKMARK_SNAPSHOT");
  });

  it("applies AI categories and moves categorized bookmarks into Favorites", () => {
    const snapshot = {
      pulledAt: "2026-05-23T00:00:00.000Z",
      bookmarks: [
        {
          id: "1",
          title: "React",
          url: "https://react.dev",
          category: "Bookmarks Bar",
          path: ["Bookmarks Bar"],
          isFavorite: false,
        },
        {
          id: "2",
          title: "MDN",
          url: "https://developer.mozilla.org",
          category: "Docs",
          path: ["Docs"],
          isFavorite: false,
        },
      ],
    };

    const next = applyBookmarkCategoryProposals(snapshot, [
      { id: "1", category: "Frontend" },
      { id: "2", category: "Reference" },
    ]);

    expect(next.bookmarks).toEqual([
      expect.objectContaining({ id: "1", category: "Frontend", isFavorite: true }),
      expect.objectContaining({ id: "2", category: "Reference", isFavorite: true }),
    ]);
  });
});
