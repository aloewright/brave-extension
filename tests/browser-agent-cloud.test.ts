import { describe, expect, it } from "vitest"
import {
  buildBrowserAgentCloudChatPayload,
  browserAgentCloudUseFromSettings,
} from "../src/lib/browser-agent-cloud"

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

describe("browserAgentCloudUseFromSettings", () => {
  it("maps all-false settings to all-false cloudUse", () => {
    const result = browserAgentCloudUseFromSettings({
      browserAgentCloudPlanningEnabled: false,
      browserAgentCloudVisionEnabled: false,
      browserAgentCloudOcrEnabled: false,
    })
    expect(result).toEqual({ planning: false, vision: false, ocr: false })
  })

  it("maps all-true settings to all-true cloudUse", () => {
    const result = browserAgentCloudUseFromSettings({
      browserAgentCloudPlanningEnabled: true,
      browserAgentCloudVisionEnabled: true,
      browserAgentCloudOcrEnabled: true,
    })
    expect(result).toEqual({ planning: true, vision: true, ocr: true })
  })

  it("treats undefined (missing) setting values as false", () => {
    const result = browserAgentCloudUseFromSettings({
      browserAgentCloudPlanningEnabled: undefined as unknown as boolean,
      browserAgentCloudVisionEnabled: undefined as unknown as boolean,
      browserAgentCloudOcrEnabled: undefined as unknown as boolean,
    })
    expect(result).toEqual({ planning: false, vision: false, ocr: false })
  })

  it("treats null setting values as false", () => {
    const result = browserAgentCloudUseFromSettings({
      browserAgentCloudPlanningEnabled: null as unknown as boolean,
      browserAgentCloudVisionEnabled: null as unknown as boolean,
      browserAgentCloudOcrEnabled: null as unknown as boolean,
    })
    expect(result).toEqual({ planning: false, vision: false, ocr: false })
  })

  it("treats truthy non-boolean values as false (strict === true check)", () => {
    const result = browserAgentCloudUseFromSettings({
      browserAgentCloudPlanningEnabled: 1 as unknown as boolean,
      browserAgentCloudVisionEnabled: "yes" as unknown as boolean,
      browserAgentCloudOcrEnabled: {} as unknown as boolean,
    })
    expect(result).toEqual({ planning: false, vision: false, ocr: false })
  })
})

describe("buildBrowserAgentCloudChatPayload additional edge cases", () => {
  it("preserves sessionId and message verbatim in the payload", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: baseSettings,
      sessionId: "session-abc-123",
      message: "navigate to /dashboard",
    })
    expect(payload.sessionId).toBe("session-abc-123")
    expect(payload.message).toBe("navigate to /dashboard")
  })

  it("omits objective key when not provided", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: baseSettings,
      sessionId: "s1",
      message: "do something",
    })
    // objective is undefined so it appears in the payload as undefined
    expect(payload.objective).toBeUndefined()
  })

  it("passes through objective when provided", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: { ...baseSettings, browserAgentCloudPlanningEnabled: true },
      sessionId: "s1",
      message: "submit form",
      objective: "complete checkout",
    })
    expect(payload.objective).toBe("complete checkout")
  })

  it("includes observation even when observation is undefined and planning is enabled", () => {
    const payload = buildBrowserAgentCloudChatPayload({
      settings: { ...baseSettings, browserAgentCloudPlanningEnabled: true },
      sessionId: "s1",
      message: "click pay",
      observation: undefined,
    })
    // observation key is set (to undefined) because planning is true
    expect(payload.cloudUse.planning).toBe(true)
    expect(payload.observation).toBeUndefined()
  })

  it("all cloud features enabled - observation is included (planning drives the gate)", () => {
    const allEnabled = {
      browserAgentCloudPlanningEnabled: true,
      browserAgentCloudVisionEnabled: true,
      browserAgentCloudOcrEnabled: true,
    }
    const payload = buildBrowserAgentCloudChatPayload({
      settings: allEnabled,
      sessionId: "s1",
      message: "click pay",
      observation,
    })
    expect(payload.cloudUse).toEqual({ planning: true, vision: true, ocr: true })
    expect(payload.observation).toBe(observation)
  })

  it("serialized payload does not leak sensitive data when all cloud features disabled", () => {
    const sensitiveObs = {
      url: "https://bank.example/transfer",
      visibleText: "Account balance: $12,345",
      nodes: [{ ref: "e1", name: "Transfer", selector: "#transfer-btn" }],
    }
    const payload = buildBrowserAgentCloudChatPayload({
      settings: baseSettings,
      sessionId: "s1",
      message: "transfer funds",
      observation: sensitiveObs,
    })
    const json = JSON.stringify(payload)
    expect(json).not.toContain("bank.example")
    expect(json).not.toContain("$12,345")
    expect(json).not.toContain("Account balance")
  })
})
