import { SettingsPanel } from "../../components/SettingsPanel"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { useCloudosSync } from "../../hooks/useCloudosSync"
import { useEffect, useState } from "react"
import type { MCPServer } from "../../types"

export function SettingsSection() {
  const { settings, update } = useSettings()
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const nativeHost = useNativeHost({
    onMcpList: (servers) => setMcpServers(servers as MCPServer[])
  } as any)
  const cloudosSync = useCloudosSync({ settings, messages: [] })

  useEffect(() => {
    if (settings && nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath)
    }
  }, [settings?.claudeConfigPath, nativeHost.connected])

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
    />
  )
}
