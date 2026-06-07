import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

vi.mock("../src/lib/pdf-capture", () => ({
  captureFullPagePdf: vi.fn(async () => btoa("PDFDATA")),
  base64ToBytes: (b64: string) => {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
}))
vi.mock("../src/storage", () => ({ getSettings: vi.fn(async () => ({})) }))
const resolveMock = vi.fn()
vi.mock("../src/lib/capture-destination", () => ({
  resolveCaptureDestination: (...a: unknown[]) => resolveMock(...a),
  describeCaptureDestination: () => "Saved to Downloads"
}))
const uploadMock = vi.fn(async (..._a: unknown[]) => ({ filename: "page-x.pdf" }))
vi.mock("../src/lib/capture-upload", () => ({
  uploadCapture: (...a: unknown[]) => uploadMock(...a),
  CaptureUploadError: class extends Error {},
  dataUrlToBlob: async () => new Blob()
}))

import { runFullPagePdfQuickAction } from "../src/lib/quick-actions"

describe("runFullPagePdfQuickAction", () => {
  beforeEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = {
      windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
      tabs: { query: vi.fn(async () => [{ id: 9, url: "https://e.com", title: "E" }]) },
      downloads: { download: vi.fn(async () => 1) }
    }
  })
  afterEach(() => vi.clearAllMocks())

  it("uploads as kind=pdf when destination is cloud", async () => {
    resolveMock.mockReturnValue({
      destination: { kind: "cloud", apiUrl: "u", apiToken: "t", filename: "page-x.pdf" },
      fallbackReason: null
    })
    const r = await runFullPagePdfQuickAction()
    expect(r.kind).toBe("success")
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "pdf" }))
  })

  it("downloads locally when destination is downloads", async () => {
    resolveMock.mockReturnValue({
      destination: { kind: "downloads", filename: "page-x.pdf" },
      fallbackReason: null
    })
    const r = await runFullPagePdfQuickAction()
    expect(r.kind).toBe("success")
    expect(globalThis.chrome.downloads.download).toHaveBeenCalled()
  })
})
