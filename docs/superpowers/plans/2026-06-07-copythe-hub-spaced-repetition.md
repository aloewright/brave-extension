# copythe-hub — Spaced Repetition (FSRS wasm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in FSRS spaced-repetition review mode for highlights to copythe-hub — scheduling computed by the Rust `fsrs` crate compiled to wasm and imported into the hub Worker, review state in a new hub D1, a `/review` screen, and "Add to review" toggles on the dashboard card + highlight detail view.

**Architecture:** A Rust crate (`fsrs-wasm/`) wraps `fsrs::FSRS::next_states` and is compiled to wasm via `wasm-pack`; the generated module is imported by a hub server module. A new hub D1 (`REVIEWS`) stores per-card scheduling state. Pure TS helpers (`buildQueue`, grade mapping) are unit-tested; server functions glue D1 + wasm + the sidebar-api highlight content. The riskiest piece (Rust→wasm on Cloudflare) is a deployed spike in Task 1 before any feature work.

**Tech Stack:** Rust + `fsrs` crate + `wasm-bindgen`/`wasm-pack`, Cloudflare D1, TanStack Start server functions, Mantine v9, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-copythe-hub-spaced-repetition-design.md`.

**Repo:** `~/Development/copythe-hub`.

**Key API (verified, `fsrs` 5.x):**
```rust
let fsrs = FSRS::default();
let ns = fsrs.next_states(previous_state: Option<MemoryState>, desired_retention: f32, elapsed_days: u32)?;
// ns.again / ns.hard / ns.good / ns.easy : ItemState { memory: MemoryState{stability,difficulty}, interval: f32 }
```
Fallback crate if the Burn-heavy `fsrs` wasm fails CF build/size limits: **`rs-fsrs`** (same org, lean scheduler) — swap the crate + call shape in `fsrs-wasm/src/lib.rs`, the wasm/TS interface stays identical.

---

## File Structure

```
copythe-hub/
  fsrs-wasm/                     # Rust crate (NEW)
    Cargo.toml
    src/lib.rs                  # wasm-bindgen wrapper over fsrs::next_states
  src/server/fsrs-wasm-pkg/     # wasm-pack output (generated; committed)
  src/server/fsrs.ts            # load wasm + typed nextStates() + JS fallback
  src/lib/review.ts             # pure: buildQueue, dueFromInterval, applyGrade (TDD)
  src/server/review-db.ts       # D1 query helpers (rows, upsert, enrolled ids)
  src/server/review.fn.ts       # server fns: queue/grade/stats/enroll/unenroll/enrolledIds
  src/components/ReviewToggle.tsx
  src/routes/review.tsx         # /review screen
  migrations/0001_reviews.sql   # D1 schema
  wrangler.jsonc                # + d1_databases REVIEWS binding
  # modified: src/routes/index.tsx (sidebar Review entry+badge, enrolled ids on loader),
  #           src/components/ItemCard.tsx (toggle on highlight cards),
  #           src/components/viewers/HighlightView.tsx (toggle),
  #           src/lib/env.ts / src/server/env.server.ts (REVIEWS binding type)
  tests/review.test.ts
```

---

### Task 1: FSRS wasm spike (de-risk Rust→wasm on Cloudflare)

**Files:**
- Create: `fsrs-wasm/Cargo.toml`, `fsrs-wasm/src/lib.rs`
- Create: `src/server/fsrs.ts`
- Modify: `package.json` (build:wasm script)

- [ ] **Step 1: Install the wasm toolchain**

Run:
```bash
rustup target add wasm32-unknown-unknown
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh
```
Expected: `wasm32-unknown-unknown` installed; `wasm-pack --version` prints a version.

- [ ] **Step 2: Write `fsrs-wasm/Cargo.toml`**

```toml
[package]
name = "fsrs-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
fsrs = "5.2.0"
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"

[profile.release]
opt-level = "z"
lto = true
```

- [ ] **Step 3: Write `fsrs-wasm/src/lib.rs`**

```rust
use fsrs::{FSRS, MemoryState};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct Branch {
    stability: f32,
    difficulty: f32,
    interval: u32,
}

#[derive(Serialize)]
struct NextStatesOut {
    again: Branch,
    hard: Branch,
    good: Branch,
    easy: Branch,
}

fn branch(item: fsrs::ItemState) -> Branch {
    Branch {
        stability: item.memory.stability,
        difficulty: item.memory.difficulty,
        interval: (item.interval.round().max(1.0)) as u32,
    }
}

