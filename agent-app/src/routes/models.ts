import { Hono } from "hono"
import type { Env } from "../env"
import { getCatalog, resolveModel, DEFAULT_MODEL_ID } from "../models"

type Vars = { userId: string }
const models = new Hono<{ Bindings: Env; Variables: Vars }>()

models.get("/models", async (c) => {
  return c.json({ models: await getCatalog(c.env) })
})

const prefKey = (userId: string) => `pref:model:${userId}`

models.get("/prefs/model", async (c) => {
  const id = await c.env.AGENT_KV.get(prefKey(c.get("userId")))
  return c.json({ modelId: id ?? DEFAULT_MODEL_ID })
})

models.put("/prefs/model", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { modelId?: string }
  const resolved = await resolveModel(c.env, body.modelId)
  await c.env.AGENT_KV.put(prefKey(c.get("userId")), resolved.id)
  return c.json({ modelId: resolved.id })
})

export default models
