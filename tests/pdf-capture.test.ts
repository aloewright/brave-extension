import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { base64ToBytes, captureFullPagePdf } from "../src/lib/pdf-capture"

describe("base64ToBytes", () => {
  it("decodes base64 to the original bytes", () => {
    const b64 = btoa("PDF")
    expect(Array.from(base64ToBytes(b64))).toEqual([80, 68, 70])
  })
})

describe("captureFullPagePdf", () => {
  const orig = globalThis.chrome
  beforeEach(() => {
    const attach = vi.fn((_t: unknown, _v: string, cb: () => void) => cb())
    const detach = vi.fn((_t: unknown, cb?: () => void) => cb?.())
    const sendCommand = vi.fn(
      (_t: unknown, method: string, _p: unknown, cb: (r: unknown) => void) => {
        if (method === "Page.printToPDF") cb({ data: btoa("PDFBYTES") })
        else cb({})
      }
    )
    ;(globalThis as { chrome?: unknown }).chrome = {
      debugger: { attach, detach, sendCommand },
      runtime: { lastError: undefined }
    }
  })
  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = orig
  })

  it("attaches, prints, detaches, and returns base64 PDF data", async () => {
    const data = await captureFullPagePdf(42)
    expect(data).toBe(btoa("PDFBYTES"))
    expect(globalThis.chrome.debugger.detach).toHaveBeenCalled()
  })

  it("detaches even if printToPDF fails", async () => {
    ;(globalThis.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (_t: unknown, _m: string, _p: unknown, cb: (r: unknown) => void) => {
        ;(globalThis.chrome.runtime as { lastError?: unknown }).lastError = { message: "Cannot attach" }
        cb(undefined)
      }
    )
    await expect(captureFullPagePdf(42)).rejects.toThrow()
    expect(globalThis.chrome.debugger.detach).toHaveBeenCalled()
  })
})