/// has_memory=false → new card (previous_state = None).
#[wasm_bindgen]
pub fn next_states(
    stability: f32,
    difficulty: f32,
    has_memory: bool,
    elapsed_days: u32,
    desired_retention: f32,
) -> Result<JsValue, JsValue> {
    let fsrs = FSRS::default();
    let prev = if has_memory {
        Some(MemoryState { stability, difficulty })
    } else {
        None
    };
    let ns = fsrs
        .next_states(prev, desired_retention, elapsed_days)
        .map_err(|e| JsValue::from_str(&format!("{e:?}")))?;
    let out = NextStatesOut {
        again: branch(ns.again),
        hard: branch(ns.hard),
        good: branch(ns.good),
        easy: branch(ns.easy),
    };
    serde_wasm_bindgen::to_value(&out).map_err(|e| JsValue::from_str(&e.to_string()))
}
```

- [ ] **Step 4: Build the wasm package**

Run:
```bash
cd ~/Development/copythe-hub/fsrs-wasm && wasm-pack build --target bundler --release --out-dir ../src/server/fsrs-wasm-pkg
```
Expected: `../src/server/fsrs-wasm-pkg/` contains `fsrs_wasm_bg.wasm`, `fsrs_wasm.js`, `fsrs_wasm.d.ts`, `package.json`.
If this fails (Burn won't target wasm32 / size), switch `fsrs = "5.2.0"` → `rs-fsrs = "1"` in Cargo.toml and adapt `lib.rs` to rs-fsrs's `Card`/`next_interval` API (same wasm signature), then rebuild. Record the swap in the commit message.

Add to `copythe-hub/package.json` scripts:
```json
"build:wasm": "cd fsrs-wasm && wasm-pack build --target bundler --release --out-dir ../src/server/fsrs-wasm-pkg"
```

- [ ] **Step 5: Write `src/server/fsrs.ts`** (typed wrapper + fallback)

```typescript
import init, { next_states } from "./fsrs-wasm-pkg/fsrs_wasm.js"
// @ts-expect-error - vite/CF resolves the wasm asset URL
import wasmUrl from "./fsrs-wasm-pkg/fsrs_wasm_bg.wasm?url"

export interface Memory { stability: number; difficulty: number }
export interface Branch extends Memory { interval: number } // interval in days
export type Rating = "again" | "hard" | "good" | "easy"
export type NextStates = Record<Rating, Branch>

let ready: Promise<boolean> | null = null
async function ensure(): Promise<boolean> {
  if (!ready) {
    ready = init(wasmUrl).then(() => true).catch(() => false)
  }
  return ready
}

const RETENTION = 0.9

export async function nextStates(
  prev: Memory | null,
  elapsedDays: number,
  retention = RETENTION,
): Promise<NextStates> {
  if (await ensure()) {
    return next_states(
      prev?.stability ?? 0,
      prev?.difficulty ?? 0,
      prev !== null,
      Math.max(0, Math.floor(elapsedDays)),
      retention,
    ) as NextStates
  }
  return fallback(prev)
}

// Fixed-interval fallback if wasm fails to load — keeps reviews working.
function fallback(prev: Memory | null): NextStates {
  const base = prev?.stability ?? 1
  const mk = (mult: number, min: number): Branch => ({
    stability: Math.max(min, base * mult),
    difficulty: prev?.difficulty ?? 5,
    interval: Math.max(1, Math.round(Math.max(min, base * mult))),
  })
  return { again: mk(0.2, 1), hard: mk(0.8, 1), good: mk(1.5, 1), easy: mk(2.5, 3) }
}
```
(If `init` requires no arg under the bundler target, drop `wasmUrl`; verify against the generated `fsrs_wasm.d.ts` — adjust import to match. The interface `nextStates` stays the same.)

- [ ] **Step 6: Prove it from a temporary server route, build + deploy**

Create `src/routes/_fsrs-spike.tsx`:
```tsx
import { createFileRoute } from "@tanstack/react-router"
import { nextStates } from "~/server/fsrs"
export const Route = createFileRoute("/_fsrs-spike")({
  server: {
    handlers: {
      GET: async () => Response.json(await nextStates(null, 0)),
    },
  },
})
```
Run: `cd ~/Development/copythe-hub && pnpm build && pnpm run deploy`
Then (authenticated, or temporarily with HUB_DEV_BYPASS via `pnpm dev`): `curl http://localhost:PORT/_fsrs-spike`
Expected: JSON `{ "again": {stability,difficulty,interval}, "hard":…, "good":…, "easy":… }` with sane intervals (good ≥ 1). This proves Rust→wasm runs on the hub.

