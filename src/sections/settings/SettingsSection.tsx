import { SettingsPanel } from "../../components/SettingsPanel"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useSidebarSync } from "../../hooks/useSidebarSync"
import { useEffect, useRef, useState } from "react"
import type { DopplerStatus, MCPServer, MCPStatus } from "../../types"

const SIDEBAR_API_SECRET_NAMES = ["SIDEBAR_API_URL", "SIDEBAR_API_TOKEN", "SIDEBAR_TOKEN"]
const ACTION_LOADING_DELAY_MS = 700
const ACTION_TIMEOUT_MS = 45_000

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
  const [pendingActions, setPendingActions] = useState<PendingActionState>({})
  const [loadingActions, setLoadingActions] = useState<PendingActionState>({})
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingActionsRef = useRef<PendingActionState>({})
  const loadingDelayTimers = useRef<Partial<Record<PendingAction, ReturnType<typeof setTimeout>>>>({})
  const pendingTimeoutTimers = useRef<Partial<Record<PendingAction, ReturnType<typeof setTimeout>>>>({})
  const sidebarSecretRequestRef = useRef<string | null>(null)
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
    pendingTimeoutTimers.current[action] = setTimeout(() => {
      clearPendingAction(action)
    }, ACTION_TIMEOUT_MS)
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
          showToast("Registered Brave Extension MCP server in ~/.claude.json.")
          break
        case "mcp.unregister":
          showToast("Unregistered from ~/.claude.json.")
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
          break
        case "doppler.secrets.download": {
          const secrets = msg.secrets || {}
          const sidebarApiUrl = secrets.SIDEBAR_API_URL?.trim()
          const sidebarApiToken = (secrets.SIDEBAR_API_TOKEN || secrets.SIDEBAR_TOKEN || "").trim()
          if (sidebarApiUrl || sidebarApiToken) {
            update({
              ...(sidebarApiUrl ? { sidebarApiUrl } : {}),
              ...(sidebarApiToken ? { sidebarApiToken } : {})
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
      nativeHost.mcpStatus()
      nativeHost.dopplerSetDefaults({
        project: settings.dopplerProject,
        config: settings.dopplerConfig,
        scope: settings.dopplerScope || "/"
      }, { silent: true })
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
    if (!settings || !nativeHost.connected || !dopplerStatus?.tokenSet || dopplerStatus.error) return
    if (settings.sidebarApiUrl && settings.sidebarApiToken) return
    const key = `${settings.dopplerProject}:${settings.dopplerConfig}:${settings.dopplerScope}`
    if (sidebarSecretRequestRef.current === key) return
    sidebarSecretRequestRef.current = key
    nativeHost.dopplerSecretsDownload({
      project: settings.dopplerProject || undefined,
      config: settings.dopplerConfig || undefined,
      scope: settings.dopplerScope || "/",
      secrets: SIDEBAR_API_SECRET_NAMES,
      silent: true
    })
  }, [
    settings?.sidebarApiUrl,
    settings?.sidebarApiToken,
    settings?.dopplerProject,
    settings?.dopplerConfig,
    settings?.dopplerScope,
    nativeHost.connected,
    dopplerStatus?.tokenSet,
    dopplerStatus?.error
  ])

  // Periodic refresh while panel is mounted (every 10s).
  useEffect(() => {
    if (!nativeHost.connected) return
    const t = setInterval(() => nativeHost.mcpStatus(), 10_000)
    return () => clearInterval(t)
  }, [nativeHost.connected])

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
      sidebarSync={sidebarSync}
      mcp={{
        status: mcpStatus,
        refresh: () => {
          beginPendingAction("mcp.refresh")
          nativeHost.mcpStatus()
        },
        rotateToken: () => {
          beginPendingAction("mcp.rotateToken")
          nativeHost.mcpRotateToken()
        },
        resetRegistration: () => {
          beginPendingAction("mcp.resetRegistration")
          nativeHost.mcpUnregister()
          // Re-register after a tick so unregister flushes first.
          setTimeout(() => nativeHost.mcpRegister(), 250)
        },
        setTerminalPath: (enabled: boolean) => {
          beginPendingAction("mcp.terminalPath")
          nativeHost.mcpSetTerminalPath(enabled)
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
