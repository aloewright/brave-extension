import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { getCatalog, resolveModel, DEFAULT_MODEL_ID } from "../src/models"

describe("models catalog", () => {
  it("returns capability routes and concrete CF models", async () => {
    const env = makeEnv()
    const cat = await getCatalog(env)
    expect(cat.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true)
    expect(cat.some((m) => m.kind === "workers-ai")).toBe(true)
    expect(cat.every((m) => typeof m.label === "string")).toBe(true)
  })

  it("marks non-CF entries as advanced/experimental", async () => {
    const env = makeEnv()
    const cat = await getCatalog(env)
    const adv = cat.filter((m) => m.kind === "advanced")
    expect(adv.every((m) => m.experimental === true)).toBe(true)
  })

  it("resolveModel falls back to default for unknown ids", async () => {
    const env = makeEnv()
    expect((await resolveModel(env, "nonsense")).id).toBe(DEFAULT_MODEL_ID)
    const known = await resolveModel(env, DEFAULT_MODEL_ID)
    expect(known.id).toBe(DEFAULT_MODEL_ID)
  })

  it("caches the catalog in KV", async () => {
    const env = makeEnv()
    await getCatalog(env)
    const cached = await env.AGENT_KV.get("models:catalog:v1")
    expect(cached).toBeTruthy()
  })
})
