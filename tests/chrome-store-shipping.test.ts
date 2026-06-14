import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { sanitizeFilename, suggestMediaFilename } from "../src/lib/ai-rename"
import {
  LEGACY_PASSWORD_STORAGE_KEYS,
  PASSWORD_STRATEGY,
  getLegacyPasswordStorageState,
  purgeLegacyPasswordStorage
} from "../src/lib/password-strategy"
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

describe("password strategy", () => {
  it("uses go as the external vault without storing passwords in the extension", () => {
    const ids = SECTIONS.map((section) => section.id)
    expect(ids as string[]).toContain("passwords")
    expect(PASSWORD_STRATEGY).toMatchObject({
      activeManager: "nodewarden-self-hosted",
      extensionStoresVaultPasswords: false,
      passiveAutofillEnabled: false,
      selfHostedNodewardenStatus: "go external vault"
    })
  })

  it("does not ship the old local password manager UI or passive autofill content script", () => {
    expect(existsSync(join(process.cwd(), "src/sections/passwords/PasswordsSection.tsx"))).toBe(false)
    expect(existsSync(join(process.cwd(), "src/sections/passwords/PasswordVaultSection.tsx"))).toBe(true)
    expect(existsSync(join(process.cwd(), "src/contents/password-autofill.ts"))).toBe(false)
  })

  it("purges legacy local password cache keys", async () => {
    await chrome.storage.local.set(
      Object.fromEntries(LEGACY_PASSWORD_STORAGE_KEYS.map((key) => [key, "legacy"]))
    )

    expect((await getLegacyPasswordStorageState()).every((entry) => entry.present)).toBe(true)
    await purgeLegacyPasswordStorage()
    expect((await getLegacyPasswordStorageState()).every((entry) => !entry.present)).toBe(true)
  })

  it("fills two-factor text inputs from recent mail.fly.pm verification emails", () => {
    const content = readFileSync(
      join(process.cwd(), "src/contents/mail-2fa-autofill.ts"),
      "utf8"
    )
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    expect(content).toContain('type: "MAIL_2FA_CODE_REQUEST"')
    expect(content).toContain('input.autocomplete?.toLowerCase() === "one-time-code"')
    expect(content).toContain("fillTarget(target, code)")
    expect(content).not.toContain(".click()")
    expect(background).toContain("getMailFlyPmCookieHeader")
    expect(background).toContain("buildMailTwoFactorListUrl")
    expect(background).toContain("findBestMailTwoFactorCode")
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
