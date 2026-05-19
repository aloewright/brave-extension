import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { WORKSPACE_APPS } from "../src/newtab-apps"

describe("new tab workspace apps", () => {
  it("keeps the requested apps in order with https links", () => {
    expect(
      WORKSPACE_APPS.map(({ name, domain, url }) => ({ name, domain, url }))
    ).toEqual([
      { name: "Blog", domain: "aloewright.com", url: "https://aloewright.com" },
      {
        name: "Blog Editor",
        domain: "dev.aloewright.com",
        url: "https://dev.aloewright.com"
      },
      {
        name: "Book Editor",
        domain: "book-cook.com",
        url: "https://book-cook.com"
      },
      { name: "Link Shortener", domain: "fly.pm", url: "https://fly.pm" },
      { name: "Chat", domain: "alex.chat", url: "https://alex.chat" },
      {
        name: "Daily Planner",
        domain: "alex.coffee",
        url: "https://alex.coffee"
      },
      {
        name: "Design System Generator",
        domain: "so.makethe.app",
        url: "https://so.makethe.app"
      },
      { name: "Directory", domain: "makethe.app", url: "https://makethe.app" },
      {
        name: "Video Manager",
        domain: "spooool.com",
        url: "https://spooool.com"
      }
    ])
  })

  it("registers the workspace as Chrome's new tab page", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8")
    )

    expect(packageJson.manifest.chrome_url_overrides).toEqual({
      newtab: "newtab.html"
    })
  })

  it("does not use the old product title", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8")

    expect(source).not.toContain("Aloewright Apps")
  })

  it("renders company names instead of URL labels", () => {
    const source = readFileSync(join(process.cwd(), "src/newtab.tsx"), "utf8")

    expect(source).toContain("companyNameForDomain(app.domain)")
    expect(source).not.toContain("{app.domain}</span>")
  })
})
