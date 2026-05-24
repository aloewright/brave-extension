/**
 * Capture destination resolver (ALO-467). The sidebar can save screenshots
 * and full-page PDFs to one of three places:
 *
 *   - "downloads"            → Chrome's default Downloads folder (back-compat default).
 *   - "downloads-subfolder"  → Downloads folder, prepending a user-configurable subfolder.
 *   - "cloud"                → Sidebar-API Worker (R2-backed; see ALO-468).
 *
 * Pure functions; no chrome.* dependency. Callers handle the actual upload
 * or chrome.downloads.download invocation based on the resolver's verdict.
 */
export type CaptureSaveLocation = "downloads" | "downloads-subfolder" | "cloud"
export type CaptureKind = "screenshot" | "pdf"

export const DEFAULT_CAPTURE_SUBFOLDER = "ai-dev-sidebar"
export const DEFAULT_CAPTURE_SAVE_LOCATION: CaptureSaveLocation = "downloads"

export interface CaptureSettingsLike {
  captureSaveLocation: CaptureSaveLocation
  captureSubfolder: string
  cloudCapturesEnabled: boolean
  sidebarApiUrl: string
  sidebarApiToken: string
}

export type ResolvedCaptureDestination =
  | {
      kind: "downloads"
      /** Final filename including any subfolder Chrome should create. */
      filename: string
      /** True iff the user explicitly asked for a subfolder. */
      hasSubfolder: boolean
      /** Sanitized subfolder string (empty when not in use). */
      subfolder: string
    }
  | {
      kind: "cloud"
      filename: string
      apiUrl: string
      apiToken: string
    }

/**
 * Reason a cloud destination request was rejected and routed back to
 * downloads. Surface to the user so the failure isn't silent.
 */
export type CaptureDestinationFallbackReason =
  | "cloud-not-configured"
  | "cloud-disabled"

export interface CaptureDestinationResolution {
  destination: ResolvedCaptureDestination
  fallbackReason: CaptureDestinationFallbackReason | null
}

const ILLEGAL_FILENAME_CHARS = /[<>:"|?*\x00-\x1f]/g

/**
 * Strip leading slashes, collapse separators, kill ".." traversals, and
 * scrub characters Chrome rejects. Returns "" if the input is empty after
 * sanitization — callers must treat that as "no subfolder" and fall back
 * to the bare filename.
 */
export function sanitizeSubfolder(input: string): string {
  if (!input) return ""
  let s = input.trim()
  // Normalize Windows-style separators.
  s = s.replace(/\\/g, "/")
  // Drop leading slashes — Chrome will reject an absolute path.
  s = s.replace(/^\/+/, "")
  // Collapse runs of "/".
  s = s.replace(/\/+/g, "/")
  // Drop trailing slash.
  s = s.replace(/\/+$/, "")
  // Kill "..": run repeatedly until no segment remains so chained ../..
  // doesn't sneak through.
  while (true) {
    const next = s
      .split("/")
      .filter((seg) => seg !== "" && seg !== "..")
      .join("/")
    if (next === s) {
      s = next
      break
    }
    s = next
  }
  s = s.replace(ILLEGAL_FILENAME_CHARS, "_")
  return s
}

export function resolveCaptureDestination(
  baseFilename: string,
  settings: CaptureSettingsLike
): CaptureDestinationResolution {
  const filename = baseFilename
  const loc = settings.captureSaveLocation
  if (loc === "cloud") {
    const apiUrl = (settings.sidebarApiUrl || "").trim()
    const apiToken = (settings.sidebarApiToken || "").trim()
    if (!settings.cloudCapturesEnabled) {
      return {
        destination: makeDownloadsDestination(filename, settings),
        fallbackReason: "cloud-disabled"
      }
    }
    if (!apiUrl || !apiToken) {
      return {
        destination: makeDownloadsDestination(filename, settings),
        fallbackReason: "cloud-not-configured"
      }
    }
    return {
      destination: { kind: "cloud", filename, apiUrl, apiToken },
      fallbackReason: null
    }
  }
  return {
    destination: makeDownloadsDestination(filename, settings),
    fallbackReason: null
  }
}

function makeDownloadsDestination(
  baseFilename: string,
  settings: CaptureSettingsLike
): ResolvedCaptureDestination {
  if (settings.captureSaveLocation !== "downloads-subfolder") {
    return { kind: "downloads", filename: baseFilename, hasSubfolder: false, subfolder: "" }
  }
  const subfolder = sanitizeSubfolder(settings.captureSubfolder || DEFAULT_CAPTURE_SUBFOLDER)
  if (!subfolder) {
    return { kind: "downloads", filename: baseFilename, hasSubfolder: false, subfolder: "" }
  }
  return {
    kind: "downloads",
    filename: `${subfolder}/${baseFilename}`,
    hasSubfolder: true,
    subfolder
  }
}

/**
 * Compact human-readable label for the resolver's verdict. Used by the
 * sidebar to render a confirmation toast after a capture lands.
 */
export function describeCaptureDestination(d: ResolvedCaptureDestination): string {
  if (d.kind === "cloud") return "Saved to cloud captures"
  if (d.kind === "downloads" && d.hasSubfolder) return `Saved to Downloads/${d.subfolder}`
  return "Saved to Downloads"
}
