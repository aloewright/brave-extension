import { describe, it, expect, vi } from "vitest"
import app from "../../src/index"
import { makeEnv } from "../helpers"
import { parseProposals } from "../../src/routes/categorize"

const TOKEN_HEADERS = {
  "x-sidebar-token": "test-token",
  "content-type": "application/json",
}

function jsonReq(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: TOKEN_HEADERS,
    body: JSON.stringify(body),
  })
}

describe("POST /api/bookmarks/categorize", () => {
  it("rejects missing items[]", async () => {
    const env = makeEnv()
    const res = await app.fetch(jsonReq("http://x/api/bookmarks/categorize", {}), env)
    expect(res.status).toBe(400)
  })

  it("rejects items without the required id/title/url shape", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      jsonReq("http://x/api/bookmarks/categorize", {
        items: [{ id: "a", title: "ok" }],
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it("returns an empty proposal list for an empty batch", async () => {
    const env = makeEnv()
    const res = await app.fetch(jsonReq("http://x/api/bookmarks/categorize", { items: [] }), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.proposals).toEqual([])
  })

  it("rejects batches above MAX_BATCH with too_many_items", async () => {
    const env = makeEnv()
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: `b${i}`,
      title: `t${i}`,
      url: `https://e/${i}`,
    }))
    const res = await app.fetch(jsonReq("http://x/api/bookmarks/categorize", { items }), env)
    expect(res.status).toBe(413)
    const body = (await res.json()) as any
    expect(body.error.code).toBe("too_many_items")
    expect(body.error.maxItems).toBe(50)
  })

  it("invokes env.AI.run with @cf/openai/gpt-oss-120b through gateway x", async () => {
    const env = makeEnv()
    const items = [
      { id: "bm1", title: "Hacker News", url: "https://news.ycombinator.com" },
      { id: "bm2", title: "Recipe for cake", url: "https://allrecipes.com/x" },
    ]
    const aiRun = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        proposals: [
          { id: "bm1", category: "Tech News", confidence: "high" },
          { id: "bm2", category: "Recipes", confidence: "medium" },
        ],
      }),
    })
    env.AI = { run: aiRun } as unknown as Ai
    const res = await app.fetch(jsonReq("http://x/api/bookmarks/categorize", { items }), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.proposals).toHaveLength(2)
    expect(body.proposals[0]).toMatchObject({
      id: "bm1",
      category: "Tech News",
      confidence: "high",
    })
    expect(body.gateway).toBe("x")
    expect(aiRun).toHaveBeenCalledTimes(1)
    const call = aiRun.mock.calls[0]!
    const model = call[0] as string
    const payload = call[1] as {
      messages: Array<{ role: string; content: string }>
    }
    const opts = call[2] as { gateway: { id: string } }
    expect(model).toBe("@cf/openai/gpt-oss-120b")
    expect(opts.gateway.id).toBe("x")
    expect(payload.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("You categorize bookmarks"),
    })
    expect(payload.messages[1]?.role).toBe("user")
    const prompt = payload.messages[1]?.content ?? ""
    expect(prompt.length).toBeGreaterThan(0)
    // Minimal-fields rule: outgoing prompt must not include URLs raw — only
    // domain — and must not include browser-extension internal fields.
    expect(prompt).toContain("news.ycombinator.com")
    expect(prompt).toContain("allrecipes.com")
    expect(prompt).not.toContain("https://news.ycombinator.com")
  })

  it("returns 502 on AI gateway failure", async () => {
    const env = makeEnv()
    env.AI = {
      run: vi.fn().mockRejectedValue(new Error("rate limited")),
    } as unknown as Ai
    const res = await app.fetch(
      jsonReq("http://x/api/bookmarks/categorize", {
        items: [{ id: "b", title: "t", url: "https://x" }],
      }),
      env,
    )
    expect(res.status).toBe(502)
    const body = (await res.json()) as any
    expect(body.error.code).toBe("gateway_error")
    expect(body.error.message).toContain("rate limited")
  })

  it("falls back to 'Uncategorized' when the model returns garbage", async () => {
    const env = makeEnv()
    env.AI = {
      run: vi.fn().mockResolvedValue({ response: "I'm sorry I can't help with that." }),
    } as unknown as Ai
    const items = [{ id: "b1", title: "t", url: "https://x" }]
    const res = await app.fetch(jsonReq("http://x/api/bookmarks/categorize", { items }), env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.proposals[0]).toEqual({
      id: "b1",
      category: "Uncategorized",
      confidence: "low",
    })
  })

  it("requires the X-Sidebar-Token header", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      new Request("http://x/api/bookmarks/categorize", {
        method: "POST",
        body: JSON.stringify({ items: [] }),
        headers: { "content-type": "application/json" },
      }),
      env,
    )
    expect(res.status).toBe(401)
  })
})

describe("parseProposals", () => {
  it("extracts JSON even when wrapped in prose", () => {
    const raw =
      "Sure! Here is the categorization:\n" + `{"proposals":[{"id":"a","category":"Tech","confidence":"high"}]}` + "\nHope this helps."
    const out = parseProposals(raw, [{ id: "a", title: "t", url: "u" }])
    expect(out).toEqual([{ id: "a", category: "Tech", confidence: "high" }])
  })

  it("normalizes invalid confidence to 'medium'", () => {
    const raw = `{"proposals":[{"id":"a","category":"Tech","confidence":"super-sure"}]}`
    const out = parseProposals(raw, [{ id: "a", title: "t", url: "u" }])
    expect(out[0]!.confidence).toBe("medium")
  })

  it("fills in missing ids with 'Uncategorized'", () => {
    const raw = `{"proposals":[{"id":"a","category":"Tech","confidence":"high"}]}`
    const out = parseProposals(raw, [
      { id: "a", title: "t", url: "u" },
      { id: "b", title: "u", url: "v" },
    ])
    expect(out).toHaveLength(2)
    expect(out[1]!.category).toBe("Uncategorized")
  })
})