- [ ] **Step 7: Delete the spike route, commit**

```bash
cd ~/Development/copythe-hub && rm src/routes/_fsrs-spike.tsx
git add fsrs-wasm src/server/fsrs.ts src/server/fsrs-wasm-pkg package.json src/routeTree.gen.ts
git commit -m "feat(srs): fsrs-rs compiled to wasm, typed nextStates wrapper + fallback"
```

---

### Task 2: D1 review store

**Files:**
- Create: `migrations/0001_reviews.sql`
- Modify: `wrangler.jsonc`, `src/lib/env.ts`, `src/server/env.server.ts`

- [ ] **Step 1: Create the D1 database**

Run: `cd ~/Development/copythe-hub && pnpm exec wrangler d1 create copythe-hub-reviews`
Expected: prints a `database_id`. Copy it for the next step.

- [ ] **Step 2: Write `migrations/0001_reviews.sql`**

```sql
CREATE TABLE reviews (
  highlight_id TEXT PRIMARY KEY,
  stability    REAL    NOT NULL DEFAULT 0,
  difficulty   REAL    NOT NULL DEFAULT 0,
  due          INTEGER NOT NULL,
  last_review  INTEGER NOT NULL DEFAULT 0,
  reps         INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  state        TEXT    NOT NULL DEFAULT 'new',
  created_at   INTEGER NOT NULL
);
CREATE INDEX idx_reviews_due ON reviews(due);
```

- [ ] **Step 3: Add the binding to `wrangler.jsonc`** (use the database_id from Step 1)

```jsonc
  "d1_databases": [
    {
      "binding": "REVIEWS",
      "database_name": "copythe-hub-reviews",
      "database_id": "PASTE_DATABASE_ID_HERE",
      "migrations_dir": "migrations"
    }
  ],
```
(Insert as a sibling of `"vars"`.)

- [ ] **Step 4: Apply the migration (local + remote)**

Run:
```bash
cd ~/Development/copythe-hub
pnpm exec wrangler d1 migrations apply copythe-hub-reviews --local
pnpm exec wrangler d1 migrations apply copythe-hub-reviews --remote
```
Expected: both report the migration applied; `reviews` table created.

- [ ] **Step 5: Add the binding type** — in `src/lib/env.ts`, add to `HubEnv`:

```typescript
  REVIEWS: D1Database
```
(`D1Database` is provided by the generated `worker-configuration.d.ts`; run `pnpm cf-typegen` after editing `wrangler.jsonc` so the type resolves.) Then in `src/server/env.server.ts`'s returned object add:
```typescript
    REVIEWS: e.REVIEWS,
```

- [ ] **Step 6: Type-check + commit**

Run: `cd ~/Development/copythe-hub && pnpm cf-typegen && pnpm exec tsc --noEmit`
Expected: no errors.
```bash
git add wrangler.jsonc migrations src/lib/env.ts src/server/env.server.ts worker-configuration.d.ts
git commit -m "feat(srs): hub D1 reviews store + binding"
```

---

### Task 3: Pure review logic (TDD)

