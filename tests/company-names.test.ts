import { describe, expect, it } from "vitest"

import {
  companyNameForDomain,
  companyNameForUrl,
  normalizeHostname,
  registrableDomain
} from "../src/lib/company-names"

describe("company-name labels", () => {
  it("normalizes URL-ish values to hostnames", () => {
    expect(normalizeHostname("https://www.Example.com/path")).toBe("example.com")
    expect(normalizeHostname(".tracker.example.com")).toBe("tracker.example.com")
  })

  it("uses the registrable domain for fallback company names", () => {
    expect(registrableDomain("dev.aloewright.com")).toBe("aloewright.com")
    expect(companyNameForDomain("dev.aloewright.com")).toBe("Aloewright")
    expect(companyNameForDomain("book-cook.com")).toBe("Book Cook")
  })

  it("uses known company overrides for tracker domains", () => {
    expect(companyNameForDomain("www.google-analytics.com")).toBe("Google Analytics")
    expect(companyNameForDomain("connect.facebook.net")).toBe("Meta")
    expect(companyNameForUrl("https://clarity.ms/tag/script.js")).toBe("Microsoft Clarity")
  })
})
