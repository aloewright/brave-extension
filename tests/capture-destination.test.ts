import { describe, it, expect } from "vitest"
import {
  describeCaptureDestination,
  resolveCaptureDestination,
  sanitizeSubfolder,
  type CaptureSettingsLike
} from "../src/lib/capture-destination"

function baseSettings(overrides: Partial<CaptureSettingsLike> = {}): CaptureSettingsLike {
  return {
    captureSaveLocation: "downloads",
    captureSubfolder: "ai-dev-sidebar",
    cloudCapturesEnabled: false,
    sidebarApiUrl: "",
    sidebarApiToken: "",
    ...overrides
  }
}

describe("sanitizeSubfolder", () => {
  it("preserves a clean name", () => {
    expect(sanitizeSubfolder("captures")).toBe("captures")
    expect(sanitizeSubfolder("snaps/2026")).toBe("snaps/2026")
  })

  it("strips leading slashes", () => {
    expect(sanitizeSubfolder("/abs/path")).toBe("abs/path")
    expect(sanitizeSubfolder("//abs//path")).toBe("abs/path")
  })

  it("normalizes Windows separators", () => {
    expect(sanitizeSubfolder("a\\b\\c")).toBe("a/b/c")
  })

  it("collapses runs of slashes and trims trailing", () => {
    expect(sanitizeSubfolder("a///b/")).toBe("a/b")
  })

  it("removes `..` segments (drops them rather than resolving)", () => {
    expect(sanitizeSubfolder("../escape")).toBe("escape")
    // Dropping ".." rather than popping the preceding segment is intentional:
    // the goal is "no directory traversal leaving Downloads/", not POSIX path
    // resolution. The result still has no ".." segments and no leading slash.
    expect(sanitizeSubfolder("a/../b/../c")).toBe("a/b/c")
    expect(sanitizeSubfolder("../../etc/passwd")).toBe("etc/passwd")
    expect(sanitizeSubfolder("a/..")).toBe("a")
  })

  it("replaces filename-illegal characters", () => {
    expect(sanitizeSubfolder('foo<>:"|?*bar')).toBe("foo_______bar")
  })

  it("returns empty string for purely illegal input", () => {
    expect(sanitizeSubfolder("")).toBe("")
    expect(sanitizeSubfolder("///")).toBe("")
    expect(sanitizeSubfolder("../..")).toBe("")
  })
})

describe("resolveCaptureDestination", () => {
  const fname = "screenshot-2026-05-20.png"

  it("downloads mode passes filename through", () => {
    const r = resolveCaptureDestination(fname, baseSettings())
    expect(r.destination.kind).toBe("downloads")
    expect(r.destination.filename).toBe(fname)
    expect(r.fallbackReason).toBeNull()
    if (r.destination.kind === "downloads") {
      expect(r.destination.hasSubfolder).toBe(false)
    }
  })

  it("downloads-subfolder prepends the sanitized subfolder", () => {
    const r = resolveCaptureDestination(
      fname,
      baseSettings({ captureSaveLocation: "downloads-subfolder", captureSubfolder: "snaps/2026" })
    )
    expect(r.destination.kind).toBe("downloads")
    expect(r.destination.filename).toBe(`snaps/2026/${fname}`)
    if (r.destination.kind === "downloads") {
      expect(r.destination.hasSubfolder).toBe(true)
      expect(r.destination.subfolder).toBe("snaps/2026")
    }
  })

  it("downloads-subfolder falls back to bare filename when subfolder sanitizes to empty", () => {
    const r = resolveCaptureDestination(
      fname,
      baseSettings({ captureSaveLocation: "downloads-subfolder", captureSubfolder: "../.." })
    )
    expect(r.destination.kind).toBe("downloads")
    expect(r.destination.filename).toBe(fname)
    if (r.destination.kind === "downloads") {
      expect(r.destination.hasSubfolder).toBe(false)
    }
  })

  it("cloud mode requires cloudCapturesEnabled — falls back when disabled", () => {
    const r = resolveCaptureDestination(
      fname,
      baseSettings({
        captureSaveLocation: "cloud",
        cloudCapturesEnabled: false,
        sidebarApiUrl: "https://x.example",
        sidebarApiToken: "tk"
      })
    )
    expect(r.destination.kind).toBe("downloads")
    expect(r.fallbackReason).toBe("cloud-disabled")
  })

  it("cloud mode requires API URL + token — falls back when missing", () => {
    const r = resolveCaptureDestination(
      fname,
      baseSettings({
        captureSaveLocation: "cloud",
        cloudCapturesEnabled: true,
        sidebarApiUrl: "",
        sidebarApiToken: ""
      })
    )
    expect(r.destination.kind).toBe("downloads")
    expect(r.fallbackReason).toBe("cloud-not-configured")
  })

  it("cloud mode resolves when fully configured", () => {
    const r = resolveCaptureDestination(
      fname,
      baseSettings({
        captureSaveLocation: "cloud",
        cloudCapturesEnabled: true,
        sidebarApiUrl: "https://x.example",
        sidebarApiToken: "tk"
      })
    )
    expect(r.destination.kind).toBe("cloud")
    if (r.destination.kind === "cloud") {
      expect(r.destination.apiUrl).toBe("https://x.example")
      expect(r.destination.apiToken).toBe("tk")
      expect(r.destination.filename).toBe(fname)
    }
    expect(r.fallbackReason).toBeNull()
  })
})

describe("describeCaptureDestination", () => {
  it("describes each destination kind cleanly", () => {
    expect(
      describeCaptureDestination({ kind: "downloads", filename: "a.png", hasSubfolder: false, subfolder: "" })
    ).toBe("Saved to Downloads")
    expect(
      describeCaptureDestination({
        kind: "downloads",
        filename: "snaps/a.png",
        hasSubfolder: true,
        subfolder: "snaps"
      })
    ).toBe("Saved to Downloads/snaps")
    expect(
      describeCaptureDestination({
        kind: "cloud",
        filename: "a.png",
        apiUrl: "https://x",
        apiToken: "tk"
      })
    ).toBe("Saved to cloud captures")
  })
})
