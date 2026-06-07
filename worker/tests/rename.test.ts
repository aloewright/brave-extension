import { describe, expect, it, vi } from "vitest"
import { suggestFilenameFromText } from "../src/rename"

function envWithReply(reply: string) {
  return {
    AI: {
      run: vi.fn(async () => ({ response: reply }))
    }
  } as unknown as import("../src/env").Env
}

describe("suggestFilenameFromText", () => {
  it("builds a sanitized name from the model reply and keeps the extension", async () => {
    const env = envWithReply("Quarterly Revenue Report")
    const name = await suggestFilenameFromText(env, {
      text: "Q3 revenue grew 12% ...",
      kind: "pdf",
      fallback: "page-2026.pdf"
    })
    expect(name).toBe("quarterly-revenue-report.pdf")
  })

  it("falls back when text is empty", async () => {
    const env = envWithReply("whatever")
    const name = await suggestFilenameFromText(env, {
      text: "   ",
      kind: "screenshot",
      fallback: "screenshot-x.png"
    })
    expect(name).toBe("screenshot-x.png")
  })

  it("falls back when the model call throws", async () => {
    const env = {
      AI: { run: vi.fn(async () => { throw new Error("rate limited") }) }
    } as unknown as import("../src/env").Env
    const name = await suggestFilenameFromText(env, {
      text: "some content",
      kind: "screenshot",
      fallback: "screenshot-x.png"
    })
    expect(name).toBe("screenshot-x.png")
  })

  it("falls back when the model reply is empty after sanitizing", async () => {
    const env = envWithReply("!!!  ###")
    const name = await suggestFilenameFromText(env, {
      text: "content",
      kind: "pdf",
      fallback: "page-x.pdf"
    })
    expect(name).toBe("page-x.pdf")
  })
})
