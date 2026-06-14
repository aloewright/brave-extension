import { Hono } from "hono"
import type { Env } from "../env"

const newtab = new Hono<{ Bindings: Env }>()

interface NewTabSnapshotBody {
  quickLinks?: unknown[]
  customApps?: unknown[]
  hiddenApps?: string[]
  appOrder?: string[]
  appIconOverrides?: Record<string, unknown>
}

interface NewTabSnapshotRow {
  id: "current"
  quick_links: string
  custom_apps: string
  hidden_apps: string
  app_order: string
  app_icon_overrides: string
  synced_at: number
}

newtab.post("/snapshot", async (c) => {
  const body = await c.req.json<NewTabSnapshotBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "snapshot body required" } }, 400)

  const now = Date.now()
  await c.env.DB.prepare(
    `INSERT INTO newtab_state_snapshots
      (id, quick_links, custom_apps, hidden_apps, app_order, app_icon_overrides, synced_at)
     VALUES ('current', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       quick_links = excluded.quick_links,
       custom_apps = excluded.custom_apps,
       hidden_apps = excluded.hidden_apps,
       app_order = excluded.app_order,
       app_icon_overrides = excluded.app_icon_overrides,
       synced_at = excluded.synced_at`
  )
    .bind(
      JSON.stringify(Array.isArray(body.quickLinks) ? body.quickLinks : []),
      JSON.stringify(Array.isArray(body.customApps) ? body.customApps : []),
      JSON.stringify(Array.isArray(body.hiddenApps) ? body.hiddenApps : []),
      JSON.stringify(Array.isArray(body.appOrder) ? body.appOrder : []),
      JSON.stringify(body.appIconOverrides && typeof body.appIconOverrides === "object" ? body.appIconOverrides : {}),
      now
    )
    .run()

  return c.json({ ok: true, syncedAt: now })
})

newtab.get("/snapshot", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT * FROM newtab_state_snapshots WHERE id = 'current'"
  ).first<NewTabSnapshotRow>()
  return c.json({ snapshot: row ? serializeRow(row) : null })
})

function serializeRow(row: NewTabSnapshotRow) {
  return {
    quickLinks: safeJson<unknown[]>(row.quick_links, []),
    customApps: safeJson<unknown[]>(row.custom_apps, []),
    hiddenApps: safeJson<string[]>(row.hidden_apps, []),
    appOrder: safeJson<string[]>(row.app_order, []),
    appIconOverrides: safeJson<Record<string, unknown>>(row.app_icon_overrides, {}),
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

export default newtab
