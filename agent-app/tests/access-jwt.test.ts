import { describe, expect, it } from "vitest"
import { verifyAccessJwt } from "../src/access-jwt"

describe("verifyAccessJwt", () => {
  it("returns null for an empty token", async () => {
    const r = await verifyAccessJwt("", "aud", "team.cloudflareaccess.com")
    expect(r).toBeNull()
  })

  it("returns null for a malformed token (not 3 segments)", async () => {
    const r = await verifyAccessJwt("abc.def", "aud", "team.cloudflareaccess.com")
    expect(r).toBeNull()
  })
})
