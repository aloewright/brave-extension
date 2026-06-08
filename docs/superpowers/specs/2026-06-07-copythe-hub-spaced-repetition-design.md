# copythe-hub — Spaced Repetition for Highlights (FSRS) — Design

**Date:** 2026-06-07
**Status:** Design — approved (engine + store locked); pending spec review
**Owner:** aloe

**Locked decisions:**
- **Engine:** `open-spaced-repetition/fsrs-rs` (the `fsrs` crate) compiled to **wasm** and imported **directly into the hub Worker** (one Worker, no HTTP hop). Precedent: `open-spaced-repetition/fsrs-browser` runs fsrs-rs in the browser via wasm.
- **Store:** a **new hub-local D1** database; the hub owns scheduling state only, highlight *content* stays in sidebar-api.

## 1. Overview

Add a spaced-repetition review mode to copythe-hub so saved **highlights/snippets** become flashcards scheduled by **FSRS** (Free Spaced Repetition Scheduler). Enrollment is **opt-in** — the user adds a highlight to the review deck via a toggle available both on the **dashboard highlight card** and in the **highlight detail view**. A `/review` screen surfaces what's due among enrolled cards, shows the quote, and the user rates recall (Again/Hard/Good/Easy); FSRS computes the next interval.

## 2. Goals / non-goals

### Goals (MVP)
- FSRS scheduling via fsrs-rs wasm, default FSRS-6 parameters, `desired_retention = 0.9`.
- Persist per-card review state in a hub D1; query "what's due now".
- `/review` UI: due/new queue, reveal-then-rate flow, next-interval labels, "all caught up" state.
- **Opt-in enrollment:** an "Add to review" toggle on highlight items — on the dashboard
  card and in the highlight detail view. Only enrolled highlights are scheduled. A sidebar
  "Review" entry shows a due-count badge.

### Non-goals (MVP, noted for later)
- **Parameter optimization** (training personalized FSRS weights from review history via `compute_parameters`) — this is where Rust/fsrs-rs most earns its keep, but it needs accumulated review logs first. Deferred to a follow-up; scheduling is identical with default parameters.
- Short-term "learning steps" (Anki-style sub-day steps). We use fsrs-rs's long-term scheduler directly; an "Again" simply yields the shortest interval (min 1 day).
- Per-card suspend/bury, decks/tags filtering, review history charts.

## 3. Architecture

```
hub Worker (TanStack Start)
  ├─ fsrs_wasm  (Rust `fsrs` crate → wasm32, wasm-bindgen)   ← scheduling math
  │     next_states(stability?, difficulty?, elapsed_days, retention) → 4 branches
  ├─ src/server/fsrs.ts        loads the wasm, typed wrapper
  ├─ src/server/review.fn.ts   reviewQueue / gradeCard / reviewStats (server fns)
  ├─ D1 binding REVIEWS         table `reviews` (scheduling state)
  └─ BFF → sidebar-api          highlight content (/api/highlights)
```

The hub remains a BFF for highlight **content**; it now also owns **scheduling state** in its own D1.

## 4. FSRS wasm crate (`fsrs-wasm/`)

A Rust crate in the hub repo wrapping the `fsrs` crate. Single exported function via `wasm-bindgen`:

```rust
// next_states for a card. `has_memory=false` → new card (previous_state = None).
#[wasm_bindgen]
pub fn next_states(
    stability: f32, difficulty: f32, has_memory: bool,
    elapsed_days: u32, desired_retention: f32,
) -> JsValue  // serde → { again:{stability,difficulty,interval}, hard:{…}, good:{…}, easy:{…} }
```

Backed by the documented API:
```rust
let fsrs = FSRS::default();
let prev = has_memory.then_some(MemoryState { stability, difficulty });
let ns = fsrs.next_states(prev, desired_retention, elapsed_days)?;
// ns.again / ns.hard / ns.good / ns.easy → ItemState { memory: MemoryState, interval: f32 }
```

`interval_days = interval.round().max(1.0) as u32`. Built with `wasm-pack build --target bundler` (the `fsrs-browser` precedent). The generated `.wasm` + JS glue is imported from `src/server/fsrs.ts`; Cloudflare Workers support wasm modules and the `@cloudflare/vite-plugin` bundles them. **This is the riskiest piece — built and deployed first as a spike** (a server fn returning `next_states(none,…)` proves the wasm path on CF before any feature work).

`src/server/fsrs.ts` exposes a typed `nextStates(state | null, elapsedDays, retention=0.9)` returning the four branches, plus a **pure JS fallback** (a fixed-interval schedule: 1/3/7/14… days) used only if the wasm fails to load, so reviews never hard-block.

## 5. Review store (hub D1)

`wrangler.jsonc` gains a `d1_databases` binding `REVIEWS`. Migration `0001_reviews.sql`:

```sql
CREATE TABLE reviews (
  highlight_id TEXT PRIMARY KEY,
  stability    REAL NOT NULL,
  difficulty   REAL NOT NULL,
  due          INTEGER NOT NULL,  -- epoch ms
  last_review  INTEGER NOT NULL,  -- epoch ms
  reps         INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'review',  -- 'new' before first grade
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_reviews_due ON reviews(due);
```

