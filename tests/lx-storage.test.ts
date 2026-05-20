/// <reference types="chrome" />
import { describe, expect, it, vi } from "vitest"

import { getSettings, setSettings } from "../src/sections/_lx/storage"

describe("_lx storage compatibility", () => {
  it("reads object-shaped settings already stored in chrome.storage.local", async () => {
    await chrome.storage.local.set({
      lx_settings: {
        notebookMode: "new",
        alwaysEnabled: ["a"],
        leanExtensionIds: ["b"],
        browserHomeEnabled: true
      }
    })

    await expect(getSettings()).resolves.toMatchObject({
      notebookMode: "new",
      alwaysEnabled: ["a"],
      leanExtensionIds: ["b"],
      browserHomeEnabled: true
    })
  })

  it("ignores invalid serialized settings without logging parse errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    await chrome.storage.local.set({ lx_settings: "[object Object]" })

    await expect(getSettings()).resolves.toMatchObject({
      notebookMode: "append",
      alwaysEnabled: [],
      leanExtensionIds: []
    })
    expect(errorSpy).not.toHaveBeenCalled()

    errorSpy.mockRestore()
  })

  it("keeps new writes in Plasmo's serialized storage format", async () => {
    await setSettings({
      notebookMode: "new",
      alwaysEnabled: [],
      leanExtensionIds: [],
      browserHomeEnabled: false
    })

    const stored = await chrome.storage.local.get("lx_settings")
    expect(typeof stored.lx_settings).toBe("string")
    expect(JSON.parse(stored.lx_settings as string)).toMatchObject({
      notebookMode: "new"
    })
  })
})
