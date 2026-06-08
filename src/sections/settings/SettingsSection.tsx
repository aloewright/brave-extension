import { SettingsPanel } from "../../components/SettingsPanel"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useSidebarSync } from "../../hooks/useSidebarSync"
import { useEffect, useRef, useState } from "react"
import type { DopplerStatus, MCPServer, MCPStatus } from "../../types"
import { createAgentApiClient, type ToolSourceState } from "../../lib/agent-api"

const SIDEBAR_API_SECRET_NAMES = [
  "SIDEBAR_API_URL",
  "SIDEBAR_API_TOKEN",
  "SIDEBAR_TOKEN",
  "SIDEBAR_SERVICE_TOKEN",
  "X_SIDEBAR_TOKEN",
  "TASKS_API_TOKEN",
  "TASKS_TOKEN",
  "CAL_TASKS_API_TOKEN",
  "CAL_TASKS_TOKEN",
  "AGENT_API_URL",
  "AGENT_URL",
  "AGENT_ACCESS_CLIENT_ID",
  "AGENT_CLIENT_ID",
  "AGENT_ACCESS_CLIENT_SECRET",
  "AGENT_CLIENT_SECRET"
]

const SIDEBAR_TOKEN_SECRET_NAMES = [
  "SIDEBAR_API_TOKEN",
  "SIDEBAR_TOKEN",
  "SIDEBAR_SERVICE_TOKEN",
  "X_SIDEBAR_TOKEN"
]

const TASKS_TOKEN_SECRET_NAMES = [
  "TASKS_API_TOKEN",
  "TASKS_TOKEN",
  "CAL_TASKS_API_TOKEN",
  "CAL_TASKS_TOKEN"
]

const AGENT_API_URL_SECRET_NAMES = ["AGENT_API_URL", "AGENT_APIURL", "AGENT_URL"]

const AGENT_CLIENT_ID_SECRET_NAMES = ["AGENT_ACCESS_CLIENT_ID", "AGENT_CLIENT_ID"]

const AGENT_CLIENT_SECRET_SECRET_NAMES = [
  "AGENT_ACCESS_CLIENT_SECRET",
  "AGENT_CLIENT_SECRET"
]

function pickSecretValue(
  secrets: Record<string, string>,
  names: string[]
): string {
  const direct = names
    .map((name) => secrets[name])
    .find((value) => typeof value === "string" && value.trim().length > 0)
  if (direct) return direct.trim()

  const normalized = Object.entries(secrets).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.trim().toUpperCase()] = value
      return acc
    },
    {}
  )
  for (const name of names) {
    const hit = normalized[name.trim().toUpperCase()]
    if (typeof hit === "string" && hit.trim().length > 0) return hit.trim()
  }
  return ""
}

function syncDopplerDefaultsFromStatus(
  settings: { dopplerProject: string; dopplerConfig: string; dopplerScope: string },
  defaults?: { project?: string; config?: string; scope?: string }
): Partial<{ dopplerProject: string; dopplerConfig: string; dopplerScope: string }> | null {
  if (!defaults) return null
  const patch: Partial<{ dopplerProject: string; dopplerConfig: string; dopplerScope: string }> = {}
  if (!settings.dopplerProject.trim() && defaults.project?.trim()) {
    patch.dopplerProject = defaults.project.trim()
  }
  if (!settings.dopplerConfig.trim() && defaults.config?.trim()) {
    patch.dopplerConfig = defaults.config.trim()
  }
  if (!settings.dopplerScope.trim() && defaults.scope?.trim()) {
    patch.dopplerScope = defaults.scope.trim()
  }
  return Object.keys(patch).length > 0 ? patch : null
}
const ACTION_LOADING_DELAY_MS = 700
const ACTION_TIMEOUT_MS = 45_000
const DOPPLER_LOGIN_TIMEOUT_MS = 5 * 60_000

type PendingAction =
  | "mcp.rotateToken"
  | "mcp.resetRegistration"
  | "mcp.refresh"
  | "mcp.terminalPath"
  | "doppler.login"
  | "doppler.saveDefaults"
  | "doppler.refresh"

type PendingActionState = Partial<Record<PendingAction, boolean>>