**Enrollment is explicit:** a highlight is in the deck **iff it has a `reviews` row**.
"Add to review" inserts a row with `state='new'`, `due=now`, `stability=0`, `difficulty=0`
(placeholders until the first grade computes real FSRS memory). "Remove" deletes the row.
A highlight with no row is simply not scheduled.

## 6. Server functions (`src/server/review.fn.ts`)

- **`enrollCard({ highlightId })`** → INSERT a `reviews` row (`state='new'`, `due=now`,
  `stability=0`, `difficulty=0`, `reps=0`, `lapses=0`); idempotent (ignore if exists).
- **`unenrollCard({ highlightId })`** → DELETE the row.
- **`enrolledHighlightIds()`** → `string[]` of enrolled highlight ids, so the dashboard
  cards and detail view render the toggle's on/off state.
- **`reviewQueue({ limit=30 })`** → fetch highlights from sidebar-api (`fetchHighlights`) +
  all `reviews` rows from D1; merge in TS (pure `buildQueue`): **enrolled** cards that are
  `state='new'` or `due ≤ now` (new first, then due-sorted), capped at `limit`, each joined
  to its quote/source. Returns `[{ highlightId, quote, note?, sourceUrl?, sourceTitle?, state, due? }]`.
- **`gradeCard({ highlightId, rating })`** (rating ∈ again|hard|good|easy) → read the row;
  `elapsedDays = state==='new' ? 0 : floor((now - last_review)/86400000)`;
  `nextStates(state==='new' ? null : {stability,difficulty}, elapsedDays)`; take the rated
  branch; upsert `stability, difficulty, due = now + interval*86400000, last_review = now,
  reps+1, lapses + (rating==='again'?1:0), state='review'`. Returns the new `due`/interval.
- **`reviewStats()`** → `{ due, new, enrolled }` (due = enrolled rows `state='review'` and
  `due ≤ now`; new = rows `state='new'`; enrolled = total rows) for the sidebar badge
  (badge shows `due + new`).

Auth/identity unchanged (single-user behind Access). All D1 access via `cloudflare:workers` env in server-only modules.

## 7. UI

- **Opt-in toggle (two places):**
  - **Dashboard:** highlight-type `ItemCard`s get a small "Add to review / In review" toggle
    (brain/✦ icon button). The dashboard loader also calls `enrolledHighlightIds()` so each
    card shows the correct on/off state; toggling calls `enrollCard`/`unenrollCard` and
    invalidates.
  - **Detail view:** the highlight detail (`/item/highlights/$id`, `HighlightView`) shows an
    "Add to review" / "In review ✓" button with the same handlers.
- **Sidebar:** a **"Review"** item with a `Badge` showing `due + new` (from `reviewStats`); links to `/review`.
- **`/review` route:** loads `reviewQueue`. Card UI (Mantine): the highlight **quote** (large) +
  source; a **Reveal** button (recall first); after reveal, four rating buttons **Again / Hard /
  Good / Easy**, each sub-labelled with its next interval (from a client-side `nextStates`
  preview, e.g. "Good · 4d"). Grading advances to the next card; when empty, an **"All caught
  up ✦"** state with the next-due time. Progress indicator (n/total this session). Keyboard:
  Space=reveal, 1–4=rate. If the deck is empty (nothing enrolled), an empty state points the
  user to add highlights from the library.

## 8. Data flow & error handling

- Content from sidebar-api, scheduling state from D1 — joined by `highlight_id` in `buildQueue`.
- sidebar-api unreachable → Review shows a clear error (reuses the existing client-error pattern).
- wasm load failure → `nextStates` fallback schedule; logged, never blocks grading.
- Deleted highlights: a `reviews` row with no matching highlight is simply skipped by `buildQueue` (and can be GC'd later).

## 9. Testing

- **Rust:** `cargo test` in `fsrs-wasm/` — `next_states` for a new card and a known memory state returns the expected four branches with sane intervals (delegating FSRS correctness to upstream; we test the wrapper/serialization).
- **TS (pure, vitest):**
  - `buildQueue(highlights, rows, now, limit)` — enrolled-only (`new` or `due ≤ now`), new-first
    then due-sorted, cap, skipping orphan rows (enrolled id with no matching highlight).
  - `dueFromInterval(now, intervalDays)` and the grade→row mapping (reps/lapses/state) with a **mocked** `nextStates`.
  - `reviewStats` counting.
- **Build/deploy gate:** the wasm spike must deploy and return a schedule from the live hub before feature tasks proceed.

## 10. Build phases (plan order)
1. **fsrs-wasm spike** — Rust crate, wasm build, import into hub, a server fn returns `next_states(new)`, deployed live. De-risks the toolchain.
2. **D1 + schema** — binding, migration, applied remote.
3. **Server fns** — `buildQueue` (TDD) + enroll/unenroll/enrolledHighlightIds + reviewQueue/gradeCard/reviewStats.
4. **Opt-in toggles** — "Add to review" on the dashboard highlight card + the highlight detail view.
5. **Review UI** — `/review` route, sidebar entry + badge, reveal/rate flow.
6. **Polish** — keyboard shortcuts, empty/next-due state, interval labels.

## 11. Open decisions (resolve at plan time)
- Session cap default (30); no daily new-card limit in MVP (enrollment is already manual/opt-in).
- Whether to denormalize the quote into `reviews` (avoid depending on sidebar-api at review time) — MVP: no, join live.
- Icon/affordance for the toggle (brain vs ✦ vs "Review") — pick during UI task.
