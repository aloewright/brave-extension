# Bookmarks Sort Options (Design)

**Status:** Draft 2026-05-27.
**Author:** Claude, paired with project owner.
**Scope:** `ai-dev-sidebar` (Brave/Chromium MV3 extension). The Bookmarks rail tab (`src/sections/bookmarks/BookmarksSection.tsx`) and a new helper for reading Chrome history.

## Goal

Add a sort dropdown to the Bookmarks rail tab so the user can re-order the bookmark list by **Alphabetical**, **Recently visited**, **Least recently visited**, **Recently added**, or **Oldest added**. The three existing tabs (Alphabetical / Favorites / Categories) stay; the chosen sort applies within each tab. Persists across sessions.

Broken-link detection, multi-select filter chips, and a "Smart" tab are explicitly out of scope (potential v2).

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| UI surface | A small `<select>` on the Bookmarks header row, right of the tab buttons. | Smallest possible UX delta; no replacement of existing tabs. |
| Sort options | A-Z, Recently visited, Least recently visited, Recently added, Oldest added. | Covers "what's new", "what's stale", and the existing default. |
| Default sort | A-Z (matches current behaviour). | Avoids changing what the user sees on first load. |
| Persistence | `chrome.storage.local` key `bookmarks.sort.v1`. | Same pattern as `BOOKMARK_SNAPSHOT_KEY` and `BOOKMARK_HIDDEN_FAVORITES_KEY`. |
| Visit-time data source | One `chrome.history.search({ text: "", startTime: 0, maxResults: 100_000 })` call, building `Map<normalizedKey, lastVisitTime>`. | Single API call, in-memory lookup. No per-URL fan-out. |
| URL normalization | `host + pathname` (strip protocol, trailing `/`, query, hash). | History entries with `?utm_*` should match a clean bookmark URL. Lossy by design. |
| Never-visited placement | Bottom of the list for *both* Recently visited and Least recently visited. | Treats "never visited" as "n/a" rather than "infinitely stale". Keeps the user's signal at the top. |
| Tab interaction | Same sort applies to Alphabetical / Favorites / Categories. Inside Categories and Favorites, items within each group are sorted by the chosen sort. Groups themselves stay alphabetical. | Single global sort matches the user-picked design. Group ordering is not the user-controllable axis. |
| Row metadata change | When sort = "Recently visited" or "Least recently visited": show `host · 3d ago` (relative time of last visit) or `host · never` instead of `host · category`. When sort = "Recently added" or "Oldest added": show `host · added Apr 12`. When sort = A-Z: keep existing `host · category`. | Surfaces the value the user is sorting by. |
| Fallback when history unavailable | Visit-based sorts fall through to A-Z; show a one-line muted notice ("Visit data unavailable") at the top of the list. | Cheap defensive UX for users who revoke the `history` permission via management UI (rare but possible). |

## Architecture

```
┌──────────────── BookmarksSection.tsx ────────────────┐
│                                                       │
│  state: snapshot, view, sort, lastVisitMap            │
│                                                       │
│  useEffect (mount):                                   │
│    ├─ chrome.storage.local.get(snapshot, hidden,      │
│    │     bookmarks.sort.v1)                           │
│    └─ loadLastVisitMap()  ─── pure helper             │
│                                                       │
│  useMemo (alphabetical / favorites / categories):     │
│    apply selected sort comparator                     │
│    inside Favorites/Categories, sort within group     │
│                                                       │
│  render:                                              │
│    header tabs + <select sort>                        │
│    rows show metadata appropriate for chosen sort     │
└───────────────────────────────────────────────────────┘

┌──────────────── src/lib/bookmark-history.ts (new) ───┐
│  export normalizeUrl(url): string  (pure)             │
│  export compareByVisit(a, b, map, direction): number  │
│  export loadLastVisitMap(): Promise<Map<string,number>>│
└───────────────────────────────────────────────────────┘
```

## Components

### New: `src/lib/bookmark-history.ts` (~80 LOC)

```ts
// Strips protocol, leading `www.`, trailing `/`, query, and hash.
// Two URLs that point at the same page should produce the same key.
export function normalizeUrl(input: string): string
//   "https://www.example.com/a/?utm=1#x"  →  "example.com/a"
//   "http://example.com/"                  →  "example.com"

export function compareByVisit(
  a: { url: string },
  b: { url: string },
  map: Map<string, number>,
  direction: "newest-first" | "oldest-first"
): number
// Never-visited items always sort to the bottom regardless of direction.

export async function loadLastVisitMap(
  searchFn: typeof chrome.history.search = chrome.history.search
): Promise<Map<string, number>>
// One call: { text: "", startTime: 0, maxResults: 100_000 }.
// Returns Map<normalizedUrl, lastVisitTime>. On any error, returns empty map
// (caller renders the "Visit data unavailable" notice).
```