**Files:**
- Create: `src/lib/review.ts`
- Test: `tests/review.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/review.test.ts
import { describe, it, expect } from "vitest"
import { buildQueue, dueFromInterval, applyGrade, type ReviewRow } from "~/lib/review"

const DAY = 86_400_000
const hl = (id: string, text: string) => ({ id, type: "highlight" as const, source: "highlights" as const, title: text, tags: [] as string[], createdAt: "" })

describe("buildQueue", () => {
  const now = 1_000 * DAY
  it("includes new cards and due cards, skips not-yet-due, caps, new-first", () => {
    const highlights = [hl("a", "A"), hl("b", "B"), hl("c", "C"), hl("d", "D")]
    const rows: ReviewRow[] = [
      { highlight_id: "b", stability: 1, difficulty: 5, due: now - DAY, last_review: now - 2 * DAY, reps: 1, lapses: 0, state: "review", created_at: 0 },
      { highlight_id: "c", stability: 1, difficulty: 5, due: now + DAY, last_review: now, reps: 1, lapses: 0, state: "review", created_at: 0 },
      { highlight_id: "d", stability: 0, difficulty: 0, due: now, last_review: 0, reps: 0, lapses: 0, state: "new", created_at: 0 },
    ]
    const q = buildQueue(highlights, rows, now, 30)
    expect(q.map((c) => c.highlightId)).toEqual(["d", "b"]) // new(d) first, then due(b); c not due; a not enrolled
    expect(q[0].quote).toBe("D")
  })
  it("respects the cap", () => {
    const highlights = Array.from({ length: 5 }, (_, i) => hl(String(i), `H${i}`))
    const rows: ReviewRow[] = highlights.map((h) => ({ highlight_id: h.id, stability: 0, difficulty: 0, due: now, last_review: 0, reps: 0, lapses: 0, state: "new" as const, created_at: 0 }))
    expect(buildQueue(highlights, rows, now, 2)).toHaveLength(2)
  })
  it("skips orphan rows (enrolled id with no highlight)", () => {
    const rows: ReviewRow[] = [{ highlight_id: "gone", stability: 0, difficulty: 0, due: now, last_review: 0, reps: 0, lapses: 0, state: "new", created_at: 0 }]
    expect(buildQueue([], rows, now, 30)).toEqual([])
  })
})

describe("dueFromInterval", () => {
  it("returns now + intervalDays in ms", () => {
    expect(dueFromInterval(1000 * DAY, 4)).toBe(1004 * DAY)
  })
})

describe("applyGrade", () => {
  const now = 10 * DAY
  it("new card → review state, due from branch interval, reps+1", () => {
    const row = applyGrade(null, "good", { stability: 3, difficulty: 5, interval: 4 }, now)
    expect(row).toMatchObject({ stability: 3, difficulty: 5, state: "review", reps: 1, lapses: 0, last_review: now, due: now + 4 * DAY })
  })
  it("again increments lapses", () => {
    const prev: ReviewRow = { highlight_id: "x", stability: 5, difficulty: 5, due: now, last_review: now - 5 * DAY, reps: 3, lapses: 1, state: "review", created_at: 0 }
    const row = applyGrade(prev, "again", { stability: 1, difficulty: 6, interval: 1 }, now)
    expect(row).toMatchObject({ reps: 4, lapses: 2, state: "review", due: now + DAY })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `cd ~/Development/copythe-hub && pnpm vitest run tests/review.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write `src/lib/review.ts`**

```typescript
import type { LibraryItem } from "~/lib/library"
import type { Branch, Rating } from "~/server/fsrs"

const DAY = 86_400_000

export interface ReviewRow {
  highlight_id: string
  stability: number
  difficulty: number
  due: number
  last_review: number
  reps: number
  lapses: number
  state: "new" | "review"
  created_at: number
}

export interface QueueCard {
  highlightId: string
  quote: string
  sourceUrl?: string
  state: "new" | "review"
  due?: number
}

export function buildQueue(
  highlights: LibraryItem[],
  rows: ReviewRow[],
  now: number,
  limit: number,
): QueueCard[] {
  const byId = new Map(highlights.map((h) => [h.id, h]))
  const eligible = rows.filter((r) => r.state === "new" || r.due <= now)
  eligible.sort((a, b) => {
    if (a.state !== b.state) return a.state === "new" ? -1 : 1 // new first
    return a.due - b.due
  })
  const out: QueueCard[] = []
  for (const r of eligible) {
    const h = byId.get(r.highlight_id)
    if (!h) continue // orphan
    out.push({
      highlightId: r.highlight_id,
      quote: h.title,
      sourceUrl: h.url,
      state: r.state,
      due: r.due,
    })
    if (out.length >= limit) break
  }
  return out
}

export function dueFromInterval(now: number, intervalDays: number): number {
  return now + intervalDays * DAY
}

export function applyGrade(
  prev: ReviewRow | null,
  rating: Rating,
  branch: Branch,
  now: number,
): ReviewRow {
  return {
    highlight_id: prev?.highlight_id ?? "",
    stability: branch.stability,
    difficulty: branch.difficulty,
    due: dueFromInterval(now, branch.interval),
    last_review: now,
    reps: (prev?.reps ?? 0) + 1,
    lapses: (prev?.lapses ?? 0) + (rating === "again" ? 1 : 0),
    state: "review",
    created_at: prev?.created_at ?? now,
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run tests/review.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/Development/copythe-hub && git add src/lib/review.ts tests/review.test.ts && git commit -m "feat(srs): pure review logic — buildQueue, dueFromInterval, applyGrade"
```

---

### Task 4: D1 query helpers

**Files:**
- Create: `src/server/review-db.ts`

- [ ] **Step 1: Write `src/server/review-db.ts`**

