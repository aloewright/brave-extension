import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { buildThirdPartyCookieRules } from "../src/background/third-party-cookies"
import type { ThirdPartyCookieGrant } from "../src/lib/third-party-cookie-types"

describe("third-party cookie rules", () => {
  it("declares the DNR permission required to enforce third-party cookie blocking", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))

    expect(packageJson.manifest.permissions).toContain("declarativeNetRequest")
    expect(packageJson.manifest.permissions).toContain("privacy")
    expect(packageJson.manifest.permissions).toContain("contentSettings")
  })

  // PR change: "desktopCapture" and "history" were removed from manifest permissions.
  it("does not declare the desktopCapture permission (removed in this PR)", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
    expect(packageJson.manifest.permissions).not.toContain("desktopCapture")
  })

  it("does not declare the history permission (removed in this PR)", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
    expect(packageJson.manifest.permissions).not.toContain("history")
  })

  it("strips third-party Cookie and Set-Cookie headers by default", () => {
    const [blockRule] = buildThirdPartyCookieRules([])


    expect(blockRule.condition.domainType).toBe("thirdParty")
    expect(blockRule.action.requestHeaders).toContainEqual({
      header: "cookie",
      operation: "remove"
    })
    expect(blockRule.action.responseHeaders).toContainEqual({
      header: "set-cookie",
      operation: "remove"
    })
  })

  it("adds explicit allow rules for popup-approved company pairs", () => {
    const grant: ThirdPartyCookieGrant = {
      id: "news.example::analytics.example",
      siteDomain: "news.example",
      embeddedDomain: "analytics.example",
      siteName: "News",
      embeddedName: "Analytics",
      createdAt: 1
    }

    const [, allowRule] = buildThirdPartyCookieRules([grant])

    expect(allowRule.action.type).toBe("allow")
    expect(allowRule.priority).toBeGreaterThan(1)
    expect(allowRule.condition.initiatorDomains).toEqual(["news.example"])
    expect(allowRule.condition.requestDomains).toEqual(["analytics.example"])
  })
})
