# Joplin Tool Layer Expansion (S1) — Design

**Status:** Approved 2026-05-27.
**Author:** Claude, paired with project owner.
**Scope:** `ai-dev-sidebar` library + AI chat tool registry. No UI work, no native-host changes, no Swift changes.

## Goal

Expand the existing `src/lib/joplin-client.ts` (3 functions: `createNote`, `ping`, `joplinNoteUrl`) into a comprehensive typed library covering ~21 functions across notes, folders, tags, resources, search, and composites. Restructure into a `src/lib/joplin/` directory with one file per entity, plus a shared fetch core and a small set of composite helpers. The library is the foundation S2's AI chat draws from to call into Joplin; this spec also extends the chat's tool registry from 3 tools to ~10.

This spec implements **S1 — Joplin tool layer** from the 5-subsystem decomposition. Pre-shipped: S2 (AI chat UI + tool-calling loop, commit `686d972`). Deferred: S3 (heartbeat), S4 (workflows), S5 (planner).

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| Endpoint coverage | Full — ~21 fns (notes, folders, tags, resources, search, ping, composites) | Comprehensive surface lets future work compose freely; YAGNI risk accepted. |
| File structure | Split into `src/lib/joplin/` directory with one file per entity | Each file stays ~30–200 lines; clean test boundaries; easy to add entity files later. |
| Pagination | Auto-paginate with 1000-item cap + `truncated: boolean` signal | Single library knob; cap prevents context blow-up; sub-100 caps propagate to Joplin's `limit` query param (efficient). |
| Library vs tools | Two-tier — library has ~21 fns; AI chat tools = curated ~10-tool subset | Destructive fns stay library-only in V1 (`deleteNote`, `deleteFolder`, `deleteTag`, `removeTagFromNote`). Composites become tools. |
| Cancellation | No `AbortSignal` in V1 | Chat orchestrator's turn-level cancel is sufficient; each Joplin call is sub-second against localhost. |
| Token handling | Last positional parameter (`fn(input, token, fetchImpl?)`) + URL-encoded once + redacted from response-body error slices | Mirrors existing `createNote` convention; prevents token leak via Joplin's `Invalid "token" parameter` echo. |
| Error model | Single `JoplinClientError` class with `status` field; status 0 covers config + connectivity + parse failures | One catch path for callers; status semantics distinguish via message text. |
| Caching / retries / dedup | None | Stateless library; YAGNI for V1. |
| Testing | Per-entity test files under `tests/`; fetch stubbed via `vi.fn` returning `Response` | Inherits the codebase's vitest pattern. Total ~77 new tests across 8 files. |

## Architecture

```
src/lib/joplin/                                    ← new directory
├── client.ts        — shared fetch core
│                       JoplinClientError
│                       JOPLIN_BASE_URL constant
│                       internal: get<T> / post<T> / put<T> / del / postMultipart<T>
│                       paginate<T>(pagedFn, cap?) → PagedResult<T>
│
├── search.ts        — searchNotes(query, opts, token, fetchImpl?)
│
├── notes.ts         — createNote, getNote, updateNote, deleteNote,
│                       listNotes, getNoteResources, getNoteTags
│
├── folders.ts       — listFolders, getFolder, createFolder, updateFolder,
│                       deleteFolder, listNotesInFolder
│
├── tags.ts          — listTags, createTag, deleteTag, addTagToNote,
│                       removeTagFromNote, listNotesByTag
│
├── resources.ts     — getResource, uploadResource
│
├── composites.ts    — findOrCreateFolder, findOrCreateTag,
│                       addTagToNoteByName, appendToNote
│
├── ping.ts          — ping (migrated), joplinNoteUrl (migrated)
│
├── types.ts         — entity shapes + input/patch shapes + PagedResult/PagedResponse
│
└── index.ts         — barrel; consumers `import { … } from "../lib/joplin"`
```

