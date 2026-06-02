import { Hono } from "hono"
import type { Env } from "../env"
import { search, type ResourceType } from "../vectors"

const router = new Hono<{ Bindings: Env }>()

interface PostBody {
  query?: string
  types?: ResourceType[]
  limit?: number
}

const KNOWN_TYPES: ResourceType[] = ["conversation", "link", "bookmark", "recording", "pdf", "capture", "highlight"]

router.post("/", async (c) => {
  const body = await c.req.json<PostBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const query = (body.query ?? "").trim()
  if (!query) return c.json({ results: [] })

  const types = body.types?.filter((t): t is ResourceType => KNOWN_TYPES.includes(t))
  const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 20

  const hits = await search(c.env, query, { types, limit })
  return c.json({
    results: hits.map((h) => ({
      type: h.metadata.type,
      id: h.metadata.id,
      chunkIndex: h.metadata.chunkIndex,
      score: h.score,
      title: h.metadata.title,
      snippet: h.metadata.snippet,
      createdAt: h.metadata.createdAt
    }))
  })
})

export default router
