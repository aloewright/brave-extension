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
})
