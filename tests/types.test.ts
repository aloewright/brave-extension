import { describe, it, expect } from "vitest"
import { DEFAULT_SETTINGS, BACKEND_INFO } from "../src/types"
import type { CLIBackend } from "../src/types"

const ALL_BACKENDS: CLIBackend[] = ["claude", "gemini", "copilot", "codex"]

describe("DEFAULT_SETTINGS", () => {
  it("uses claude as the default backend", () => {
    expect(DEFAULT_SETTINGS.backend).toBe("claude")
  })

  it("defaults theme to dark", () => {
    expect(DEFAULT_SETTINGS.theme).toBe("dark")
  })

  it("uses ~ as the default working directory", () => {
    expect(DEFAULT_SETTINGS.workingDirectory).toBe("~")
  })
})

describe("BACKEND_INFO", () => {
  it("has an entry for every CLIBackend value", () => {
    for (const b of ALL_BACKENDS) {
      expect(BACKEND_INFO[b]).toBeDefined()
      expect(typeof BACKEND_INFO[b].name).toBe("string")
      expect(typeof BACKEND_INFO[b].command).toBe("string")
    }
  })

  it("uses the correct command for each backend", () => {
    expect(BACKEND_INFO.claude.command).toBe("claude")
    expect(BACKEND_INFO.gemini.command).toBe("gemini")
    expect(BACKEND_INFO.copilot.command).toBe("gh copilot")
    expect(BACKEND_INFO.codex.command).toBe("codex")
  })
})