```typescript
import { getHubEnv } from "./env.server"
import type { ReviewRow } from "~/lib/review"

function db() {
  return getHubEnv().REVIEWS
}

export async function allRows(): Promise<ReviewRow[]> {
  const { results } = await db().prepare("SELECT * FROM reviews").all<ReviewRow>()
  return results ?? []
}

export async function getRow(id: string): Promise<ReviewRow | null> {
  return (await db().prepare("SELECT * FROM reviews WHERE highlight_id = ?").bind(id).first<ReviewRow>()) ?? null
}

export async function enrolledIds(): Promise<string[]> {
  const { results } = await db().prepare("SELECT highlight_id FROM reviews").all<{ highlight_id: string }>()
  return (results ?? []).map((r) => r.highlight_id)
}

export async function enroll(id: string, now: number): Promise<void> {
  await db()
    .prepare(
      "INSERT OR IGNORE INTO reviews (highlight_id, stability, difficulty, due, last_review, reps, lapses, state, created_at) VALUES (?, 0, 0, ?, 0, 0, 0, 'new', ?)",
    )
    .bind(id, now, now)
    .run()
}

export async function unenroll(id: string): Promise<void> {
  await db().prepare("DELETE FROM reviews WHERE highlight_id = ?").bind(id).run()
}

export async function upsertRow(r: ReviewRow): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO reviews (highlight_id, stability, difficulty, due, last_review, reps, lapses, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(highlight_id) DO UPDATE SET
         stability=excluded.stability, difficulty=excluded.difficulty, due=excluded.due,
         last_review=excluded.last_review, reps=excluded.reps, lapses=excluded.lapses, state=excluded.state`,
    )
    .bind(r.highlight_id, r.stability, r.difficulty, r.due, r.last_review, r.reps, r.lapses, r.state, r.created_at)
    .run()
}
```

- [ ] **Step 2: Type-check** — `cd ~/Development/copythe-hub && pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 3: Commit** — `git add src/server/review-db.ts && git commit -m "feat(srs): D1 review-row query helpers"`

---

### Task 5: Review server functions

**Files:**
- Create: `src/server/review.fn.ts`

- [ ] **Step 1: Write `src/server/review.fn.ts`**

```typescript
import { createServerFn } from "@tanstack/react-start"
import { fetchHighlights } from "./sidebar"
import { normalizeHighlight } from "~/lib/library"
import { buildQueue, applyGrade, type QueueCard } from "~/lib/review"
import { allRows, getRow, enroll, unenroll, enrolledIds, upsertRow } from "./review-db"
import { nextStates, type Rating } from "./fsrs"

const DAY = 86_400_000

export const reviewQueue = createServerFn({ method: "GET" }).handler(
  async (): Promise<QueueCard[]> => {
    const [highlights, rows] = await Promise.all([
      fetchHighlights().then((h) => h.map(normalizeHighlight)).catch(() => []),
      allRows().catch(() => []),
    ])
    return buildQueue(highlights, rows, Date.now(), 30)
  },
)

export const reviewStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ due: number; new: number; enrolled: number }> => {
    const rows = await allRows().catch(() => [])
    const now = Date.now()
    return {
      due: rows.filter((r) => r.state === "review" && r.due <= now).length,
      new: rows.filter((r) => r.state === "new").length,
      enrolled: rows.length,
    }
  },
)

export const listEnrolled = createServerFn({ method: "GET" }).handler(
  async (): Promise<string[]> => enrolledIds().catch(() => []),
)

export const enrollCard = createServerFn({ method: "POST" })
  .inputValidator((data: { highlightId: string }) => data)
  .handler(async ({ data }) => {
    await enroll(data.highlightId, Date.now())
    return { ok: true }
  })

export const unenrollCard = createServerFn({ method: "POST" })
  .inputValidator((data: { highlightId: string }) => data)
  .handler(async ({ data }) => {
    await unenroll(data.highlightId)
    return { ok: true }
  })

export const gradeCard = createServerFn({ method: "POST" })
  .inputValidator((data: { highlightId: string; rating: Rating }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; dueDays: number }> => {
    const now = Date.now()
    const prev = await getRow(data.highlightId)
    const elapsedDays = prev && prev.state === "review" ? Math.floor((now - prev.last_review) / DAY) : 0
    const ns = await nextStates(
      prev && prev.state === "review" ? { stability: prev.stability, difficulty: prev.difficulty } : null,
      elapsedDays,
    )
    const branch = ns[data.rating]
    const row = applyGrade(prev, data.rating, branch, now)
    row.highlight_id = data.highlightId
    await upsertRow(row)
    return { ok: true, dueDays: branch.interval }
  })
```

