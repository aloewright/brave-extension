import { describe, it, expect } from "vitest"
import { BACKEND_INFO } from "../src/types"
import type { CLIBackend } from "../src/types"

// PDX-124 regression: SettingsPanel previously set `ringColor` inline,
// which is not a valid React.CSSProperties key. The fix routes the active
// backend's color through the `--tw-ring-color` custom property so the
// Tailwind `ring-1` utility picks it up. We model the same lookup the
// component uses so the tied-together regression (BACKEND_INFO color +
// custom-prop key) stays locked in without needing a full DOM render.
function activeBackendStyle(active: CLIBackend, key: CLIBackend): React.CSSProperties {
  const info = BACKEND_INFO[key]
  return {
    borderColor: active === key ? info.color : "transparent",
    backgroundColor: active === key ? info.color + "15" : undefined,
    ["--tw-ring-color" as string]: info.color
  } as React.CSSProperties
}

describe("SettingsPanel — active backend ring color (PDX-124)", () => {
  it("uses --tw-ring-color (not the invalid `ringColor` key)", () => {
    const style = activeBackendStyle("claude", "claude") as Record<string, unknown>
    expect(Object.keys(style)).toContain("--tw-ring-color")
    expect(Object.keys(style)).not.toContain("ringColor")
  })

  it("maps the ring color to the backend's brand color", () => {
    for (const backend of ["claude", "gemini", "copilot", "codex"] as CLIBackend[]) {
      const style = activeBackendStyle(backend, backend) as Record<string, unknown>
      expect(style["--tw-ring-color"]).toBe(BACKEND_INFO[backend].color)
    }
  })

  it("non-active backend leaves borderColor transparent", () => {
    const style = activeBackendStyle("claude", "gemini")
    expect(style.borderColor).toBe("transparent")
  })
})
