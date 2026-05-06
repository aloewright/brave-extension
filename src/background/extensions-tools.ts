/**
 * Extensions MCP tool handlers (ALO-247, M5).
 *
 * Wraps chrome.management plus the existing _lx profile / group storage so
 * AI tooling can flip the same toggles a user would in the sidebar.
 *
 * `extensions_uninstall` is gated behind
 * chrome.storage.local["settings.allowExtensionUninstall"], mirroring
 * eval_js — the action is irreversible and we don't want LLMs nuking
 * extensions by accident.
 *
 * Profile shape (from src/sections/_lx/types.ts):
 *   Profile { id, name, extensionIds: string[] }
 *   Group   { id, name, extensionIds: string[], enabled: boolean }
 *
 * `profiles_apply` enables every id in `extensionIds` and disables every
 * other (user-disable-able, non-themes) extension. `groups_apply` only
 * touches the group's listed ids — flipping them to `group.enabled`.
 */

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export const UNINSTALL_GATE_KEY = "settings.allowExtensionUninstall"
export const PROFILES_KEY = "lx_profiles"
export const GROUPS_KEY = "lx_groups"

interface StoredProfile {
  id: string
  name: string
  extensionIds: string[]
}
interface StoredGroup {
  id: string
  name: string
  extensionIds: string[]
  enabled: boolean
}

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}
function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

async function extensions_list(): Promise<ToolResult> {
  try {
    const all = await chrome.management.getAll()
    const shaped = all.map((e) => ({
      id: e.id,
      name: e.name,
      enabled: e.enabled,
      type: e.type,
      version: e.version,
      description: e.description ?? ""
    }))
    return ok(JSON.stringify(shaped, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function extensions_set_enabled(args: any): Promise<ToolResult> {
  const id = String(args?.id ?? "")
  if (!id) return err("id required")
  if (typeof args?.enabled !== "boolean") return err("enabled required (boolean)")
  try {
    await chrome.management.setEnabled(id, args.enabled)
    return ok(JSON.stringify({ id, enabled: args.enabled }))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function extensions_uninstall(args: any): Promise<ToolResult> {
  const gate = await chrome.storage.local.get(UNINSTALL_GATE_KEY)
  if (!gate?.[UNINSTALL_GATE_KEY]) {
    return err("extensions_uninstall disabled in Settings")
  }
  const id = String(args?.id ?? "")
  if (!id) return err("id required")
  try {
    await chrome.management.uninstall(id, { showConfirmDialog: true })
    return ok(JSON.stringify({ uninstalled: id }))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function readJson<T>(key: string): Promise<T[]> {
  const r = await chrome.storage.local.get(key)
  const v = r?.[key]
  return Array.isArray(v) ? (v as T[]) : []
}

async function profiles_apply(args: any): Promise<ToolResult> {
  const profileId = String(args?.profileId ?? "")
  if (!profileId) return err("profileId required")
  try {
    const profiles = await readJson<StoredProfile>(PROFILES_KEY)
    const profile = profiles.find((p) => p.id === profileId)
    if (!profile) return err(`no profile ${profileId}`)
    const allow = new Set(profile.extensionIds || [])

    const all = await chrome.management.getAll()
    const changes: Array<{ id: string; enabled: boolean }> = []
    for (const e of all) {
      // Skip themes, self-extension, and anything Chrome won't let us toggle.
      // mayDisable=false applies regardless of allow-set membership: even if
      // a profile lists a policy-locked extension we still cannot flip it.
      if (e.type === "theme") continue
      if (e.id === chrome.runtime?.id) continue
      if (!e.mayDisable) continue
      const target = allow.has(e.id)
      if (e.enabled === target) continue
      try {
        await chrome.management.setEnabled(e.id, target)
        changes.push({ id: e.id, enabled: target })
      } catch {
        /* best effort */
      }
    }
    return ok(
      JSON.stringify(
        { applied: profile.id, name: profile.name, changes },
        null,
        2
      )
    )
  } catch (e) {
    return err((e as Error).message)
  }
}

async function groups_apply(args: any): Promise<ToolResult> {
  const groupId = String(args?.groupId ?? "")
  if (!groupId) return err("groupId required")
  try {
    const groups = await readJson<StoredGroup>(GROUPS_KEY)
    const group = groups.find((g) => g.id === groupId)
    if (!group) return err(`no group ${groupId}`)
    const target = !!group.enabled
    const ids = Array.isArray(group.extensionIds) ? group.extensionIds : []
    const changes: Array<{ id: string; enabled: boolean }> = []
    for (const id of ids) {
      try {
        await chrome.management.setEnabled(id, target)
        changes.push({ id, enabled: target })
      } catch {
        /* best effort */
      }
    }
    return ok(
      JSON.stringify(
        { applied: group.id, name: group.name, target, changes },
        null,
        2
      )
    )
  } catch (e) {
    return err((e as Error).message)
  }
}

async function profiles_list(): Promise<ToolResult> {
  try {
    const profiles = await readJson<StoredProfile>(PROFILES_KEY)
    const shaped = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      extensionIds: Array.isArray(p.extensionIds) ? p.extensionIds : []
    }))
    return ok(JSON.stringify(shaped, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function groups_list(): Promise<ToolResult> {
  try {
    const groups = await readJson<StoredGroup>(GROUPS_KEY)
    const shaped = groups.map((g) => ({
      id: g.id,
      name: g.name,
      extensionIds: Array.isArray(g.extensionIds) ? g.extensionIds : [],
      enabled: !!g.enabled
    }))
    return ok(JSON.stringify(shaped, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

export const EXTENSIONS_TOOL_HANDLERS: Record<
  string,
  (args: any) => Promise<ToolResult>
> = {
  extensions_list,
  extensions_set_enabled,
  extensions_uninstall,
  profiles_list,
  profiles_apply,
  groups_list,
  groups_apply
}