**Migration:** the old `src/lib/joplin-client.ts` is deleted. Two callers update their import path: `src/lib/ai-chat-tools.ts` and `src/lib/joplin-clip-handler.ts`. The existing `tests/joplin-client.test.ts` is also deleted — its 10 tests are absorbed into the new test files (`joplin-client-core`, `joplin-ping`, `joplin-notes`).

**AI chat tool catalog after migration** (in `src/lib/ai-chat-tools.ts`):

| Tool | Implementation | Status |
|---|---|---|
| `joplin.ping` | `ping()` | existing |
| `joplin.createNote` | `createNote()` | existing |
| `joplin.getNote` | `getNote(id, undefined, token)` | new |
| `joplin.appendToNote` | composite `appendToNote(id, text, token)` | new |
| `joplin.searchNotes` | `searchNotes(query, { cap: 20 }, token)` | new — only tool that overrides the default cap |
| `joplin.listFolders` | `listFolders(token)` | new |
| `joplin.listTags` | `listTags(token)` | new |
| `joplin.findOrCreateFolder` | composite | new |
| `joplin.addTagToNoteByName` | composite | new |
| `context.activeTab` | unchanged | existing |

Destructive operations (`deleteNote`, `deleteFolder`, `deleteTag`, `removeTagFromNote`) are exported from the barrel for library-script use but **not** registered as tools.

## Data model

All types in `src/lib/joplin/types.ts`. `JoplinClientError` lives in `client.ts` because it's thrown from there.

### Entity shapes

```ts
export interface JoplinNote {
  id: string
  title: string
  body?: string
  body_html?: string
  parent_id?: string
  source_url?: string
  created_time?: number          // ms since epoch
  updated_time?: number
  user_created_time?: number
  user_updated_time?: number
  is_todo?: 0 | 1
  todo_completed?: 0 | 1
  todo_due?: number              // ms since epoch (0 = no due date)
  encryption_applied?: 0 | 1
  markup_language?: 1 | 2        // 1 = Markdown, 2 = HTML
}

export interface JoplinFolder {
  id: string
  title: string
  parent_id?: string             // "" or omitted for top-level
  created_time?: number
  updated_time?: number
  user_created_time?: number
  user_updated_time?: number
  share_id?: string
  is_shared?: 0 | 1
}

export interface JoplinTag {
  id: string
  title: string
  created_time?: number
  updated_time?: number
  parent_id?: string
}

export interface JoplinResource {
  id: string
  title?: string
  mime?: string
  filename?: string
  file_extension?: string
  size?: number
  created_time?: number
  updated_time?: number
  encryption_applied?: 0 | 1
  encryption_blob_encrypted?: 0 | 1
}
```

### Inputs

```ts
export interface CreateNoteInput {
  title: string
  body?: string
  bodyHtml?: string
  sourceUrl?: string
  parentId?: string
  isTodo?: boolean
  todoDue?: number               // ms since epoch
}

export interface UpdateNotePatch {
  title?: string
  body?: string
  parentId?: string
  isTodo?: boolean
  todoCompleted?: boolean
  todoDue?: number               // 0 clears the due date
}

export interface CreateFolderInput {
  title: string
  parentId?: string
}

export interface UpdateFolderPatch {
  title?: string
  parentId?: string
}

export interface UploadResourceProps {
  title?: string
  filename?: string
  mime?: string
}
```

### Pagination

```ts
export interface PagedResponse<T> {
  items: T[]
  has_more: boolean
}

export interface PagedResult<T> {
  items: T[]
  truncated: boolean             // true if cap was hit or has_more was still true after cap
}
```

### List options

```ts
export interface ListNotesOptions {
  fields?: ReadonlyArray<keyof JoplinNote>     // default: ["id", "title", "parent_id", "updated_time"]
  cap?: number                                 // default 1000; 0 = unbounded
  orderBy?: "id" | "title" | "created_time" | "updated_time" | "user_updated_time"
  orderDir?: "ASC" | "DESC"                    // default "DESC"
}

export interface SearchOptions extends ListNotesOptions {
  type?: "note" | "folder" | "tag" | "resource"  // default "note"
}
```

