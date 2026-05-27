import { describe, expect, it, vi } from "vitest"
import {
  normalizeUrl,
  compareByVisit,
  loadLastVisitMap,
} from "../src/lib/bookmark-history"

describe("normalizeUrl", () => {
  it("strips protocol, www, trailing slash, query, and hash", () => {
    expect(normalizeUrl("https://www.example.com/a/?utm=1#x")).toBe("example.com/a")
    expect(normalizeUrl("http://example.com/")).toBe("example.com")
    expect(normalizeUrl("https://example.com")).toBe("example.com")
    expect(normalizeUrl("https://EXAMPLE.com/Path")).toBe("example.com/Path")
  })

  it("keeps the path beyond the host", () => {
    expect(normalizeUrl("https://github.com/aloewright/brave-extension")).toBe(
      "github.com/aloewright/brave-extension",
    )
  })

  it("returns the input when the URL is malformed", () => {
    expect(normalizeUrl("not a url")).toBe("not a url")
    expect(normalizeUrl("")).toBe("")
  })
})

describe("compareByVisit", () => {
  const map = new Map<string, number>([
    ["a.example", 3_000],
    ["b.example", 1_000],
    ["c.example", 2_000],
  ])

  it("newest-first puts most recently visited at the top", () => {
    const items = [
      { url: "https://b.example" },
      { url: "https://a.example" },
      { url: "https://c.example" },
    ]
    items.sort((a, b) => compareByVisit(a, b, map, "newest-first"))
    expect(items.map((i) => i.url)).toEqual([
      "https://a.example",
      "https://c.example",
      "https://b.example",
    ])
  })

  it("oldest-first puts least recently visited at the top, never-visited still bottom", () => {
    const items = [
      { url: "https://a.example" },
      { url: "https://never.example" },
      { url: "https://b.example" },
    ]
    items.sort((a, b) => compareByVisit(a, b, map, "oldest-first"))
    expect(items.map((i) => i.url)).toEqual([
      "https://b.example",
      "https://a.example",
      "https://never.example",
    ])
  })

  it("never-visited sinks to the bottom even for newest-first", () => {
    const items = [
      { url: "https://never.example" },
      { url: "https://a.example" },
    ]
    items.sort((a, b) => compareByVisit(a, b, map, "newest-first"))
    expect(items[1].url).toBe("https://never.example")
  })
})

describe("loadLastVisitMap", () => {
  it("builds a Map<normalizedUrl, lastVisitTime> from one history.search call", async () => {
    const searchFn = vi.fn().mockResolvedValue([
      { url: "https://www.example.com/", lastVisitTime: 5_000 },
      { url: "https://example.com/a?x=1#y", lastVisitTime: 7_000 },
      { url: "https://example.com/a", lastVisitTime: 6_000 }, // overlap; keep max
    ])
    const map = await loadLastVisitMap(searchFn as unknown as typeof chrome.history.search)
    expect(searchFn).toHaveBeenCalledTimes(1)
    expect(searchFn).toHaveBeenCalledWith({
      text: "",
      startTime: 0,
      maxResults: 100_000,
    })
    expect(map.get("example.com")).toBe(5_000)
    // 7_000 > 6_000 so the later entry wins for the same normalized key
    expect(map.get("example.com/a")).toBe(7_000)
  })

  it("returns an empty map when the search function throws", async () => {
    const searchFn = vi.fn().mockRejectedValue(new Error("permission denied"))
    const map = await loadLastVisitMap(searchFn as unknown as typeof chrome.history.search)
    expect(map.size).toBe(0)
  })

  it("returns an empty map when no chrome.history is provided", async () => {
    const map = await loadLastVisitMap(undefined)
    expect(map.size).toBe(0)
  })
})
