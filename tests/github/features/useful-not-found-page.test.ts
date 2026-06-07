// tests/github/features/useful-not-found-page.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import feature from "../../../src/lib/github/features/useful-not-found-page"

function setup404(pathname: string) {
  document.title = "Page not found · GitHub"
  // Provide a minimal main element for anchor insertion
  document.body.innerHTML = `<main><div id="first-child">Error</div></main>`
  // Patch location
  Object.defineProperty(window, "location", {
    value: { pathname, href: `https://github.com${pathname}` },
    writable: true,
    configurable: true,
  })
}

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
  document.title = ""
  // Reset location mock
  Object.defineProperty(window, "location", {
    value: { pathname: "/", href: "https://github.com/" },
    writable: true,
    configurable: true,
  })
})

describe("useful-not-found-page", () => {
  it("metadata", () => {
    expect(feature.id).toBe("useful-not-found-page")
    expect(feature.category).toBe("global")
    expect(feature.defaultEnabled).toBe(true)
    // pageTest always true; the init guards via 404 detection
    expect(feature.pageTest(new URL("https://github.com/o/r/blob/main/a.ts"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/"))).toBe(true)
  })

  it("no-ops when not a 404 page", () => {
    document.title = "octocat/Hello-World · GitHub"
    document.body.innerHTML = "<main><div>content</div></main>"
    Object.defineProperty(window, "location", {
      value: { pathname: "/octocat/Hello-World", href: "https://github.com/octocat/Hello-World" },
      writable: true,
      configurable: true,
    })
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector("[data-rgh-nfp]")).toBeNull()
    ctrl.abort()
  })

  it("injects breadcrumb links on a 404 page", () => {
    setup404("/octocat/nonexistent-repo/blob/main/src/missing-file.ts")
    const ctrl = new AbortController()
    feature.init(ctrl.signal)

    const injected = document.querySelector("[data-rgh-nfp]")
    expect(injected).not.toBeNull()

    // Should have anchor links for ancestor segments
    const links = injected!.querySelectorAll("a")
    expect(links.length).toBeGreaterThan(0)
    // First link should be to /octocat
    expect(links[0].getAttribute("href")).toBe("/octocat")

    // Last segment should be struck through (the 404 part)
    const del = injected!.querySelector("del")
    expect(del).not.toBeNull()
    expect(del!.textContent).toBe("missing-file.ts")

    ctrl.abort()
  })

  it("is idempotent — re-init does not duplicate the injected node", () => {
    setup404("/o/r/blob/main/missing.ts")
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    feature.init(ctrl1.signal)
    feature.init(ctrl2.signal)
    expect(document.querySelectorAll("[data-rgh-nfp]").length).toBe(1)
    ctrl1.abort()
    ctrl2.abort()
  })

  it("removes injected node on abort", () => {
    setup404("/o/r/blob/main/gone.ts")
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector("[data-rgh-nfp]")).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector("[data-rgh-nfp]")).toBeNull()
  })

  it("no-ops when path has fewer than 2 segments", () => {
    document.title = "Page not found · GitHub"
    document.body.innerHTML = "<main><div>content</div></main>"
    Object.defineProperty(window, "location", {
      value: { pathname: "/octocat", href: "https://github.com/octocat" },
      writable: true,
      configurable: true,
    })
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector("[data-rgh-nfp]")).toBeNull()
    ctrl.abort()
  })
})
