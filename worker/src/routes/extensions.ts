import { Hono } from "hono"
import type { Env } from "../env"

const extensions = new Hono<{ Bindings: Env }>()

interface IncomingExtension {
  id?: string
  name?: string
  enabled?: boolean
  type?: string
  version?: string
  description?: string
  installType?: string | null
  homepageUrl?: string | null
  mayDisable?: boolean
  icons?: unknown[]
}

interface SnapshotBody {
  extensions?: IncomingExtension[]
  profiles?: unknown[]
  groups?: unknown[]
  settings?: Record<string, unknown>
  lastUsed?: Record<string, string>
  pulledAt?: string
}

interface ExtensionRow {
  extension_id: string
  name: string
  enabled: number
  type: string
  version: string
  description: string
  install_type: string | null
  homepage_url: string | null
  may_disable: number
  icons: string
  synced_at: number
}

interface ExtensionConfigRow {
  id: "current"
  profiles: string
  groups: string
  settings: string
  last_used: string
  pulled_at: string | null
  synced_at: number
}

extensions.post("/snapshot", async (c) => {
  const body = await c.req.json<SnapshotBody>().catch(() => null)
  if (!body || !Array.isArray(body.extensions)) {
    return c.json({ error: { code: "bad_request", message: "extensions[] required" } }, 400)
  }

  for (const item of body.extensions) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string") {
      return c.json({ error: { code: "bad_request", message: "each extension needs {id, name}" } }, 400)
    }
  }

  const now = Date.now()
  const incomingIds = new Set(body.extensions.map((item) => item.id as string))
  const existing = await listRows(c.env)
  let inserted = 0
  let updated = 0
  let deleted = 0

  for (const item of body.extensions) {
    const exists = existing.some((row) => row.extension_id === item.id)
    await c.env.DB.prepare(
      `INSERT INTO extension_snapshots
        (extension_id, name, enabled, type, version, description, install_type,
         homepage_url, may_disable, icons, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(extension_id) DO UPDATE SET
         name = excluded.name,
         enabled = excluded.enabled,
         type = excluded.type,
         version = excluded.version,
         description = excluded.description,
         install_type = excluded.install_type,
         homepage_url = excluded.homepage_url,
         may_disable = excluded.may_disable,
         icons = excluded.icons,
         synced_at = excluded.synced_at`
    )
      .bind(
        item.id,
        item.name,
        item.enabled ? 1 : 0,
        item.type || "extension",
        item.version || "",
        item.description || "",
        item.installType ?? null,
        item.homepageUrl ?? null,
        item.mayDisable ? 1 : 0,
        JSON.stringify(Array.isArray(item.icons) ? item.icons : []),
        now
      )
      .run()
    if (exists) updated++
    else inserted++
  }

  for (const row of existing) {
    if (!incomingIds.has(row.extension_id)) {
      await c.env.DB.prepare("DELETE FROM extension_snapshots WHERE extension_id = ?")
        .bind(row.extension_id)
        .run()
      deleted++
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO extension_config_snapshots
      (id, profiles, groups, settings, last_used, pulled_at, synced_at)
     VALUES ('current', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       profiles = excluded.profiles,
       groups = excluded.groups,
       settings = excluded.settings,
       last_used = excluded.last_used,
       pulled_at = excluded.pulled_at,
       synced_at = excluded.synced_at`
  )
    .bind(
      JSON.stringify(body.profiles ?? []),
      JSON.stringify(body.groups ?? []),
      JSON.stringify(body.settings ?? {}),
      JSON.stringify(body.lastUsed ?? {}),
      body.pulledAt ?? null,
      now
    )
    .run()

  return c.json({
    pulledAt: body.pulledAt ?? null,
    upserted: inserted + updated,
    inserted,
    updated,
    deleted
  })
})

extensions.get("/", async (c) => {
  const [rows, config] = await Promise.all([listRows(c.env), getConfig(c.env)])
  return c.json({
    extensions: rows.map(serializeRow),
    config: config ? serializeConfig(config) : null
  })
})

async function listRows(env: Env): Promise<ExtensionRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM extension_snapshots ORDER BY enabled DESC, name ASC"
  ).all<ExtensionRow>()
  return results ?? []
}

async function getConfig(env: Env): Promise<ExtensionConfigRow | null> {
  return (await env.DB.prepare(
    "SELECT * FROM extension_config_snapshots WHERE id = 'current'"
  ).first<ExtensionConfigRow>()) ?? null
}

function serializeRow(row: ExtensionRow) {
  return {
    id: row.extension_id,
    name: row.name,
    enabled: row.enabled === 1,
    type: row.type,
    version: row.version,
    description: row.description,
    installType: row.install_type,
    homepageUrl: row.homepage_url,
    mayDisable: row.may_disable === 1,
    icons: safeJson<unknown[]>(row.icons, []),
    syncedAt: row.synced_at
  }
}

function serializeConfig(row: ExtensionConfigRow) {
  return {
    profiles: safeJson<unknown[]>(row.profiles, []),
    groups: safeJson<unknown[]>(row.groups, []),
    settings: safeJson<Record<string, unknown>>(row.settings, {}),
    lastUsed: safeJson<Record<string, string>>(row.last_used, {}),
    pulledAt: row.pulled_at,
    syncedAt: row.synced_at
  }
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export default extensions
