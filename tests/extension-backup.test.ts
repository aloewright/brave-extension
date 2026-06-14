import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  backupInstalledExtension,
  listExtensionBackups
} from "../native-host/extension-backup.mjs"

const EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

describe("native extension backups", () => {
  let tmpDir: string
  let profileRoot: string
  let backupRoot: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "extension-backup-"))
    profileRoot = join(tmpDir, "Profile")
    backupRoot = join(tmpDir, "Backups")
    const extensionPackage = join(profileRoot, "Extensions", EXTENSION_ID, "1.0.0")
    mkdirSync(extensionPackage, { recursive: true })
    writeFileSync(
      join(extensionPackage, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name: "Archived", version: "1.0.0" })
    )
    writeFileSync(join(extensionPackage, "background.js"), "console.log('archived')")
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it("copies an installed package into a separate backup directory and lists it", () => {
    const result = backupInstalledExtension(
      {
        id: EXTENSION_ID,
        name: "Archived",
        version: "1.0.0",
        installType: "normal"
      },
      {
        roots: [{ browser: "Test", root: profileRoot }],
        backupRoot
      }
    )

    expect(result).toMatchObject({
      backedUp: true,
      found: true,
      browser: "Test",
      profile: "Profile"
    })
    expect(existsSync(join(result.path, "manifest.json"))).toBe(true)
    expect(existsSync(result.metadataPath)).toBe(true)

    const listed = listExtensionBackups({ backupRoot })
    expect(listed.backups).toHaveLength(1)
    expect(listed.backups[0]).toMatchObject({
      id: EXTENSION_ID,
      version: "1.0.0",
      path: result.path
    })
    expect(listed.backups[0]?.metadata?.name).toBe("Archived")
  })

  it("does not overwrite an existing backup unless forced", () => {
    const first = backupInstalledExtension(
      { id: EXTENSION_ID, name: "Archived", version: "1.0.0" },
      { roots: [{ browser: "Test", root: profileRoot }], backupRoot }
    )
    const second = backupInstalledExtension(
      { id: EXTENSION_ID, name: "Archived", version: "1.0.0" },
      { roots: [{ browser: "Test", root: profileRoot }], backupRoot }
    )

    expect(first.backedUp).toBe(true)
    expect(second).toMatchObject({ backedUp: false, exists: true, path: first.path })
  })
})
