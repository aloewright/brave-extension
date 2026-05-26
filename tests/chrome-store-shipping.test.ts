import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { sanitizeFilename, suggestMediaFilename } from "../src/lib/ai-rename"
import {
  NODEWARDEN_DEFAULT_URL,
  addPasswordLogin,
  getMatchingPasswordLogins,
  getNodewardenServerUrl,
  getPasswordLogins,
  PASSWORD_NODEWARDEN_URL_KEY,
  PASSWORD_AUTOFILL_STORAGE_KEY,
  normalizeServerUrl,
  setSelectedPasswordLogin,
  upsertPasswordLogins,
  updatePasswordLogin
} from "../src/lib/passwords"
import {
  STICKY_NOTES_LIMIT,
  addStickyNote,
  getStickyNotes,
  removeStickyNote,
  updateStickyNote
} from "../src/lib/sticky-notes"
import { DEFAULT_SETTINGS } from "../src/types"
import { SECTIONS, type SectionId } from "../src/sections/types"

beforeEach(async () => {
  await chrome.storage.local.clear()
})

describe("context menu shipping changes", () => {
  it("removes send-selection, renames snippet save, and adds RSS feed save", () => {
    const source = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    expect(source).not.toContain('id: "send-selection"')
    expect(source).not.toContain("Send selection to Brave Dev")
    expect(source).toContain('title: "Save snippet"')
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

describe("passwords and Nodewarden", () => {
  it("adds a Passwords rail section with the Nodewarden default URL", () => {
    const ids = SECTIONS.map((section) => section.id)
    expect(ids).toContain<SectionId>("passwords")
    expect(NODEWARDEN_DEFAULT_URL).toBe("https://passwords.lazee.workers.dev")
  })

  it("matches local autofill logins by host without leaking missing matches", async () => {
    await addPasswordLogin({
      name: "Example",
      username: "a@example.com",
      password: "secret",
      urls: ["https://example.com/login"]
    })
    expect(await getPasswordLogins()).toHaveLength(1)
    expect(await getMatchingPasswordLogins("https://www.example.com/session")).toHaveLength(1)
    expect(await getMatchingPasswordLogins("https://elsewhere.test")).toEqual([])
  })

  it("persists autofill cache locally and tracks selected logins for multiple matches", async () => {
    await upsertPasswordLogins([
      {
        id: "nodewarden-1",
        decName: "Example",
        login: {
          decUsername: "a@example.com",
          decPassword: "secret",
          uris: [{ decUri: "https://example.com/login" }]
        }
      }
    ])
    await setSelectedPasswordLogin("nodewarden-1")
    const stored = await chrome.storage.local.get(PASSWORD_AUTOFILL_STORAGE_KEY)
    expect(stored[PASSWORD_AUTOFILL_STORAGE_KEY]).toHaveLength(1)
    expect(await getMatchingPasswordLogins("https://example.com/login")).toHaveLength(1)
  })

  it("renders a responsive Bitwarden-style sidebar vault surface", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/passwords/PasswordsSection.tsx"),
      "utf8"
    )
    expect(source).toContain('{ id: "vault", label: "Vault" }')
    expect(source).toContain('{ id: "generator", label: "Generator" }')
    expect(source).toContain('{ id: "web", label: "Web Vault" }')
    expect(source).toContain("grid-cols-[minmax(190px,0.9fr)_minmax(230px,1.1fr)]")
    expect(source).toContain("max-[620px]:grid-cols-1")
    expect(source).toContain("NODEWARDEN_AUTOFILL_SYNC")
    expect(source).toContain("NODEWARDEN_AUTOFILL_REQUEST")
    expect(source).toContain("setSelectedPasswordLogin(login.id)")
    expect(source).toContain("PASSWORDS_RETRY_AUTOFILL")
  })

  it("updates local vault items and normalizes Nodewarden server URLs", async () => {
    const login = await addPasswordLogin({
      name: "Example",
      username: "a@example.com",
      password: "secret",
      urls: ["https://example.com/login"]
    })
    await updatePasswordLogin(login.id, { favorite: true, folder: "Work" })
    expect((await getPasswordLogins())[0]).toMatchObject({
      favorite: true,
      folder: "Work"
    })
    expect(normalizeServerUrl("https://passwords.lazee.workers.dev/vault?x=1#y")).toBe(
      "https://passwords.lazee.workers.dev/vault"
    )
  })

  it("keeps invalid stored Nodewarden URLs from crashing the Passwords tab", async () => {
    await chrome.storage.local.set({ [PASSWORD_NODEWARDEN_URL_KEY]: "not a url" })
    await expect(getNodewardenServerUrl()).resolves.toBe(NODEWARDEN_DEFAULT_URL)
  })

  it("uses newline-delimited URI input and unbiased password sampling", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/passwords/PasswordsSection.tsx"),
      "utf8"
    )
    expect(source).toContain('<TextAreaInput label="URIs"')
    expect(source).toContain('.split("\\n")')
    expect(source).toContain("maxValidByte")
    expect(source).toContain("if (byte >= maxValidByte) continue")
  })

  it("retries website autofill on dynamic forms and submits a single exact match", () => {
    const source = readFileSync(
      join(process.cwd(), "src/contents/password-autofill.ts"),
      "utf8"
    )
    expect(source).toContain("MutationObserver")
    expect(source).toContain("PASSWORDS_RETRY_AUTOFILL")
    expect(source).toContain("findSubmitButton")
    expect(source).toContain(".click()")
    expect(source).toContain("exactMatches.length !== 1")
    expect(source).toContain("sessionStorage.getItem(submitKey)")
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