`listFolders` and `listTags` take no options (small lists).

### Public fn signatures

Every public fn takes `fetchImpl?: typeof fetch` as the trailing optional parameter (for unit testing). Token is always the parameter before `fetchImpl`.

```ts
// notes.ts
createNote(input: CreateNoteInput, token: string, fetchImpl?: typeof fetch): Promise<string>
getNote(id: string, fields: ReadonlyArray<keyof JoplinNote> | undefined, token: string, fetchImpl?: typeof fetch): Promise<JoplinNote>
updateNote(id: string, patch: UpdateNotePatch, token: string, fetchImpl?: typeof fetch): Promise<void>
deleteNote(id: string, token: string, fetchImpl?: typeof fetch): Promise<void>
listNotes(opts: ListNotesOptions, token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinNote>>
getNoteResources(noteId: string, token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinResource>>
getNoteTags(noteId: string, token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinTag>>

// folders.ts
listFolders(token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinFolder>>
getFolder(id: string, token: string, fetchImpl?: typeof fetch): Promise<JoplinFolder>
createFolder(input: CreateFolderInput, token: string, fetchImpl?: typeof fetch): Promise<string>
updateFolder(id: string, patch: UpdateFolderPatch, token: string, fetchImpl?: typeof fetch): Promise<void>
deleteFolder(id: string, opts: { force?: boolean } | undefined, token: string, fetchImpl?: typeof fetch): Promise<void>
listNotesInFolder(folderId: string, opts: ListNotesOptions, token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinNote>>

// tags.ts
listTags(token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinTag>>
createTag(title: string, token: string, fetchImpl?: typeof fetch): Promise<string>
deleteTag(id: string, token: string, fetchImpl?: typeof fetch): Promise<void>
addTagToNote(noteId: string, tagId: string, token: string, fetchImpl?: typeof fetch): Promise<void>
removeTagFromNote(noteId: string, tagId: string, token: string, fetchImpl?: typeof fetch): Promise<void>
listNotesByTag(tagId: string, opts: ListNotesOptions, token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinNote>>

// search.ts
searchNotes(query: string, opts: SearchOptions, token: string, fetchImpl?: typeof fetch): Promise<PagedResult<JoplinNote>>

// resources.ts
getResource(id: string, fields: ReadonlyArray<keyof JoplinResource> | undefined, token: string, fetchImpl?: typeof fetch): Promise<JoplinResource>
uploadResource(file: Blob, props: UploadResourceProps, token: string, fetchImpl?: typeof fetch): Promise<string>

// composites.ts
findOrCreateFolder(title: string, parentId: string | undefined, token: string, fetchImpl?: typeof fetch): Promise<string>
findOrCreateTag(title: string, token: string, fetchImpl?: typeof fetch): Promise<string>
addTagToNoteByName(noteId: string, tagName: string, token: string, fetchImpl?: typeof fetch): Promise<void>
appendToNote(noteId: string, text: string, token: string, fetchImpl?: typeof fetch): Promise<void>

// ping.ts (unchanged shape)
ping(fetchImpl?: typeof fetch): Promise<boolean>
joplinNoteUrl(noteId: string): string
```

### Internal helpers (`client.ts`)

```ts
interface RequestOptions {
  query?: Record<string, string | undefined>
  body?: unknown
  fetchImpl?: typeof fetch
}

async function get<T>(path: string, token: string, opts?: RequestOptions): Promise<T>
async function post<T>(path: string, token: string, body: unknown, opts?: RequestOptions): Promise<T>
async function put<T>(path: string, token: string, body: unknown, opts?: RequestOptions): Promise<T>
async function del(path: string, token: string, opts?: RequestOptions): Promise<void>
async function postMultipart<T>(
  path: string,
  token: string,
  file: Blob,
  props: Record<string, unknown>,
  opts?: { fetchImpl?: typeof fetch }
): Promise<T>

async function paginate<T>(
  pagedFn: (page: number) => Promise<PagedResponse<T>>,
  cap?: number       // default 1000; 0 = unbounded
): Promise<PagedResult<T>>
```