- [ ] **Step 2: Type-check + build** — `cd ~/Development/copythe-hub && pnpm build` → succeeds.

- [ ] **Step 3: Commit** — `git add src/server/review.fn.ts && git commit -m "feat(srs): review server fns — queue/stats/enroll/unenroll/grade"`

---

### Task 6: "Add to review" toggle component + dashboard/detail wiring

**Files:**
- Create: `src/components/ReviewToggle.tsx`
- Modify: `src/components/ItemCard.tsx`, `src/components/viewers/HighlightView.tsx`, `src/routes/index.tsx`, `src/routes/item.$source.$id.tsx`

- [ ] **Step 1: Write `src/components/ReviewToggle.tsx`**

```tsx
import { ActionIcon, Tooltip } from "@mantine/core"
import { useState } from "react"
import { enrollCard, unenrollCard } from "~/server/review.fn"

export function ReviewToggle({
  highlightId, enrolled, onChange, size = "sm",
}: {
  highlightId: string
  enrolled: boolean
  onChange?: () => void
  size?: "sm" | "md"
}) {
  const [on, setOn] = useState(enrolled)
  const [busy, setBusy] = useState(false)
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setBusy(true)
    if (on) await unenrollCard({ data: { highlightId } })
    else await enrollCard({ data: { highlightId } })
    setOn(!on)
    setBusy(false)
    onChange?.()
  }
  return (
    <Tooltip label={on ? "In review deck — click to remove" : "Add to review deck"} withArrow>
      <ActionIcon
        variant={on ? "filled" : "subtle"}
        color="brand"
        size={size}
        loading={busy}
        onClick={toggle}
        aria-label="Toggle review"
        aria-pressed={on}
      >
        ✦
      </ActionIcon>
    </Tooltip>
  )
}
```

- [ ] **Step 2: Dashboard loader exposes enrolled ids.** In `src/routes/index.tsx`, change the loader + import:

Add import:
```tsx
import { listEnrolled } from "~/server/review.fn"
import { ReviewToggle } from "~/components/ReviewToggle"
```
Change the loader to fetch both:
```tsx
  loader: async () => {
    const [items, enrolled] = await Promise.all([listLibrary(), listEnrolled()])
    return { items, enrolled }
  },
```
In `Home()`, read it: `const { items, enrolled } = Route.useLoaderData()` and make a set: `const enrolledSet = new Set(enrolled)`. Pass to each card: change the grid map to
```tsx
            {filtered.map((item: LibraryItem) => (
              <ItemCard
                key={`${item.source}:${item.id}`}
                item={item}
                enrolled={item.type === "highlight" ? enrolledSet.has(item.id) : undefined}
                onReviewChange={() => router.invalidate()}
              />
            ))}
```

- [ ] **Step 3: `ItemCard` renders the toggle for highlights.** In `src/components/ItemCard.tsx`, extend props and add the toggle in the badge row:

Change the signature:
```tsx
import { ReviewToggle } from "~/components/ReviewToggle"
// ...
export function ItemCard({
  item, enrolled, onReviewChange,
}: {
  item: LibraryItem
  enrolled?: boolean
  onReviewChange?: () => void
}) {
```
Inside the `<Group gap={6}>` badge row, after the tag badges, add:
```tsx
          {item.type === "highlight" && enrolled !== undefined && (
            <div style={{ marginLeft: "auto" }} onClick={(e) => e.preventDefault()}>
              <ReviewToggle highlightId={item.id} enrolled={enrolled} onChange={onReviewChange} />
            </div>
          )}
```

- [ ] **Step 4: Detail view toggle.** In `src/routes/item.$source.$id.tsx`, the loader also fetches enrollment for highlights; pass it to `HighlightView`. Add import `import { listEnrolled } from "~/server/review.fn"`. In the loader, after getting `item`:
```tsx
    const enrolled =
      item.source === "highlights" ? (await listEnrolled()).includes(item.id) : false
    return { item, enrolled }
```
Read `const { item, enrolled } = Route.useLoaderData()`. Change the highlight render:
```tsx
          {item.type === "highlight" && (
            <HighlightView item={item} enrolled={enrolled} onChange={() => router.invalidate()} />
          )}
```

