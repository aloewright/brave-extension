import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"

let readme: string

beforeAll(() => {
  readme = readFileSync(resolve(__dirname, "../README.md"), "utf-8")
})

describe("README.md badges", () => {
  describe("README branding", () => {
    it("uses the Brave Dev Extension title and intro", () => {
      expect(readme).toContain("# Brave Dev Extension")
      expect(readme).toContain(
        "Brave Dev Extension turns Brave's side panel and new tab page into a compact"
      )
    })
  })

  describe("Tests badge (updated in PR)", () => {
    it("badge image points to aloewright/brave-extension", () => {
      expect(readme).toContain(
        "https://github.com/aloewright/brave-extension/actions/workflows/test.yml/badge.svg"
      )
    })

    it("badge link points to aloewright/brave-extension", () => {
      expect(readme).toContain(
        "(https://github.com/aloewright/brave-extension/actions/workflows/test.yml)"
      )
    })

    it("badge has correct alt text", () => {
      expect(readme).toContain("[![Tests]")
    })

    it("does not reference the old ai-dev-sidebar repo in badge URLs", () => {
      const badgeSection = readme.split("\n").slice(0, 15).join("\n")
      expect(badgeSection).not.toContain("aloewright/ai-dev-sidebar")
    })
  })

  describe("TypeScript badge (added in PR)", () => {
    it("TypeScript badge image is present with correct shields.io URL", () => {
      expect(readme).toContain(
        "https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white"
      )
    })

    it("TypeScript badge links to typescriptlang.org", () => {
      expect(readme).toContain("(https://www.typescriptlang.org/)")
    })

    it("TypeScript badge has correct alt text", () => {
      expect(readme).toContain("[![TypeScript]")
    })
  })

  describe("Cloudflare Workers badge (added in PR)", () => {
    it("Cloudflare Workers badge image is present with correct shields.io URL", () => {
      expect(readme).toContain(
        "https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white"
      )
    })

    it("Cloudflare Workers badge links to workers.cloudflare.com", () => {
      expect(readme).toContain("(https://workers.cloudflare.com/)")
    })

    it("Cloudflare Workers badge has correct alt text", () => {
      expect(readme).toContain("[![Cloudflare Workers]")
    })
  })

  describe("Brave badge (added in PR)", () => {
    it("Brave badge image is present with correct shields.io URL", () => {
      expect(readme).toContain(
        "https://img.shields.io/badge/Brave-FB542B?logo=brave&logoColor=white"
      )
    })

    it("Brave badge links to brave.com", () => {
      expect(readme).toContain("(https://brave.com/)")
    })

    it("Brave badge has correct alt text", () => {
      expect(readme).toContain("[![Brave]")
    })
  })

  describe("Buy Me a Coffee badge (added in PR)", () => {
    it("Buy Me a Coffee badge image is present with correct shields.io URL", () => {
      expect(readme).toContain(
        "https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black"
      )
    })

    it("Buy Me a Coffee badge links to buymeacoffee.com/allosaurus", () => {
      expect(readme).toContain("(https://buymeacoffee.com/allosaurus)")
    })

    it("Buy Me a Coffee badge has correct alt text", () => {
      expect(readme).toContain("[![Buy Me a Coffee]")
    })
  })

  describe("badge block structure", () => {
    it("all five expected badges are present in the badge block", () => {
      const badgeLabels = ["Tests", "TypeScript", "Cloudflare Workers", "Brave", "Buy Me a Coffee"]
      for (const label of badgeLabels) {
        expect(readme).toContain(`[![${label}]`)
      }
    })

    it("each badge follows the markdown image-link syntax [![alt](img)](href)", () => {
      const badgeLinePattern = /\[!\[.+?\]\(.+?\)\]\(.+?\)/
      const lines = readme.split("\n")
      const badgeLines = lines.filter((line) => line.startsWith("[!["))
      expect(badgeLines.length).toBeGreaterThanOrEqual(5)
      for (const line of badgeLines) {
        expect(line).toMatch(badgeLinePattern)
      }
    })

    it("badge block appears before the first heading body text", () => {
      const testsIdx = readme.indexOf(
        "[![Tests](https://github.com/aloewright/brave-extension"
      )
      const descriptionIdx = readme.indexOf(
        "Brave Dev Extension turns Brave's side panel and new tab page into a compact"
      )
      expect(testsIdx).toBeGreaterThan(-1)
      expect(testsIdx).toBeLessThan(descriptionIdx)
    })

    // Regression: ensure the old repo name does not leak into any badge URL
    it("no badge URL references the old ai-dev-sidebar repository", () => {
      const badgeLines = readme
        .split("\n")
        .filter((line) => line.startsWith("[!["))
      for (const line of badgeLines) {
        expect(line).not.toContain("ai-dev-sidebar")
      }
    })
  })
})
