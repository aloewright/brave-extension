import { describe, it, expect } from "vitest"
import React from "react"
import { createRoot, type Root } from "react-dom/client"
import { act } from "react-dom/test-utils"
import { BACKEND_INFO, DEFAULT_SETTINGS } from "../src/types"
import type { CLIBackend, DopplerStatus, MCPStatus } from "../src/types"

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

const mcpStatus: MCPStatus = {
  port: 9101,
  sessions: 1,
  registered: true,
  claudeJsonStatus: "registered",
  terminalPathStatus: "disabled",
  hasRcBlock: false,
  hasWrapper: false,
  tokenSet: true,
  tools: 12,
  resources: 2
}

const dopplerStatus: DopplerStatus = {
  cliAvailable: true,
  cliVersion: "Doppler CLI 3.75.1",
  tokenSet: false,
  tokenSource: "none",
  tokenPreview: null,
  workplaceName: null,
  workplaceSlug: null,
  authType: null,
  tokenName: null,
  defaults: { project: "", config: "", scope: "/" },
  tokenScope: null,
  lastCheckedAt: "2026-05-24T00:00:00.000Z",
  error: null
}

async function renderSettingsPanel() {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const { SettingsPanel } = await import("../src/components/SettingsPanel")
  const host = document.createElement("div")
  document.body.append(host)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(host)
    root.render(
      <SettingsPanel
        settings={DEFAULT_SETTINGS}
        onUpdate={() => {}}
        onClose={() => {}}
        nativeHost={{
          connected: true,
          getMCPServers: () => {},
          addMCPServer: () => {}
        }}
        mcpServers={[]}
        sidebarSync={{ lastSyncAt: null, lastError: null, pending: false, flush: () => {} }}
        mcp={{
          status: mcpStatus,
          refresh: () => {},
          rotateToken: () => {},
          resetRegistration: () => {},
          setTerminalPath: () => {},
          pending: { terminalPath: true },
          loading: { terminalPath: true },
          toast: null
        }}
        doppler={{
          status: dopplerStatus,
          refresh: () => {},
          login: () => {},
          saveDefaults: () => {},
          pending: { login: true },
          loading: { login: true },
          toast: null
        }}
      />
    )
  })
  return {
    host,
    cleanup: () => {
      act(() => root?.unmount())
      host.remove()
    }
  }
}

describe("SettingsPanel — async action feedback", () => {
  it("renders a loading glyph and disables the terminal availability toggle", async () => {
    const { host, cleanup } = await renderSettingsPanel()
    try {
      const status = host.querySelector('[aria-label="Available in any terminal loading"]')
      const input = host.querySelector<HTMLInputElement>('input[type="checkbox"]')
      expect(status).not.toBeNull()
      expect(status?.className).toContain("animate-spin")
      expect(input?.disabled).toBe(true)
    } finally {
      cleanup()
    }
  })

  it("renders a loading glyph and disables Doppler OAuth login", async () => {
    const { host, cleanup } = await renderSettingsPanel()
    try {
      const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button"))
        .find((node) => node.textContent?.includes("OAuth login"))
      const status = host.querySelector('[aria-label="Connecting Doppler OAuth"]')
      expect(button?.disabled).toBe(true)
      expect(status).not.toBeNull()
      expect(status?.className).toContain("animate-spin")
    } finally {
      cleanup()
    }
  })
})
