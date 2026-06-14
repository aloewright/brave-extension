import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "fs"
import { homedir } from "os"
import { basename, dirname, join } from "path"

export const DEFAULT_EXTENSION_BACKUP_ROOT = join(
  homedir(),
  ".ai-dev-sidebar",
  "extension-backups"
)

export function extensionSearchRoots() {
  const home = homedir()
  if (process.platform === "darwin") {
    const appSupport = join(home, "Library", "Application Support")
    return [
      { browser: "Brave", root: join(appSupport, "BraveSoftware", "Brave-Browser") },
      { browser: "Chrome", root: join(appSupport, "Google", "Chrome") },
      { browser: "Chromium", root: join(appSupport, "Chromium") },
      { browser: "Edge", root: join(appSupport, "Microsoft Edge") },
      { browser: "Arc", root: join(appSupport, "Arc", "User Data") }
    ]
  }

  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local")
    return [
      { browser: "Brave", root: join(local, "BraveSoftware", "Brave-Browser", "User Data") },
      { browser: "Chrome", root: join(local, "Google", "Chrome", "User Data") },
      { browser: "Chromium", root: join(local, "Chromium", "User Data") },
      { browser: "Edge", root: join(local, "Microsoft", "Edge", "User Data") }
    ]
  }

  return [
    { browser: "Brave", root: join(home, ".config", "BraveSoftware", "Brave-Browser") },
    { browser: "Chrome", root: join(home, ".config", "google-chrome") },
    { browser: "Chromium", root: join(home, ".config", "chromium") },
    { browser: "Edge", root: join(home, ".config", "microsoft-edge") }
  ]
}

export function backupInstalledExtension(extension, options = {}) {
  const id = sanitizeSegment(extension?.id)
  if (!id) throw new Error("extension id is required")

  const version = sanitizeSegment(extension?.version || "unknown") || "unknown"
  const roots = normalizeRoots(options.roots ?? extensionSearchRoots())
  const source = findInstalledExtensionSource(id, extension?.version, roots)
  const backupRoot =
    options.backupRoot ||
    process.env.AI_DEV_SIDEBAR_EXTENSION_BACKUP_PATH ||
    DEFAULT_EXTENSION_BACKUP_ROOT
  const versionDir = join(backupRoot, id, version)
  const packagePath = join(versionDir, "package")
  const metadataPath = join(versionDir, "metadata.json")

  if (!source) {
    return {
      backedUp: false,
      exists: false,
      found: false,
      id,
      version,
      path: packagePath,
      metadataPath,
      searchedRoots: roots.map((entry) => entry.root)
    }
  }

  if (!options.force && isExtensionPackageDir(packagePath)) {
    ensureMetadata(metadataPath, extension, source, packagePath)
    return {
      backedUp: false,
      exists: true,
      found: true,
      id,
      version,
      path: packagePath,
      metadataPath,
      sourcePath: source.path,
      browser: source.browser,
      profile: source.profile
    }
  }

  mkdirSync(versionDir, { recursive: true })
  const tmpPath = join(versionDir, `.package-${process.pid}-${Date.now()}.tmp`)
  rmSync(tmpPath, { recursive: true, force: true })
  cpSync(source.path, tmpPath, { recursive: true, dereference: false })
  if (!isExtensionPackageDir(tmpPath)) {
    rmSync(tmpPath, { recursive: true, force: true })
    throw new Error(`copied extension package is missing manifest.json: ${source.path}`)
  }
  rmSync(packagePath, { recursive: true, force: true })
  renameSync(tmpPath, packagePath)
  writeMetadata(metadataPath, extension, source, packagePath)

  return {
    backedUp: true,
    exists: false,
    found: true,
    id,
    version,
    path: packagePath,
    metadataPath,
    sourcePath: source.path,
    browser: source.browser,
    profile: source.profile
  }
}

