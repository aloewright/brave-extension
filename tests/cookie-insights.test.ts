import { describe, expect, it } from "vitest"

import {
  analyzeCookie,
  classifyCookie,
  cookieMatchesHost,
  sameSiteLabel
} from "../src/sections/_lx/utils/cookies"

describe("cookie insight helpers", () => {
  it("matches current-site cookies using host-only and domain-cookie scope", () => {
    expect(cookieMatchesHost({ domain: "app.example.com", hostOnly: true }, "app.example.com")).toBe(true)
    expect(cookieMatchesHost({ domain: "app.example.com", hostOnly: true }, "www.app.example.com")).toBe(false)
    expect(cookieMatchesHost({ domain: ".example.com", hostOnly: false }, "app.example.com")).toBe(true)
    expect(cookieMatchesHost({ domain: ".example.com", hostOnly: false }, "other.test")).toBe(false)
  })

  it("classifies likely marketing and analytics cookies", () => {
    expect(classifyCookie({ name: "_ga", domain: ".example.com", secure: true, httpOnly: false })).toBe("Analytics")
    expect(classifyCookie({ name: "_gcl_au", domain: ".example.com", secure: true, httpOnly: false })).toBe("Marketing")
  })

  it("labels auth cookies as lower concern when they are scoped to the site", () => {
    const insight = analyzeCookie({
      name: "session_token",
      domain: "app.example.com",
      secure: true,
      httpOnly: true,
      hostOnly: true,
      sameSite: "lax"
    })

    expect(insight.category).toBe("Auth/session")
    expect(insight.risk).toBe("low")
    expect(insight.recommendation).toContain("worth keeping")
  })

  it("marks persistent third-party-capable marketing cookies as high concern", () => {
    const insight = analyzeCookie({
      name: "_fbp",
      domain: ".example.com",
      secure: true,
      httpOnly: false,
      hostOnly: false,
      sameSite: "no_restriction",
      expirationDate: 1_800_000_000
    })

    expect(insight.category).toBe("Marketing")
    expect(insight.risk).toBe("high")
    expect(insight.sendingLabel).toBe("Third-party capable")
  })

  it("formats SameSite states for the UI", () => {
    expect(sameSiteLabel({ name: "a", domain: "example.com", secure: true, httpOnly: false, sameSite: "strict" })).toBe("SameSite=Strict")
    expect(sameSiteLabel({ name: "b", domain: "example.com", secure: true, httpOnly: false, sameSite: "no_restriction" })).toBe("SameSite=None")
    expect(sameSiteLabel({ name: "c", domain: "example.com", secure: true, httpOnly: false })).toBe("SameSite default")
  })
})
