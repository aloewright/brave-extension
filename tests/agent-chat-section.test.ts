import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { appendDelta, buildPlaceholderAssistant } from "../src/sections/agent-chat/AgentChatSection"

// This repo avoids @testing-library/react. The AgentChatSection is verified
// two ways, mirroring tests/sidebar-rail.test.tsx:
//   1. Unit tests over the exported pure reducer helpers.
//   2. Source-contract assertions over the component source so the wiring
//      (client, settings, streaming loop, model picker, config hint) stays honest.

describe("AgentChatSection pure helpers", () => {
  it("appendDelta concatenates deltas in order", () => {
    let streaming = ""
    streaming = appendDelta(streaming, "Hel")
    streaming = appendDelta(streaming, "lo")
    streaming = appendDelta(streaming, " world")
    expect(streaming).toBe("Hello world")
  })

  it("appendDelta leaves the prefix untouched for an empty delta", () => {
    expect(appendDelta("abc", "")).toBe("abc")
  })

  it("buildPlaceholderAssistant produces an empty assistant message tagged with id + model", () => {
    const m = buildPlaceholderAssistant("a1", "m1")
    expect(m.id).toBe("a1")
    expect(m.role).toBe("assistant")
    expect(m.content).toBe("")
    expect(m.model).toBe("m1")
  })
})

describe("AgentChatSection source contract", () => {
  const source = readFileSync(
    join(process.cwd(), "src/sections/agent-chat/AgentChatSection.tsx"),
    "utf8"
  )

  it("builds its client via createAgentApiClient", () => {
    expect(source).toContain("createAgentApiClient")
  })

  it("loads settings via getSettings", () => {
    expect(source).toContain("getSettings")
  })

  it("streams replies with a for-await streamMessage loop", () => {
    expect(source).toContain("for await")
    expect(source).toContain("streamMessage(")
  })

  it("renders a select-based model picker", () => {
    expect(source).toContain("<select")
    expect(source).toContain("setModelPref")
  })

  it("renders a config hint pointing at Settings", () => {
    expect(source).toContain("Settings")
  })

  it("submits on Enter without Shift", () => {
    expect(source).toContain('e.key === "Enter"')
    expect(source).toContain("shiftKey")
  })

  it("uses a composer placeholder containing the word message", () => {
    expect(source.toLowerCase()).toContain("placeholder=")
    expect(source.toLowerCase()).toMatch(/placeholder="[^"]*message/i)
  })
})
