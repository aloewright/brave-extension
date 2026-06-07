// tests/github/api.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { v3, v4, GitHubApiError } from "../../src/lib/github/api"
import * as token from "../../src/lib/github/token"

beforeEach(() => {
  vi.spyOn(token, "getToken").mockResolvedValue("ghp_test")
})

describe("github api", () => {
  it("v3 calls api.github.com with auth header and parses json", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }))
    ;(globalThis as any).fetch = fetchMock
    const out = await v3("/repos/o/r")
    expect(out).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.github.com/repos/o/r")
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer ghp_test"
    })
  })

  it("v3 throws GitHubApiError on non-2xx", async () => {
    ;(globalThis as any).fetch = vi.fn(async () => new Response("nope", { status: 404 }))
    await expect(v3("/x")).rejects.toBeInstanceOf(GitHubApiError)
  })

  it("v4 posts a graphql query", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { viewer: { login: "me" } } }), { status: 200 }))
    ;(globalThis as any).fetch = fetchMock
    const out = await v4("query{viewer{login}}")
    expect(out).toEqual({ viewer: { login: "me" } })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://api.github.com/graphql")
    expect((init as RequestInit).method).toBe("POST")
  })
})
