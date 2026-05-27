import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Source-shape tests for the AI Chat sidebar section. UI rendering is
// covered by manual smoke; these assertions catch regressions in the
// "Enter sends" UX and the "surface turn errors" silent-failure fix.

const SOURCE = readFileSync(
  join(process.cwd(), "src/sections/ai-chat/ChatSection.tsx"),
  "utf8",
)

describe("ChatSection composer", () => {
  it("sends on bare Enter but preserves Shift+Enter for newlines", () => {
    expect(SOURCE).toContain('e.key === "Enter"')
    expect(SOURCE).toContain("!e.shiftKey")
    expect(SOURCE).toContain("e.preventDefault()")
    expect(SOURCE).toContain("void onSend()")
  })

  it("placeholder reflects the new Enter-to-send shortcut", () => {
    expect(SOURCE).not.toContain("Cmd-Enter to send")
    expect(SOURCE).toMatch(/Enter to send/i)
  })
})

describe("ChatSection error surfacing", () => {
  it("appends an assistant-visible error when turn-done carries errorMessage", () => {
    // The fix routes ev.errorMessage into the messages list so silent
    // native-host failures stop swallowing every reply.
    expect(SOURCE).toContain("ev.errorMessage")
    expect(SOURCE).toMatch(/ev\.reason\s*===\s*["']error["']/)
    // Has to push an assistant message into local state; otherwise the
    // user just sees their own message disappear and nothing else.
    expect(SOURCE).toMatch(/role:\s*["']assistant["']/)
  })
})
