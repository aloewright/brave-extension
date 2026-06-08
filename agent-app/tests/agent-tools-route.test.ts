import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { buildApp } from "../src/app"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret"
}

describe("agent tools route", () => {
  it("GET /api/agent/tools/status reports the worker-native source as connected", async () => {
    const res = await buildApp().request(
      "/api/agent/tools/status",
      { headers: SVC },
      makeEnv()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      sources: Array<{ id: string; status: { state: string } }>
    }
    const wn = body.sources.find((s) => s.id === "worker-native")
    expect(wn).toBeDefined()
    expect(wn!.status.state).toBe("connected")
  })

  it("401s without credentials", async () => {
    const res = await buildApp().request("/api/agent/tools/status", {}, makeEnv())
    expect(res.status).toBe(401)
  })
})
