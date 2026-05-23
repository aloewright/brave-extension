import { describe, expect, it, vi, type Mock } from "vitest"
import { makeEnv } from "./helpers"
import { extractPdfText } from "../src/pdf"

describe("extractPdfText", () => {
  it("returns the text layer when pdfjs-dist reads at least 50 chars", async () => {
    // We can't easily generate a real PDF inline. Instead, stub the dynamic
    // import via vi.doMock and rebuild the module under test.
    vi.resetModules()
    const longText = "lorem ipsum dolor sit amet ".repeat(10)
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({
              items: longText.split(" ").map((str) => ({ str }))
            })
          })
        })
      })
    }))
    const { extractPdfText: pdfExtract } = await import("../src/pdf")
    const env = makeEnv()
    const out = await pdfExtract(env, new Uint8Array([1, 2, 3]))
    expect(out.method).toBe("text-layer")
    expect(out.pageCount).toBe(1)
    expect(out.text.length).toBeGreaterThanOrEqual(50)
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs")
  })

  it("falls back to OCR when pdfjs returns short text", async () => {
    vi.resetModules()
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({ items: [{ str: "hi" }] })
          })
        })
      })
    }))
    const { extractPdfText: pdfExtract } = await import("../src/pdf")
    const env = makeEnv({
      AI: {
        run: vi.fn(async () => ({ description: "ocr-extracted text from the page" }))
      } as unknown as Ai
    })
    const out = await pdfExtract(env, new Uint8Array([1, 2, 3]))
    expect(out.method).toBe("ocr")
    expect(out.text).toBe("ocr-extracted text from the page")
    expect((env.AI.run as Mock)).toHaveBeenCalled()
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs")
  })

  it("returns method='empty' when both pdfjs and OCR fail to produce text", async () => {
    vi.resetModules()
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", () => {
      throw new Error("not installed")
    })
    const { extractPdfText: pdfExtract } = await import("../src/pdf")
    const env = makeEnv({
      AI: {
        run: vi.fn(async () => ({ description: "" }))
      } as unknown as Ai
    })
    const out = await pdfExtract(env, new Uint8Array([1, 2, 3]))
    expect(out.method).toBe("empty")
    expect(out.text).toBe("")
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs")
  })
})
