import { describe, it, expect } from "vitest"
import {
  isPlausibleFilename,
  metadataFilename,
  sanitizeFilename,
  type MediaRenameInput,
} from "../src/lib/ai-rename"

const base = (over: Partial<MediaRenameInput>): MediaRenameInput => ({
  // settings unused by the pure helpers under test
  settings: {} as MediaRenameInput["settings"],
  fallbackFilename: "screenshot-2026-05-26.png",
  mediaKind: "image",
  ...over,
})

describe("isPlausibleFilename", () => {
  it("rejects planning-agent narrative", () => {
    expect(
      isPlausibleFilename(
        "Objective: Rename this image capture using bounded metadata only. Status: observed 0 visible page nodes. Plan: identify the",
      ),
    ).toBe(false)
  })
  it("rejects multi-line and over-long replies", () => {
    expect(isPlausibleFilename("line one\nline two")).toBe(false)
    expect(isPlausibleFilename("a".repeat(101))).toBe(false)
    expect(isPlausibleFilename("")).toBe(false)
  })
  it("accepts a short filename", () => {
    expect(isPlausibleFilename("pub-admin-marketplace.png")).toBe(true)
    expect(isPlausibleFilename("Quarterly Revenue Chart.png")).toBe(true)
  })
})

describe("metadataFilename", () => {
  it("derives a slug from the page title + keeps the extension", () => {
    expect(
      metadataFilename(base({ sourceTitle: "Pub Admin — Marketplace", fallbackFilename: "x.png" })),
    ).toBe("Pub-Admin-Marketplace.png")
  })
  it("falls back to the source host when there is no title", () => {
    expect(
      metadataFilename(base({ sourceUrl: "https://www.example.com/path", fallbackFilename: "x.png" })),
    ).toBe("example.com.png")
  })
  it("uses the fallback filename when there is no title or url", () => {
    expect(metadataFilename(base({ fallbackFilename: "shot.png" }))).toBe("shot.png")
  })
  it("infers a default extension for images when the fallback has none", () => {
    expect(metadataFilename(base({ sourceTitle: "Cool Page", fallbackFilename: "shot" }))).toBe(
      "Cool-Page.png",
    )
  })
})

describe("sanitizeFilename", () => {
  it("strips quotes/spaces and appends the fallback extension", () => {
    expect(sanitizeFilename('"my capture"', "fallback.png")).toBe("my-capture.png")
  })
  it("returns the fallback for empty input", () => {
    expect(sanitizeFilename("   ", "fallback.png")).toBe("fallback.png")
  })
})