- [ ] **Step 5: `HighlightView` shows the toggle.** In `src/components/viewers/HighlightView.tsx`:
```tsx
import { Group, Button } from "@mantine/core"
import { ReviewToggle } from "~/components/ReviewToggle"
// extend props:
export function HighlightView({
  item, enrolled, onChange,
}: { item: LibraryItem; enrolled?: boolean; onChange?: () => void }) {
```
Add at the top of the returned `<Stack>`:
```tsx
      {enrolled !== undefined && (
        <Group gap="xs">
          <ReviewToggle highlightId={item.id} enrolled={enrolled} onChange={onChange} size="md" />
          <span style={{ fontSize: 13, opacity: 0.7 }}>
            {enrolled ? "In your review deck" : "Add to your review deck"}
          </span>
        </Group>
      )}
```

- [ ] **Step 6: Build + dev verify** — `cd ~/Development/copythe-hub && pnpm build` (succeeds). `pnpm dev`, open a highlight card / its detail, click ✦ → it fills; reload → still enrolled (persisted in D1). Stop dev.

- [ ] **Step 7: Commit**

```bash
cd ~/Development/copythe-hub
git add src/components/ReviewToggle.tsx src/components/ItemCard.tsx src/components/viewers/HighlightView.tsx src/routes/index.tsx "src/routes/item.\$source.\$id.tsx"
git commit -m "feat(srs): Add-to-review toggle on dashboard cards + highlight detail"
```

---

### Task 7: `/review` screen + sidebar entry/badge

**Files:**
- Create: `src/routes/review.tsx`
- Modify: `src/routes/index.tsx`

- [ ] **Step 1: Write `src/routes/review.tsx`**

```tsx
import { createFileRoute, Link, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { AppShell, Group, Button, Title, Text, Stack, Paper, Progress } from "@mantine/core"
import { reviewQueue, gradeCard } from "~/server/review.fn"
import type { Rating } from "~/server/fsrs"

export const Route = createFileRoute("/review")({
  loader: async () => ({ queue: await reviewQueue() }),
  component: Review,
})

const RATINGS: { key: Rating; label: string; color: string }[] = [
  { key: "again", label: "Again", color: "red" },
  { key: "hard", label: "Hard", color: "orange" },
  { key: "good", label: "Good", color: "brand" },
  { key: "easy", label: "Easy", color: "teal" },
]

function Review() {
  const { queue } = Route.useLoaderData()
  const router = useRouter()
  const [idx, setIdx] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const total = queue.length
  const card = queue[idx]

  const grade = async (rating: Rating) => {
    if (!card) return
    setBusy(true)
    await gradeCard({ data: { highlightId: card.highlightId, rating } })
    setBusy(false)
    setRevealed(false)
    if (idx + 1 >= total) router.invalidate()
    else setIdx(idx + 1)
  }

  return (
    <AppShell header={{ height: 56 }} padding="xl">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Button component={Link} to="/" variant="subtle" radius="xl">← Library</Button>
          {total > 0 && <Text size="sm" c="dimmed">{Math.min(idx + 1, total)} / {total}</Text>}
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        {total > 0 && <Progress value={(idx / total) * 100} mb="lg" radius="xl" size="sm" color="brand" />}
        {!card ? (
          <Stack align="center" gap="xs" py={80}>
            <Title order={2}>All caught up ✦</Title>
            <Text c="dimmed">No highlights due for review right now.</Text>
            <Button component={Link} to="/" mt="sm" variant="light">Back to library</Button>
          </Stack>
        ) : (
          <Stack maw={640} mx="auto" gap="lg" align="center">
            <Paper withBorder radius="lg" p="xl" w="100%"
              style={{ borderLeft: "4px solid var(--mantine-color-brand-6)" }}>
              <Text fs="italic" style={{ fontSize: 22, lineHeight: 1.5 }}>“{card.quote}”</Text>
            </Paper>
            {!revealed ? (
              <Button size="lg" radius="xl" onClick={() => setRevealed(true)}>Reveal</Button>
            ) : (
              <Group gap="sm">
                {RATINGS.map((r) => (
                  <Button key={r.key} color={r.color} radius="xl" loading={busy}
                    onClick={() => void grade(r.key)}>
                    {r.label}
                  </Button>
                ))}
              </Group>
            )}
            {card.sourceUrl && (
              <Text component="a" href={card.sourceUrl} target="_blank" rel="noreferrer"
                size="xs" c="dimmed">{card.sourceUrl}</Text>
            )}
          </Stack>
        )}
      </AppShell.Main>
    </AppShell>
  )
}
```