export function listExtensionBackups(options = {}) {
  const backupRoot =
    options.backupRoot ||
    process.env.AI_DEV_SIDEBAR_EXTENSION_BACKUP_PATH ||
    DEFAULT_EXTENSION_BACKUP_ROOT
  const backups = []

  for (const idEntry of safeReadDir(backupRoot)) {
    if (!idEntry.isDirectory()) continue
    const id = idEntry.name
    const idPath = join(backupRoot, id)
    for (const versionEntry of safeReadDir(idPath)) {
      if (!versionEntry.isDirectory()) continue
      const version = versionEntry.name
      const versionPath = join(idPath, version)
      const packagePath = join(versionPath, "package")
      if (!isExtensionPackageDir(packagePath)) continue
      const metadataPath = join(versionPath, "metadata.json")
      backups.push({
        id,
        version,
        path: packagePath,
        metadataPath,
        metadata: readJsonFile(metadataPath, null)
      })
    }
  }

  backups.sort((a, b) => {
    const nameA = String(a.metadata?.name || a.id)
    const nameB = String(b.metadata?.name || b.id)
    return nameA.localeCompare(nameB) || a.version.localeCompare(b.version, undefined, { numeric: true })
  })

  return { backupRoot, backups }
}

function normalizeRoots(roots) {
  return roots
    .map((entry) => {
      if (typeof entry === "string") return { browser: "unknown", root: entry }
      return { browser: entry.browser || "unknown", root: entry.root }
    })
    .filter((entry) => typeof entry.root === "string" && entry.root.length > 0)
}

function findInstalledExtensionSource(id, version, roots) {
  for (const entry of roots) {
    if (!existsSync(entry.root)) continue
    for (const profile of profileCandidates(entry.root)) {
      const extensionRoot = join(profile.dir, "Extensions", id)
      if (!existsSync(extensionRoot)) continue
      const match = findVersionDir(extensionRoot, version)
      if (match) {
        return {
          browser: entry.browser,
          profile: profile.name,
          path: match,
          version: basename(match)
        }
      }
    }
  }
  return null
}

function profileCandidates(root) {
  const candidates = [{ name: basename(root), dir: root }]
  for (const entry of safeReadDir(root)) {
    if (!entry.isDirectory()) continue
    candidates.push({ name: entry.name, dir: join(root, entry.name) })
  }
  return candidates
}

function findVersionDir(extensionRoot, requestedVersion) {
  const exact = requestedVersion ? join(extensionRoot, requestedVersion) : null
  if (exact && isExtensionPackageDir(exact)) return exact

  return safeReadDir(extensionRoot)
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(extensionRoot, entry.name))
    .filter(isExtensionPackageDir)
    .sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }))
    .at(-1) ?? null
}

function isExtensionPackageDir(path) {
  try {
    return statSync(path).isDirectory() && existsSync(join(path, "manifest.json"))
  } catch {
    return false
  }
}

function safeReadDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

function ensureMetadata(metadataPath, extension, source, packagePath) {
  if (existsSync(metadataPath)) return
  writeMetadata(metadataPath, extension, source, packagePath)
}

function writeMetadata(metadataPath, extension, source, packagePath) {
  mkdirSync(dirname(metadataPath), { recursive: true })
  writeFileSync(
    metadataPath,
    JSON.stringify(
      {
        id: extension?.id,
        name: extension?.name,
        version: extension?.version,
        installType: extension?.installType,
        homepageUrl: extension?.homepageUrl,
        description: extension?.description,
        backedUpAt: new Date().toISOString(),
        source: {
          browser: source.browser,
          profile: source.profile,
          path: source.path,
          version: source.version
        },
        packagePath,
        manifest: readManifestSummary(packagePath)
      },
      null,
      2
    )
  )
}

function readManifestSummary(packagePath) {
  try {
    const parsed = readJsonFile(join(packagePath, "manifest.json"), null)
    return {
      manifest_version: parsed?.manifest_version,
      name: parsed?.name,
      version: parsed?.version,
      version_name: parsed?.version_name
    }
  } catch {
    return null
  }
}

function readJsonFile(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return fallback
  }
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 128)
}
