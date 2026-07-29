import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { sanitizeFilename, suggestMediaFilename } from "../src/lib/ai-rename"
import {
  STICKY_NOTES_LIMIT,
  addStickyNote,
  getStickyNotes,
  removeStickyNote,
  updateStickyNote
} from "../src/lib/sticky-notes"
import { DEFAULT_SETTINGS } from "../src/types"
import { SECTIONS } from "../src/sections/types"

beforeEach(async () => {
  await chrome.storage.local.clear()
})

describe("context menu shipping changes", () => {
  it("removes send-selection, keeps highlight save, and adds RSS feed save", () => {
    const source = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    expect(source).not.toContain('id: "send-selection"')
    expect(source).not.toContain("Send selection to Brave Dev")
    expect(source).toContain('title: "Save highlight"')
    expect(source).toContain('const RSS_FEED_MENU_ID = "save-rss-feed"')
    expect(source).toContain('title: "Save RSS feed..."')
  })
})

describe("sticky notes", () => {
  it("adds, updates, deletes, and caps local notes", async () => {
    const note = await addStickyNote("first")
    await updateStickyNote(note.id, "updated")
    expect((await getStickyNotes())[0].text).toBe("updated")
    await removeStickyNote(note.id)
    expect(await getStickyNotes()).toEqual([])

    for (let i = 0; i < STICKY_NOTES_LIMIT + 5; i += 1) {
      await addStickyNote(`note ${i}`)
    }
    expect(await getStickyNotes()).toHaveLength(STICKY_NOTES_LIMIT)
  })

  it("reuses the existing fuzzy search utility in the Session notes tab", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/session/StickyNotesPanel.tsx"),
      "utf8"
    )
    expect(source).toContain('from "../_lx/utils/fuzzy"')
    expect(source).toContain("fuzzySearch(notes, query")
  })
})

describe("removed features (slim build)", () => {
  const REMOVED_SECTION_IDS = ["email", "signal", "tasks", "passwords", "quickInfo"]
  const REMOVED_FILES = [
    "src/sections/email/EmailSection.tsx",
    "src/sections/signal/SignalSection.tsx",
    "src/sections/tasks/TasksSection.tsx",
    "src/sections/passwords/PasswordVaultSection.tsx",
    "src/sections/quick-info/QuickInfoSection.tsx",
    "src/lib/password-strategy.ts",
    "src/lib/go-vault-client.ts",
    "src/lib/go-vault-session-state.ts",
    "src/lib/go-vault-readiness.ts",
    "src/lib/mail-2fa.ts",
    "src/lib/signal-types.ts",
    "src/contents/go-vault-session.ts",
    "src/contents/mail-2fa-autofill.ts",
    "src/background/mail-proxy.ts",
    "src/background/cal-tasks-proxy.ts",
    "src/background/cal-tasks-origin.ts",
    "native-host/signal-bridge.mjs"
  ]

  it("does not register mail, signal, tasks, passwords, or contact enrichment in the rail", () => {
    const ids = SECTIONS.map((section) => section.id) as string[]
    for (const removed of REMOVED_SECTION_IDS) {
      expect(ids).not.toContain(removed)
    }
  })

  it("ships no source files for the removed features", () => {
    for (const file of REMOVED_FILES) {
      expect(existsSync(join(process.cwd(), file))).toBe(false)
    }
  })

  it("keeps no background message handlers or content scripts for the removed features", () => {
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    const buildScript = readFileSync(
      join(process.cwd(), "scripts/build-extension.mjs"),
      "utf8"
    )
    for (const handler of [
      "TASKS_API_REQUEST",
      "MAIL_2FA_CODE_REQUEST",
      "MAIL_INBOX_LIST_REQUEST",
      "MAIL_THREAD_DETAIL_REQUEST",
      "MAIL_ACTIVITY_LIST_REQUEST",
      "GO_VAULT_SESSION_STATUS"
    ]) {
      expect(background).not.toContain(handler)
    }
    expect(buildScript).not.toContain("mail-2fa-autofill")
    expect(buildScript).not.toContain("go-vault-session")
  })

  it("purges storage keys the removed features used to write", async () => {
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    for (const key of [
      "passwords.autofill.cache",
      "passwords.go.sessionStatus.v1",
      "mail2fa.debug"
    ]) {
      expect(background).toContain(key)
    }
    expect(background).toContain("purgeRemovedFeatureStorage()")
  })

  it("keeps the new tab saved-URL defaults untouched", () => {
    const quickLinks = readFileSync(
      join(process.cwd(), "src/newtab-quick-links.ts"),
      "utf8"
    )
    expect(quickLinks).toContain('url: "https://mail.fly.pm"')
    expect(quickLinks).toContain('url: "https://alex.coffee"')
  })
})

describe("AI media rename safety", () => {
  it("keeps deterministic filenames when cloud planning is disabled", async () => {
    await expect(
      suggestMediaFilename({
        settings: DEFAULT_SETTINGS,
        fallbackFilename: "screenshot-2026-05-24.png",
        mediaKind: "image"
      })
    ).resolves.toBe("screenshot-2026-05-24.png")
  })

  it("sanitizes cloud-proposed filenames and preserves extensions", () => {
    expect(sanitizeFilename("  Login / screen capture  ", "capture.png")).toBe(
      "Login-screen-capture.png"
    )
    expect(sanitizeFilename("", "capture.png")).toBe("capture.png")
  })
})

describe("media previews", () => {
  it("opens capture and recording previews in popup windows", () => {
    const captures = readFileSync(
      join(process.cwd(), "src/sections/captures/CapturesSection.tsx"),
      "utf8"
    )
    const recorder = readFileSync(
      join(process.cwd(), "src/sections/recorder/RecorderSection.tsx"),
      "utf8"
    )
    expect(captures).toContain("openPopupWindow(url)")
    expect(captures).toContain("<img src={url}")
    expect(recorder).toContain("openRecordingPreview")
    expect(recorder).toContain("openPopupWindow(url, 760, 560)")
  })
})