- [ ] **Step 2: Sidebar "Review" entry + badge.** In `src/routes/index.tsx`:

Add imports:
```tsx
import { Link } from "@tanstack/react-router"
import { Badge } from "@mantine/core"
import { reviewStats } from "~/server/review.fn"
```
Extend the loader to include stats:
```tsx
  loader: async () => {
    const [items, enrolled, stats] = await Promise.all([listLibrary(), listEnrolled(), reviewStats()])
    return { items, enrolled, stats }
  },
```
Read `const { items, enrolled, stats } = Route.useLoaderData()`. In the navbar, under the theme controls, add:
```tsx
        <Button
          component={Link}
          to="/review"
          variant="light"
          fullWidth
          mt="md"
          rightSection={
            stats.due + stats.new > 0
              ? <Badge size="sm" circle color="brand">{stats.due + stats.new}</Badge>
              : null
          }
        >
          Review
        </Button>
```

- [ ] **Step 3: Build + dev verify the full loop** — `pnpm build` (succeeds). `pnpm dev`: enroll a couple of highlights → sidebar "Review" badge shows the count → open `/review` → quote → Reveal → Good → advances → after the last, "All caught up". Reload `/review` later: graded cards no longer due. Stop dev.

- [ ] **Step 4: Commit**

```bash
cd ~/Development/copythe-hub && git add src/routes/review.tsx src/routes/index.tsx src/routeTree.gen.ts
git commit -m "feat(srs): /review screen + sidebar Review entry with due badge"
```

---

### Task 8: Deploy + verify live

- [ ] **Step 1: Deploy** — `cd ~/Development/copythe-hub && pnpm run deploy` → build + deploy succeed (wasm bundled, D1 bound).
- [ ] **Step 2: Verify** — `curl -s -o /dev/null -w "%{http_code}\n" https://hub.copythe.link/review` → `302` (Access). Authenticated: enroll highlights, run a review session, confirm cards reschedule.
- [ ] **Step 3: Push** — `cd ~/Development/copythe-hub && git push`.

---

## Self-Review

**Spec coverage:** FSRS via fsrs-rs wasm in the hub ✓ (Task 1); hub D1 review store ✓ (Task 2); pure buildQueue/grade ✓ (Task 3); D1 helpers ✓ (Task 4); reviewQueue/gradeCard/reviewStats/enroll/unenroll/enrolledIds ✓ (Task 5); opt-in toggle on dashboard card + detail view ✓ (Task 6); `/review` reveal-then-rate + sidebar badge ✓ (Task 7); default FSRS-6 params + 0.9 retention ✓ (Task 1 `fsrs.ts`); wasm-fail fallback so reviews never block ✓ (Task 1). Optimizer explicitly deferred (spec §2) — no task, correct. Keyboard shortcuts (spec §7) are polish; folded into Task 7's UI as optional — add `useHotkeys` if desired, not gating.

**Placeholder scan:** The only literal placeholder is `PASTE_DATABASE_ID_HERE` (Task 2 Step 3) — unavoidable, it's the user-specific id printed by `wrangler d1 create` in Step 1, explicitly sourced. The `rs-fsrs` fallback (Task 1 Step 4) is a real contingency with a concrete trigger, not a vague TODO.

**Type consistency:** `nextStates(prev: Memory|null, elapsedDays) → Record<Rating,Branch>` (Task 1) is consumed by `gradeCard` (Task 5) and `applyGrade(prev,rating,branch,now)` (Task 3). `ReviewRow` shape is identical across `review.ts` (Task 3), `review-db.ts` (Task 4), and the D1 columns (Task 2). `QueueCard` from `buildQueue` (Task 3) is what `reviewQueue` returns (Task 5) and `/review` renders (Task 7). `Rating` union ("again|hard|good|easy") is consistent across `fsrs.ts`, `gradeCard`, and the `/review` buttons. `ReviewToggle({highlightId, enrolled, onChange, size})` (Task 6 Step 1) matches every call site (Steps 3, 5). `listEnrolled`/`reviewStats`/`enrollCard`/`unenrollCard`/`gradeCard`/`reviewQueue` names are identical between definition (Task 5) and use (Tasks 6, 7).

**Risk:** Rust→wasm-on-Cloudflare is the linchpin and is a deployed spike in Task 1 before anything else, with a concrete `rs-fsrs` fallback. The `init(wasmUrl)` import shape may need adjustment to the generated `.d.ts` — Task 1 Step 5 flags this and the `nextStates` interface is insulated from it.
