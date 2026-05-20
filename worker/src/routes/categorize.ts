import { Hono } from "hono"
import { AI_GATEWAY_ID, type Env } from "../env"

/**
 * POST /api/bookmarks/categorize (ALO-469).
 *
 * Accepts a small batch of bookmarks and returns AI-proposed categories.
 * The model id is pinned to a current Workers-AI text model (gpt-oss-120b),
 * routed through gateway "x" per CLAUDE.md — dynamic/* routes are still
 * broken inside a Worker, so direct env.AI.run with `{ gateway: { id } }`
 * is the working pattern for now.
 *
 * Inputs are minimal by design: only the fields needed to categorize.
 * Anything beyond title / url / folder / tags is rejected upstream and
 * the route never receives it.
 */

const MAX_BATCH = 50
const MAX_PROPOSED_CATEGORIES_PER_ITEM = 1
const MODEL_ID = "@cf/openai/gpt-oss-120b"

interface IncomingItem {
  id: string
  title: string
  url: string
  folder?: string
  tags?: string[]
}

interface ProposedCategory {
  id: string
  category: string
  confidence: "low" | "medium" | "high"
}

interface CategorizeBody {
  items?: IncomingItem[]
}

const categorize = new Hono<{ Bindings: Env }>()

categorize.post("/", async (c) => {
  const body = await c.req.json<CategorizeBody>().catch(() => null)
  if (!body || !Array.isArray(body.items)) {
    return c.json({ error: { code: "bad_request", message: "items[] required" } }, 400)
  }
  const items = body.items
  if (items.length === 0) {
    return c.json({ proposals: [], model: MODEL_ID, gateway: AI_GATEWAY_ID })
  }
  if (items.length > MAX_BATCH) {
    return c.json(
      {
        error: {
          code: "too_many_items",
          message: `at most ${MAX_BATCH} bookmarks per call (got ${items.length})`,
          maxItems: MAX_BATCH
        }
      },
      413
    )
  }
  for (const it of items) {
    if (typeof it.id !== "string" || typeof it.title !== "string" || typeof it.url !== "string") {
      return c.json(
        { error: { code: "bad_request", message: "each item needs {id, title, url}" } },
        400
      )
    }
  }

  const minimal = items.map((it) => ({
    id: it.id,
    title: trimText(it.title, 200),
    domain: safeDomain(it.url),
    folder: it.folder ? trimText(it.folder, 80) : undefined,
    tags: Array.isArray(it.tags) ? it.tags.slice(0, 6).map((t) => trimText(t, 40)) : undefined
  }))

  const prompt = buildPrompt(minimal)

  let raw: string
  try {
    const res = (await c.env.AI.run(
      MODEL_ID,
      {
        messages: [
          {
            role: "system",
            content:
              "You categorize bookmarks. Respond with strict JSON: " +
              `{"proposals":[{"id":"...","category":"...","confidence":"low|medium|high"}]}.` +
              ` Category strings should be short (1-3 words), title-cased, and consistent across the batch.`
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 800
      },
      { gateway: { id: AI_GATEWAY_ID } }
    )) as { response?: string; result?: string; choices?: Array<{ message?: { content?: string } }> }
    raw = extractText(res)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json(
      { error: { code: "gateway_error", message: `AI gateway call failed: ${msg}` } },
      502
    )
  }

  const proposals = parseProposals(raw, items)
  return c.json({ proposals, model: MODEL_ID, gateway: AI_GATEWAY_ID })
})

export default categorize

// ── helpers ────────────────────────────────────────────────────────────

function trimText(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + "…"
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

interface MinimalItem {
  id: string
  title: string
  domain: string
  folder?: string
  tags?: string[]
}

function buildPrompt(items: MinimalItem[]): string {
  return [
    "Categorize each bookmark into a short topical category like 'Tech News',",
    "'Recipes', 'Frontend', 'AI Research', 'Personal Finance'.",
    "Return strict JSON only, no commentary.",
    "Bookmarks:",
    JSON.stringify(items, null, 0)
  ].join("\n")
}

function extractText(
  res:
    | { response?: string; result?: string; choices?: Array<{ message?: { content?: string } }> }
    | undefined
): string {
  if (!res) return ""
  if (typeof res.response === "string") return res.response
  if (typeof res.result === "string") return res.result
  const choice = res.choices?.[0]?.message?.content
  if (typeof choice === "string") return choice
  return ""
}

/**
 * Pull the JSON object out of `raw`, even when the model adds prose.
 * Returns one proposal per input id, falling back to "Uncategorized"
 * when the model didn't propose anything for that id (so callers don't
 * have to fan-in nulls).
 */
export function parseProposals(raw: string, inputs: IncomingItem[]): ProposedCategory[] {
  const match = raw.match(/\{[\s\S]*\}/)
  const json = match ? match[0] : raw
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    parsed = null
  }
  const byId = new Map<string, ProposedCategory>()
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { proposals?: unknown[] }).proposals)) {
    for (const p of (parsed as { proposals: unknown[] }).proposals) {
      if (!p || typeof p !== "object") continue
      const obj = p as { id?: unknown; category?: unknown; confidence?: unknown }
      if (typeof obj.id !== "string" || typeof obj.category !== "string") continue
      const cat = trimText(obj.category, 60)
      if (!cat) continue
      const conf =
        obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
          ? obj.confidence
          : "medium"
      byId.set(obj.id, { id: obj.id, category: cat, confidence: conf })
    }
  }
  const out: ProposedCategory[] = []
  for (const it of inputs) {
    const existing = byId.get(it.id)
    if (existing) {
      out.push(existing)
    } else {
      out.push({ id: it.id, category: "Uncategorized", confidence: "low" })
    }
    if (out.length >= inputs.length * MAX_PROPOSED_CATEGORIES_PER_ITEM) break
  }
  return out
}