export function SettingsSection() {
  const { settings, update } = useSettings()
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpStatus, setMcpStatus] = useState<MCPStatus | null>(null)
  const [dopplerStatus, setDopplerStatus] = useState<DopplerStatus | null>(null)
  const [agentToolStatus, setAgentToolStatus] = useState<ToolSourceState[]>([])
  const [pendingActions, setPendingActions] = useState<PendingActionState>({})
  const [loadingActions, setLoadingActions] = useState<PendingActionState>({})
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingActionsRef = useRef<PendingActionState>({})
  const loadingDelayTimers = useRef<Partial<Record<PendingAction, ReturnType<typeof setTimeout>>>>({})
  const pendingTimeoutTimers = useRef<Partial<Record<PendingAction, ReturnType<typeof setTimeout>>>>({})
  const showToast = (text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }
  const updatePendingAction = (action: PendingAction, pending: boolean) => {
    pendingActionsRef.current = { ...pendingActionsRef.current, [action]: pending }
    setPendingActions((prev) => ({ ...prev, [action]: pending }))
  }
  const clearPendingAction = (action: PendingAction) => {
    const loadingDelay = loadingDelayTimers.current[action]
    if (loadingDelay) clearTimeout(loadingDelay)
    const timeout = pendingTimeoutTimers.current[action]
    if (timeout) clearTimeout(timeout)
    delete loadingDelayTimers.current[action]
    delete pendingTimeoutTimers.current[action]
    updatePendingAction(action, false)
    setLoadingActions((prev) => ({ ...prev, [action]: false }))
  }
  const clearAllPendingActions = () => {
    for (const timer of Object.values(loadingDelayTimers.current)) {
      if (timer) clearTimeout(timer)
    }
    for (const timer of Object.values(pendingTimeoutTimers.current)) {
      if (timer) clearTimeout(timer)
    }
    loadingDelayTimers.current = {}
    pendingTimeoutTimers.current = {}
    pendingActionsRef.current = {}
    setPendingActions({})
    setLoadingActions({})
  }
  const beginPendingAction = (action: PendingAction) => {
    clearPendingAction(action)
    updatePendingAction(action, true)
    loadingDelayTimers.current[action] = setTimeout(() => {
      if (!pendingActionsRef.current[action]) return
      setLoadingActions((prev) => ({ ...prev, [action]: true }))
    }, ACTION_LOADING_DELAY_MS)
    const timeoutMs = action === "doppler.login" ? DOPPLER_LOGIN_TIMEOUT_MS : ACTION_TIMEOUT_MS
    pendingTimeoutTimers.current[action] = setTimeout(() => {
      clearPendingAction(action)
    }, timeoutMs)
  }
  const clearMcpPendingForType = (type: string, ok: boolean) => {
    if (type === "mcp.status") clearPendingAction("mcp.refresh")
    if (type === "mcp.rotate-token") clearPendingAction("mcp.rotateToken")
    if (type === "mcp.terminal-path.set") clearPendingAction("mcp.terminalPath")
    if (type === "mcp.register") clearPendingAction("mcp.resetRegistration")
    if (type === "mcp.unregister" && !ok) clearPendingAction("mcp.resetRegistration")
  }
  const clearDopplerPendingForType = (type: string) => {
    if (type === "doppler.status") clearPendingAction("doppler.refresh")
    if (type === "doppler.login") clearPendingAction("doppler.login")
    if (type === "doppler.defaults.set") clearPendingAction("doppler.saveDefaults")
  }

  const nativeHost = useNativeHost({
    onMcpList: (servers) => setMcpServers(servers as MCPServer[]),
    onMcpStatus: (s) => {
      setMcpStatus(s)
      clearMcpPendingForType("mcp.status", true)
    },
    onMcpRpcResult: (msg) => {
      clearMcpPendingForType(msg.type, msg.ok)
      if (!msg.ok) {
        showToast(`Error: ${msg.error || msg.type}`)
        return
      }
      switch (msg.type) {
        case "mcp.rotate-token":
          showToast("Token rotated; reconnect any external `claude` sessions.")
          break
        case "mcp.register":
        case "mcp.ensure":
          showToast(`Registered Brave Extension MCP server in ${msg.configPath || "~/.claude.json"}.`)
          break
        case "mcp.unregister":
          showToast(`Unregistered from ${msg.configPath || "~/.claude.json"}.`)
          break
        case "mcp.terminal-path.set":
          showToast(
            msg.enabled
              ? "Terminal path enabled. Restart your shell or `source ~/.zshrc`."
              : "Terminal path removed."
          )
          break
      }
    },
    onDopplerStatus: (s) => {
      setDopplerStatus(s)
      clearDopplerPendingForType("doppler.status")
      if (settings) {
        const patch = syncDopplerDefaultsFromStatus(settings, s.defaults)
        if (patch) update(patch)
      }
    },
    onDopplerRpcResult: (msg) => {
      clearDopplerPendingForType(msg.type)
      if (!msg.ok) {
        if (msg.silent) return
        showToast(`Doppler: ${msg.error || msg.type}`)
        return
      }
      switch (msg.type) {
        case "doppler.login":
          if (!msg.silent) showToast("Doppler login complete.")
          nativeHost.dopplerStatus()
          break
        case "doppler.defaults.set":
          if (!msg.silent) showToast("Doppler defaults saved.")
          if (settings && msg.defaults) {
            const patch = syncDopplerDefaultsFromStatus(settings, msg.defaults)
            if (patch) update(patch)
          }
          break
        case "doppler.secrets.download": {
          const secrets = msg.secrets || {}
          const sidebarApiUrl = pickSecretValue(secrets, ["SIDEBAR_API_URL"])
          const sidebarApiToken = pickSecretValue(secrets, SIDEBAR_TOKEN_SECRET_NAMES)
          const tasksApiToken =
            pickSecretValue(secrets, TASKS_TOKEN_SECRET_NAMES) || sidebarApiToken
          const agentApiUrl = pickSecretValue(secrets, AGENT_API_URL_SECRET_NAMES)
          const agentAccessClientId = pickSecretValue(secrets, AGENT_CLIENT_ID_SECRET_NAMES)
          const agentAccessClientSecret = pickSecretValue(
            secrets,
            AGENT_CLIENT_SECRET_SECRET_NAMES
          )
          if (
            sidebarApiUrl ||
            sidebarApiToken ||
            tasksApiToken ||
            agentApiUrl ||
            agentAccessClientId ||
            agentAccessClientSecret
          ) {
            update({
              ...(sidebarApiUrl ? { sidebarApiUrl } : {}),
              ...(sidebarApiToken ? { sidebarApiToken } : {}),
              ...(tasksApiToken ? { tasksApiToken } : {}),
              ...(agentApiUrl ? { agentApiUrl } : {}),
              ...(agentAccessClientId ? { agentAccessClientId } : {}),
              ...(agentAccessClientSecret ? { agentAccessClientSecret } : {})
            })
            if (!msg.silent) showToast("Sidebar API settings loaded from Doppler.")
          } else if (!msg.silent) {
            showToast("Doppler: sidebar API secrets not found.")
          }
          break
        }
      }
    }
  } as any)
  const sidebarSync = useSidebarSync({ settings, messages: [] })

  useEffect(() => {
    if (!nativeHost.connected) clearAllPendingActions()
  }, [nativeHost.connected])

  useEffect(() => {
    return () => {
      for (const timer of Object.values(loadingDelayTimers.current)) {
        if (timer) clearTimeout(timer)
      }
      for (const timer of Object.values(pendingTimeoutTimers.current)) {
        if (timer) clearTimeout(timer)
      }
    }
  }, [])

  useEffect(() => {
    if (settings && nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath)
      nativeHost.mcpEnsure(settings.claudeConfigPath)
      nativeHost.mcpStatus(settings.claudeConfigPath)
      const defaultsPayload: {
        project?: string
        config?: string
        scope?: string
      } = {}
      if (settings.dopplerProject.trim()) defaultsPayload.project = settings.dopplerProject.trim()
      if (settings.dopplerConfig.trim()) defaultsPayload.config = settings.dopplerConfig.trim()
      if (settings.dopplerScope.trim()) defaultsPayload.scope = settings.dopplerScope.trim()
      if (Object.keys(defaultsPayload).length > 0) {
        nativeHost.dopplerSetDefaults(defaultsPayload, { silent: true })
      }
      nativeHost.dopplerStatus()
    }
  }, [
    settings?.claudeConfigPath,
    settings?.dopplerProject,
    settings?.dopplerConfig,
    settings?.dopplerScope,
    nativeHost.connected
  ])

  useEffect(() => {
    if (!settings || !nativeHost.connected || !dopplerStatus?.tokenSet) return
    const sidebarReady =
      settings.sidebarApiUrl && settings.sidebarApiToken && settings.tasksApiToken
    const agentReady = settings.agentAccessClientId && settings.agentAccessClientSecret
    if (sidebarReady && agentReady) return
    nativeHost.dopplerSecretsDownload({
      project:
        settings.dopplerProject.trim() ||
        dopplerStatus?.defaults?.project?.trim() ||
        undefined,
      config:
        settings.dopplerConfig.trim() ||
        dopplerStatus?.defaults?.config?.trim() ||
        undefined,
      scope: settings.dopplerScope.trim() || dopplerStatus?.defaults?.scope || "/",
      secrets: SIDEBAR_API_SECRET_NAMES,
      silent: true
    })
  }, [
    settings?.agentApiUrl,
    settings?.agentAccessClientId,
    settings?.agentAccessClientSecret,
    settings?.sidebarApiUrl,
    settings?.sidebarApiToken,
    settings?.tasksApiToken,
    settings?.agentAccessClientId,
    settings?.agentAccessClientSecret,
    settings?.dopplerProject,
    settings?.dopplerConfig,
    settings?.dopplerScope,
    nativeHost.connected,
    dopplerStatus?.tokenSet,
    dopplerStatus?.error,
    dopplerStatus?.lastCheckedAt
  ])

  // Periodic refresh while panel is mounted (every 10s).
  useEffect(() => {
    if (!settings || !nativeHost.connected) return
    const t = setInterval(() => nativeHost.mcpStatus(settings.claudeConfigPath), 10_000)
    return () => clearInterval(t)
  }, [nativeHost.connected, settings?.claudeConfigPath])

  // Fetch cloud-agent tool reachability when the agent client is configured.
  useEffect(() => {
    if (
      !settings?.agentApiUrl ||
      !settings?.agentAccessClientId ||
      !settings?.agentAccessClientSecret
    ) {
      setAgentToolStatus([])
      return
    }
    let cancelled = false
    const client = createAgentApiClient({
      baseUrl: settings.agentApiUrl,
      clientId: settings.agentAccessClientId,
      clientSecret: settings.agentAccessClientSecret
    })
    client
      .getToolStatus()
      .then((sources) => {
        if (!cancelled) setAgentToolStatus(sources)
      })
      .catch(() => {
        if (!cancelled) setAgentToolStatus([])
      })
    return () => {
      cancelled = true
    }
  }, [
    settings?.agentApiUrl,
    settings?.agentAccessClientId,
    settings?.agentAccessClientSecret
  ])

  if (!settings) {
    return (
      <div className="flex items-center justify-center h-full text-fg/40 text-xs">
        Loading settings…
      </div>
    )
  }

  return (
    <SettingsPanel
      settings={settings}
      onUpdate={update}
      onClose={() => {}}
      nativeHost={nativeHost}
      mcpServers={mcpServers}
      agentToolStatus={agentToolStatus}
      sidebarSync={sidebarSync}
      mcp={{
        status: mcpStatus,
        refresh: () => {
          beginPendingAction("mcp.refresh")
          nativeHost.mcpStatus(settings.claudeConfigPath)
        },
        rotateToken: () => {
          beginPendingAction("mcp.rotateToken")
          nativeHost.mcpRotateToken(settings.claudeConfigPath)
        },
        resetRegistration: () => {
          beginPendingAction("mcp.resetRegistration")
          nativeHost.mcpUnregister(settings.claudeConfigPath)
          // Re-register after a tick so unregister flushes first.
          setTimeout(() => nativeHost.mcpRegister(settings.claudeConfigPath), 250)
        },
        setTerminalPath: (enabled: boolean) => {
          beginPendingAction("mcp.terminalPath")
          nativeHost.mcpSetTerminalPath(enabled, settings.claudeConfigPath)
        },
        pending: {
          refresh: !!pendingActions["mcp.refresh"],
          rotateToken: !!pendingActions["mcp.rotateToken"],
          resetRegistration: !!pendingActions["mcp.resetRegistration"],
          terminalPath: !!pendingActions["mcp.terminalPath"]
        },
        loading: {
          refresh: !!loadingActions["mcp.refresh"],
          rotateToken: !!loadingActions["mcp.rotateToken"],
          resetRegistration: !!loadingActions["mcp.resetRegistration"],
          terminalPath: !!loadingActions["mcp.terminalPath"]
        },
        toast
      }}
      doppler={{
        status: dopplerStatus,
        refresh: () => {
          beginPendingAction("doppler.refresh")
          nativeHost.dopplerStatus()
        },
        login: () => {
          beginPendingAction("doppler.login")
          nativeHost.dopplerLogin({
            scope: settings.dopplerScope || "/",
            overwrite: true
          })
        },
        saveDefaults: () => {
          beginPendingAction("doppler.saveDefaults")
          nativeHost.dopplerSetDefaults({
            project: settings.dopplerProject,
            config: settings.dopplerConfig,
            scope: settings.dopplerScope || "/"
          })
        },
        pending: {
          refresh: !!pendingActions["doppler.refresh"],
          login: !!pendingActions["doppler.login"],
          saveDefaults: !!pendingActions["doppler.saveDefaults"]
        },
        loading: {
          refresh: !!loadingActions["doppler.refresh"],
          login: !!loadingActions["doppler.login"],
          saveDefaults: !!loadingActions["doppler.saveDefaults"]
        },
        toast
      }}
    />
  )
}