`searchFn` injectable so the test suite stubs `chrome.history.search` without monkey-patching globals.

### Modified: `src/sections/bookmarks/BookmarksSection.tsx`

New state:
```ts
type BookmarkSort = "alpha" | "visit-new" | "visit-old" | "added-new" | "added-old"
const SORT_OPTIONS: { id: BookmarkSort; label: string }[] = [...]  // five entries
const BOOKMARK_SORT_KEY = "bookmarks.sort.v1"

const [sort, setSort] = useState<BookmarkSort>("alpha")
const [lastVisitMap, setLastVisitMap] = useState<Map<string, number>>(() => new Map())
const [historyAvailable, setHistoryAvailable] = useState(true)
```

New `useEffect` (additive, alongside the existing one) loads the sort from storage and calls `loadLastVisitMap`. Sort changes write back to storage.

Comparators built from `sort` + `lastVisitMap` are applied inside the existing three `useMemo`s for `alphabetical`, `favorites`, and `categories` (where Favorites and Categories sort within each group).

`BookmarkRow` gains a `meta` prop (precomputed string by the parent based on current sort) that replaces the `host · category` line for the visit/added cases.

A small `<select>` lives in the header next to the existing tab buttons.

### Header layout (unchanged shell + one new control)

```
┌─ Bookmarks                              [Pull] [AI categorize] ─┐
│  N stored · pulled <ts>                                          │
│                                                                  │
│  [Alphabetical] [Favorites] [Categories]   Sort: [A-Z ▾]        │
└──────────────────────────────────────────────────────────────────┘
```

## Data flow

1. Mount: `chrome.storage.local.get([snapshot, hidden, sort])` + `loadLastVisitMap()` in parallel.
2. Sort defaults to `alpha` if storage has no value or an unrecognised value.
3. If `loadLastVisitMap` returns an empty map AND any visit-based sort is selected, render the "Visit data unavailable" notice and fall through to A-Z comparator behaviourally; the dropdown still shows the user's chosen sort.
4. User changes sort → setState + `chrome.storage.local.set({ [BOOKMARK_SORT_KEY]: sort })` (fire-and-forget).
5. Storage onChanged listener (existing) extended to react to `bookmarks.sort.v1` so other panes/windows stay in sync.

## Error handling

| Condition | Behaviour |
|---|---|
| `chrome.history` undefined (manifest stripped) | `loadLastVisitMap` returns empty map; notice shown for visit-based sorts. |
| `chrome.history.search` rejects | Same as above; reason logged via `safeRuntimeWarning` (existing helper). |
| `chrome.storage.local.set` rejects on persist | Sort still applied in-memory; no user-visible error (low blast radius). |
| Stored sort key has unrecognised value | Treat as `alpha`. |
| `dateAdded` missing on a bookmark | Sort that entry to the bottom of added-based sorts (matches never-visited pattern). |

## Testing

| Test file | Covers |
|---|---|
| `tests/bookmark-history.test.ts` (new) | `normalizeUrl` table cases (protocol/www/trailing-slash/query/hash, malformed inputs); `compareByVisit` with map covering both directions and never-visited fall-through; `loadLastVisitMap` with a stubbed `searchFn` (success, throws, empty). |
| `tests/bookmarks-section.test.ts` (extend) | Source-shape asserts that the section renders a `<select>` with the five sort options, references `BOOKMARK_SORT_KEY`, and calls `loadLastVisitMap` on mount. |

E2E coverage via playwright is deferred — the source-shape assertions catch wiring regressions and the unit tests cover comparator correctness.

## Scope guardrails (explicit non-goals)

- No broken-link detection (no HEAD/GET requests anywhere).
- No multi-select filter chips, no new tab.
- No grouping by host or by date bucket.
- No per-tab sort (single global sort).
- No update to the cloud sidebar API. The `lastVisited` map stays in-memory; the server still only knows the canonical bookmark snapshot.

## File index

| Path | Status |
|---|---|
| `src/lib/bookmark-history.ts` | new |
| `src/sections/bookmarks/BookmarksSection.tsx` | modified (sort state + dropdown + comparators + row meta) |
| `tests/bookmark-history.test.ts` | new |
| `tests/bookmarks-section.test.ts` | modified (extend with sort assertions) |
