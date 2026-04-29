import { SettingsPanel } from "../../components/SettingsPanel"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useCloudosSync } from "../../hooks/useCloudosSync"
import { useEffect, useRef, useState } from "react"
import type { MCPServer, MCPStatus } from "../../types"

export function SettingsSection() {
  const { settings, update } = useSettings()
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [mcpStatus, setMcpStatus] = useState<MCPStatus | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  const nativeHost = useNativeHost({
    onMcpList: (servers) => setMcpServers(servers as MCPServer[]),
    onMcpStatus: (s) => setMcpStatus(s),
    onMcpRpcResult: (msg) => {
      if (!msg.ok) {
        showToast(`Error: ${msg.error || msg.type}`)
        return
      }
      switch (msg.type) {
        case "mcp.rotate-token":
          showToast("Token rotated; reconnect any external `claude` sessions.")
          break
        case "mcp.register":
          showToast("Registered ai-dev-sidebar in ~/.claude.json.")
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
    }
  } as any)
  const cloudosSync = useCloudosSync({ settings, messages: [] })

  useEffect(() => {
    if (settings && nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath)
      nativeHost.mcpStatus()
    }
  }, [settings?.claudeConfigPath, nativeHost.connected])

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
      cloudosSync={cloudosSync}
      mcp={{
        status: mcpStatus,
        refresh: () => nativeHost.mcpStatus(),
        rotateToken: () => nativeHost.mcpRotateToken(),
        resetRegistration: () => {
          nativeHost.mcpUnregister()
          // Re-register after a tick so unregister flushes first.
          setTimeout(() => nativeHost.mcpRegister(), 250)
        },
        setTerminalPath: (enabled: boolean) => nativeHost.mcpSetTerminalPath(enabled),
        toast
      }}
    />
  )
}
