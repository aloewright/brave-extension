// tests/github/token.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { getToken, setToken, GH_TOKEN_KEY, _resetTokenCache } from "../../src/lib/github/token"

const store: Record<string, unknown> = {}
beforeEach(() => {
  _resetTokenCache()
  for (const k of Object.keys(store)) delete store[k]
  ;(globalThis as any).chrome = {
    storage: {
      session: {
        get: vi.fn(async (k: string) => ({ [k]: store[k] })),
        set: vi.fn(async (o: Record<string, unknown>) => { Object.assign(store, o) })
      }
    }
  }
})

describe("github token", () => {
  it("returns empty string when unset", async () => {
    expect(await getToken()).toBe("")
  })
  it("round-trips through chrome.storage.session", async () => {
    await setToken("ghp_x")
    expect(store[GH_TOKEN_KEY]).toBe("ghp_x")
    expect(await getToken()).toBe("ghp_x")
  })
})