### `client.ts` non-obvious behaviors

- **Pagination cap propagates to Joplin** when `cap < 100`: the wrapper passes `limit: String(cap)` instead of `limit: "100"` (Joplin's default ceiling). Avoids fetching 100 items and slicing to 20.
- **Token redaction in error messages**: response-body slices in thrown error messages have the literal token string replaced with `<redacted>`. Defends against Joplin's `Invalid "token" parameter` response echoing the token.
- **Defensive nullish-coalescing in `paginate`**: reads `resp.items ?? []` and `resp.has_more ?? false` to tolerate malformed pages.
- **Page overflow defensive bound**: 1,000,000-iteration hard stop (server forever returning `has_more=true` is pathological but possible).

## Components

See Section 3 of this spec's brainstorming for full file-by-file code listings. Each entity file is ~30–200 lines and follows a uniform pattern:

1. Import shared helpers from `./client`.
2. Import types from `./types`.
3. Define module-local defaults (e.g., `DEFAULT_NOTE_FIELDS`).
4. Define public fns that translate camelCase TS shapes → snake_case Joplin payloads and back.

The barrel `src/lib/joplin/index.ts` re-exports the public surface only; entity files are implementation details.

### Composite implementations

```ts
// findOrCreateFolder — case-sensitive title match (Joplin's behavior)
async function findOrCreateFolder(title, parentId, token, fetchImpl?) {
  const { items } = await listFolders(token, fetchImpl)
  const match = items.find(
    (f) => f.title === title && (parentId === undefined || f.parent_id === parentId)
  )
  if (match) return match.id
  return createFolder({ title, parentId }, token, fetchImpl)
}

// findOrCreateTag — case-insensitive lookup, lowercased on creation
async function findOrCreateTag(title, token, fetchImpl?) {
  const needle = title.trim().toLowerCase()
  if (!needle) throw new Error("Tag title cannot be empty.")
  const { items } = await listTags(token, fetchImpl)
  const match = items.find((t) => t.title.toLowerCase() === needle)
  if (match) return match.id
  return createTag(needle, token, fetchImpl)
}

// addTagToNoteByName — composition
async function addTagToNoteByName(noteId, tagName, token, fetchImpl?) {
  const tagId = await findOrCreateTag(tagName, token, fetchImpl)
  await addTagToNote(noteId, tagId, token, fetchImpl)
}

// appendToNote — get + concat + put
async function appendToNote(noteId, text, token, fetchImpl?) {
  const current = await getNote(noteId, ["id", "body"], token, fetchImpl)
  const existing = current.body ?? ""
  const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n"
  const next = existing + sep + text
  await updateNote(noteId, { body: next }, token, fetchImpl)
}
```

## Data flow

Three flow shapes:

1. **Non-paged read** (`getNote`, `getFolder`, `getResource`): caller → client.get → buildUrl → fetch → typed result OR `JoplinClientError`.
2. **Paginated read** (all `list*`, `search*`, `getNote*` fns that return collections): caller → paginate(pagedFn, cap?) → loop pages until has_more=false OR cap reached → `PagedResult<T>` with `truncated` flag.
3. **Mutation** (`create*`, `update*`, `delete*`, `addTag*`, `removeTag*`, `uploadResource`): caller → client.post/put/del/postMultipart → JSON body → return id (for creates), void (for updates/deletes/tag-ops).

Composites chain library calls and never hit the network directly.

### Composite race semantics (documented limitations)

- `findOrCreateFolder` and `findOrCreateTag` can race under concurrent invocation, producing duplicates. Joplin does not enforce title uniqueness within a parent. Not a bug to fix at the library layer.
- `appendToNote` is last-writer-wins. A concurrent edit between `getNote` and `updateNote` is silently overwritten.

The AI chat is single-turn-at-a-time in V1, so neither race is reachable from the chat path. Multi-window Brave with simultaneous clip + chat could in theory hit them, but the probability is vanishingly small for a household-scale Joplin install.

## Concurrency

The library is stateless. No module-level mutable state, no caches, no in-flight registries. Any number of fns can run in parallel from any number of callers.

`paginate` loops sequentially within one call (no fan-out across pages).

No `AbortSignal` support in V1. The AI chat orchestrator's turn-level cancellation is sufficient — the library doesn't need its own cancel surface.

## Error handling

| Category | `status` | Trigger | Message |
|---|---|---|---|
| Config | 0 | `token === ""` | `"No Joplin API token configured."` |
| Connectivity | 0 | `fetch` rejected | `"Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?"` |
| Parse | 0 (on 2xx) | Response body not JSON | `"Couldn't parse Joplin response as JSON."` |
| HTTP 4xx/5xx | `<status>` | Joplin returned a non-2xx | `"Joplin API error <status>: <body slice with token redacted>"` |
| Missing id | `<2xx>` | Create returned 2xx but no `id` field | `"Joplin /<resource> returned no id"` |

All five throw `JoplinClientError` (the last category is wrapped in one with the response's 2xx status for catch-path uniformity).

The library never logs. The caller (orchestrator, clipper, future tools) is responsible for logging.

### Token redaction

Response-body slices in thrown error messages have every occurrence of the literal token string replaced with `<redacted>` before the slice is taken. Implementation:

```ts
const detail = (await res.text().catch(() => "")).replaceAll(token, "<redacted>")
throw new JoplinClientError(`Joplin API error ${res.status}: ${detail.slice(0, 200)}`, res.status)
```

This defends against the specific Joplin behavior where the body of an authentication error echoes the supplied token verbatim.

### Edge cases (full list in brainstorming Section 6)

1. Empty `id` parameter on a get/update/delete — no client-side validation; Joplin returns 400.
2. Very long search queries — no length limit; Joplin returns 400 on rejection.
3. `updateNote` with empty patch — issues `PUT /notes/<id>` with `body: {}`; Joplin no-ops, library no-ops.
4. `updateNote({ todoDue: 0 })` — clears the due date (Joplin semantics).
5. `createNote` with both `body` and `bodyHtml` — library accepts both; Joplin behavior undefined (likely `body_html` wins).
6. `uploadResource` with > `MAX_ITEM_SIZE` blob — Joplin returns 413; surfaces as `JoplinClientError(413, ...)`.
7. `uploadResource` with 0-byte blob — accepted; documented edge case.
8. `deleteFolder` on non-existent id — Joplin returns 404; surfaces.
9. Composite race conditions — documented limitations (see above).
10. `findOrCreateTag` with whitespace-only title — plain `Error("Tag title cannot be empty.")` (not `JoplinClientError`; this is a programming error).
11. `appendToNote` body race — last writer wins.
12. Malformed page response from Joplin (e.g., `{}` with no `items`) — `paginate` reads `?? []`/`?? false` defensively.
13. Top-level folder with `parent_id` omitted — interfaces tolerate via optional fields.

## Testing

Vitest already wired. Tests under `tests/`, not co-located.

### New test files: 8. Estimated ~600–800 lines, ~77 tests total.

| File | Tests | Mock level |
|---|---|---|
| `tests/joplin-client-core.test.ts` | 18 | fetch (vi.fn returning `Response`) |
| `tests/joplin-ping.test.ts` | 4 | fetch |
| `tests/joplin-notes.test.ts` | 16 | fetch |
| `tests/joplin-folders.test.ts` | 10 | fetch |
| `tests/joplin-tags.test.ts` | 8 | fetch |
| `tests/joplin-search.test.ts` | 5 | fetch |
| `tests/joplin-resources.test.ts` | 5 | fetch |
| `tests/joplin-composites.test.ts` | 11 | library fn (via `vi.mock` of `../src/lib/joplin/folders` etc.) |

### Deleted

`tests/joplin-client.test.ts` (10 tests; absorbed/replaced by the new files above).

### What's explicitly NOT tested

- Real Joplin Desktop integration (manual smoke).
- `uploadResource` against real Joplin (multipart shape unit-tested; end-to-end manual).
- `AbortSignal` cancellation (not in V1 API).
- Performance / latency.

## Done-criteria checklist

- [ ] `pnpm typecheck` clean after the migration.
- [ ] `pnpm build` clean.
- [ ] `pnpm test` green — all new test files + everything still passing.
- [ ] `git grep "joplin-client"` returns no source-code hits (docs/specs OK).
- [ ] `src/lib/ai-chat-tools.ts` and `src/lib/joplin-clip-handler.ts` both import from `./joplin`; existing 3 tools (`joplin.ping`, `joplin.createNote`, `context.activeTab`) still work end-to-end.
- [ ] New chat tools (`joplin.getNote`, `joplin.appendToNote`, `joplin.searchNotes`, `joplin.listFolders`, `joplin.listTags`, `joplin.findOrCreateFolder`, `joplin.addTagToNoteByName`) execute against a real Joplin install and the AI chat surfaces their results inline.
- [ ] `joplin.searchNotes("rust", …)` returns at most 20 items with `truncated: true` when more exist.
- [ ] Token redaction: temporarily configure a known-bad token, send a chat that triggers a Joplin tool, verify the error toast does NOT echo the token.
- [ ] Destructive operations (`delete*`, `removeTagFromNote`) exported from the barrel but NOT registered as tools — confirm by listing the tool catalog in the orchestrator.

## Known limitations carried forward

1. **No request deduplication.** Two concurrent identical reads issue two HTTP calls. YAGNI.
2. **No retries.** A 500 from Joplin fails the call immediately. Caller decides whether to retry (the AI chat re-prompts the model with the error and lets it retry semantically).
3. **No `AbortSignal`.** Long-running `paginate` calls can't be cancelled mid-call. The chat orchestrator's turn-level cancel is the only cancellation point.
4. **Composite races permitted.** `findOrCreateFolder` and `findOrCreateTag` can produce duplicates under concurrent invocation.
5. **`appendToNote` last-writer-wins.** Concurrent body edits between get and put are silently overwritten.
6. **Destructive ops library-only.** The AI chat in V1 cannot delete data via tools. Library scripts (non-AI consumers) can.
7. **No tag-rename, no folder-move-to-trash flow.** `updateFolder` can move via `parent_id`; tag rename would require Joplin endpoints we're not exposing in V1.

## File-level deliverables

```
ai-dev-sidebar/
├── src/lib/
│   ├── joplin/                                  (new directory)
│   │   ├── client.ts                            (new)
│   │   ├── types.ts                             (new)
│   │   ├── ping.ts                              (new — migrated)
│   │   ├── notes.ts                             (new)
│   │   ├── folders.ts                           (new)
│   │   ├── tags.ts                              (new)
│   │   ├── search.ts                            (new)
│   │   ├── resources.ts                         (new)
│   │   ├── composites.ts                        (new)
│   │   └── index.ts                             (new)
│   ├── joplin-client.ts                         (DELETED)
│   ├── ai-chat-tools.ts                         ← imports updated; tool catalog grows
│   └── joplin-clip-handler.ts                   ← imports updated
└── tests/
    ├── joplin-client.test.ts                    (DELETED)
    ├── joplin-client-core.test.ts               (new)
    ├── joplin-ping.test.ts                      (new — migrated)
    ├── joplin-notes.test.ts                     (new)
    ├── joplin-folders.test.ts                   (new)
    ├── joplin-tags.test.ts                      (new)
    ├── joplin-search.test.ts                    (new)
    ├── joplin-resources.test.ts                 (new)
    └── joplin-composites.test.ts                (new)
```
