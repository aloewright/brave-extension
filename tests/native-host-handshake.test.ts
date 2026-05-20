import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("native host sidepanel handshake", () => {
  it("forwards pong responses so useNativeHost can mark the terminal connected", () => {
    const backgroundSource = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8"
    )
    const hookSource = readFileSync(
      join(process.cwd(), "src/hooks/useNativeHost.ts"),
      "utf8"
    )

    expect(hookSource).toContain('payload: { type: "ping" }')
    expect(hookSource).toContain("setConnected(true)")
    expect(backgroundSource).not.toContain('if (msg?.type === "pong") return')
  })
})
