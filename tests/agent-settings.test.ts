import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { DEFAULT_SETTINGS } from "../src/types"

describe("agent API settings", () => {
  it("DEFAULT_SETTINGS has agent api url + access token fields", () => {
    expect(DEFAULT_SETTINGS).toHaveProperty("agentApiUrl")
    expect(DEFAULT_SETTINGS).toHaveProperty("agentAccessClientId")
    expect(DEFAULT_SETTINGS).toHaveProperty("agentAccessClientSecret")
  })
  it("SettingsPanel renders inputs bound to the agent settings", () => {
    const src = readFileSync(join(process.cwd(), "src/components/SettingsPanel.tsx"), "utf8")
    expect(src).toContain("agentApiUrl")
    expect(src).toContain("agentAccessClientId")
    expect(src).toContain("agentAccessClientSecret")
  })
  it("defaults the agent API URL to the deployed Worker", () => {
    expect(DEFAULT_SETTINGS.agentApiUrl).toBe("https://agent.fly.pm")
  })
  it("auto-fills the agent service token from Doppler in SettingsSection", () => {
    const src = readFileSync(
      join(process.cwd(), "src/sections/settings/SettingsSection.tsx"),
      "utf8"
    )
    // Requested in the Doppler batch download...
    expect(src).toContain("AGENT_ACCESS_CLIENT_ID")
    expect(src).toContain("AGENT_ACCESS_CLIENT_SECRET")
    // ...and written into settings from the result.
    expect(src).toContain("agentAccessClientId")
    expect(src).toContain("agentAccessClientSecret")
  })
})
