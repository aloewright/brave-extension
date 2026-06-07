import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { buildApp } from "../src/app"

const SVC = {
  "cf-access-client-id": "svc-client-id",
  "cf-access-client-secret": "svc-client-secret",
  "content-type": "application/json"
}

describe("models routes", () => {
  it("GET /api/models returns the catalog", async () => {
    const res = await buildApp().fetch(
      new Request("http://x/api/models", { headers: SVC }),
      makeEnv()
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { models: Array<{ id: string }> }
    expect(body.models.length).toBeGreaterThan(0)
  })

  it("PUT then GET /api/prefs/model round-trips the selection", async () => {
    const env = makeEnv()
    const put = await buildApp().fetch(
      new Request("http://x/api/prefs/model", {
        method: "PUT",
        headers: SVC,
        body: JSON.stringify({ modelId: "@cf/meta/llama-3.1-8b-instruct-fp8" })
      }),
      env
    )
    expect(put.status).toBe(200)
    const get = await buildApp().fetch(
      new Request("http://x/api/prefs/model", { headers: SVC }),
      env
    )
    const body = (await get.json()) as { modelId: string }
    expect(body.modelId).toBe("@cf/meta/llama-3.1-8b-instruct-fp8")
  })

  it("401s without credentials", async () => {
    const res = await buildApp().fetch(new Request("http://x/api/models"), makeEnv())
    expect(res.status).toBe(401)
  })
})
