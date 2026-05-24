import { describe, expect, it } from "vitest"
import { buildBrowserAgentCloudChatPayload } from "../src/lib/browser-agent-cloud"

const observation = {
  url: "https://secret.example/account",
  title: "Secret Billing Page",
  visibleText: "Card number 4242 4242 4242 4242",
  nodes: [{ ref: "el1", name: "Pay now", text: "Pay now", selector: "#pay" }],
}

const baseSettings = {
  browserAgentCloudPlanningEnabled: false,
  browserAgentCloudVisionEnabled: false,
  browserAgentCloudOcrEnabled: false,
}

describe("browser agent cloud routing payloads", () => {
  it("does not include raw page observation when cloud planning is disabled", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: baseSettings,
      sessionId: "s1",
      message: "click pay",
      objective: "click pay",
      observation,
    })

    expect(payload.cloudUse).toEqual({ planning: false, vision: false, ocr: false })
    expect(payload).not.toHaveProperty("observation")
    expect(JSON.stringify(payload)).not.toContain("4242")
    expect(JSON.stringify(payload)).not.toContain("secret.example")
  })

  it("includes capped observation only after explicit cloud planning opt-in", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: { ...baseSettings, browserAgentCloudPlanningEnabled: true },
      sessionId: "s1",
      message: "click pay",
      objective: "click pay",
      observation,
    })

    expect(payload.cloudUse).toEqual({ planning: true, vision: false, ocr: false })
    expect(payload.observation).toBe(observation)
  })

  it("does not send DOM text for vision/OCR-only cloud opt-ins", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: {
        ...baseSettings,
        browserAgentCloudVisionEnabled: true,
        browserAgentCloudOcrEnabled: true,
      },
      sessionId: "s1",
      message: "read screenshot",
      objective: "read screenshot",
      observation,
    })

    expect(payload.cloudUse).toEqual({ planning: false, vision: true, ocr: true })
    expect(payload).not.toHaveProperty("observation")
    expect(JSON.stringify(payload)).not.toContain("Card number")
  })
})
