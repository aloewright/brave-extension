import { useState, useEffect } from "react"
import type { Settings, CLIBackend, MCPServer, MCPStatus } from "../types"
import { BACKEND_INFO } from "../types"

export function SettingsPanel({
  settings,
  onUpdate,
  onClose,
  nativeHost,
  mcpServers,
  cloudosSync,
  mcp
}: {
  settings: Settings
  onUpdate: (partial: Partial<Settings>) => void
  onClose: () => void
  nativeHost: {
    connected: boolean
    getMCPServers: (path?: string) => void
    addMCPServer: (server: any, path?: string) => void
  }
  mcpServers: MCPServer[]
  cloudosSync: { lastSyncAt: number | null; lastError: string | null; pending: boolean; flush: () => void }
  mcp?: {
    status: MCPStatus | null
    refresh: () => void
    rotateToken: () => void
    resetRegistration: () => void
    setTerminalPath: (enabled: boolean) => void
    toast: string | null
  }
}) {
  const [newServer, setNewServer] = useState({ name: "", command: "", args: "" })
  const [showAddMCP, setShowAddMCP] = useState(false)

  useEffect(() => {
    if (nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath)
    }
  }, [nativeHost.connected])

  const backends = Object.entries(BACKEND_INFO) as [CLIBackend, typeof BACKEND_INFO[CLIBackend]][]

  return (
    <div className="flex flex-col h-full bg-bg-alt">
      <div className="px-3 py-2 border-b border-border flex items-center">
        <span className="text-xs font-medium text-fg/80 flex-1">Settings</span>
        <button onClick={onClose} className="text-fg/40 hover:text-fg text-xs">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* CLI Backend */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">CLI Backend</label>
          <div className="grid grid-cols-2 gap-1.5">
            {backends.map(([key, info]) => (
              <button
                key={key}
                onClick={() => onUpdate({ backend: key })}
                className={`p-2 rounded text-left transition-all ${
                  settings.backend === key
                    ? "ring-1 ring-opacity-50 bg-opacity-10"
                    : "bg-card/30 hover:bg-card/50"
                }`}
                style={{
                  borderColor: settings.backend === key ? info.color : "transparent",
                  backgroundColor: settings.backend === key ? info.color + "15" : undefined,
                  ringColor: info.color
                }}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: info.color }} />
                  <span className="text-[11px] font-medium text-fg/80">{info.name}</span>
                </div>
                <div className="text-[9px] text-fg/30 mt-0.5 font-mono">{info.command}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Working Directory */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-1 block">
            Working Directory
          </label>
          <input
            type="text"
            value={settings.workingDirectory}
            onChange={(e) => onUpdate({ workingDirectory: e.target.value })}
            className="w-full text-xs py-1.5 px-2.5 rounded bg-input border border-border text-fg font-mono placeholder-fg/30 outline-none focus:border-primary/50"
            placeholder="~/Projects/my-app"
          />
        </div>

        {/* Claude Config Path */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-1 block">
            Claude Config Path
          </label>
          <input
            type="text"
            value={settings.claudeConfigPath}
            onChange={(e) => onUpdate({ claudeConfigPath: e.target.value })}
            className="w-full text-xs py-1.5 px-2.5 rounded bg-input border border-border text-fg font-mono placeholder-fg/30 outline-none focus:border-primary/50"
            placeholder="~/.claude.json"
          />
        </div>

        {/* MCP Servers */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-fg/50 uppercase tracking-wider">MCP Servers</label>
            <button
              onClick={() => setShowAddMCP(!showAddMCP)}
              className="text-[10px] text-primary hover:text-primary/80"
            >
              + Add
            </button>
          </div>

          {showAddMCP && (
            <div className="bg-card/30 rounded p-2 mb-2 space-y-1.5">
              <input
                type="text"
                value={newServer.name}
                onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Server name"
              />
              <input
                type="text"
                value={newServer.command}
                onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
                className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Command (e.g., npx -y @modelcontextprotocol/server-github)"
              />
              <input
                type="text"
                value={newServer.args}
                onChange={(e) => setNewServer({ ...newServer, args: e.target.value })}
                className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Args (comma-separated)"
              />
              <button
                onClick={() => {
                  if (newServer.name && newServer.command) {
                    nativeHost.addMCPServer(
                      {
                        name: newServer.name,
                        command: newServer.command,
                        args: newServer.args ? newServer.args.split(",").map((a) => a.trim()) : []
                      },
                      settings.claudeConfigPath
                    )
                    setNewServer({ name: "", command: "", args: "" })
                    setShowAddMCP(false)
                  }
                }}
                className="w-full text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
              >
                Add Server
              </button>
            </div>
          )}

          {mcpServers.length > 0 ? (
            <div className="space-y-1">
              {mcpServers.map((server) => {
                const isHttp = server.type === "http" || server.type === "sse" || !!server.url
                const statusColor =
                  server.status === "connected" ? "bg-success" :
                  server.status === "failed" ? "bg-error" :
                  server.status === "needs-auth" ? "bg-warning" :
                  server.status === "disconnected" ? "bg-fg/30" :
                  "bg-fg/20"
                const sourceLabel =
                  server.source === "claude-ai" ? "claude.ai" :
                  server.source === "plugin" ? "plugin" :
                  "local"
                return (
                  <div key={server.name} className="bg-card/20 rounded p-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`}
                        title={server.status || "unknown"}
                      />
                      <div className="text-[11px] text-fg/80 font-medium flex-1 truncate">{server.name}</div>
                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/40 text-fg/50">
                        {server.type || "stdio"}
                      </span>
                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/30 text-fg/40">
                        {sourceLabel}
                      </span>
                    </div>
                    <div className="text-[9px] text-fg/30 font-mono mt-0.5 break-all">
                      {isHttp ? server.url : `${server.command || ""} ${(server.args || []).join(" ")}`.trim()}
                    </div>
                    {server.status === "needs-auth" && (
                      <div className="text-[9px] text-warning/80 mt-1">
                        Run <span className="font-mono">claude</span> in a terminal and trigger a tool to authenticate.
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-[10px] text-fg/30 text-center py-2">
              {nativeHost.connected ? "No MCP servers configured" : "Connect native host to manage servers"}
            </div>
          )}
        </div>

        {/* MCP Server (this extension's own server) */}
        {mcp && (
          <div>
            <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
              ai-dev-sidebar MCP server
            </label>
            <div className="bg-card/20 rounded p-2 space-y-2">
              <StatusRow
                label="Server"
                ok={!!mcp.status?.port}
                detail={
                  mcp.status?.port
                    ? `127.0.0.1:${mcp.status.port} · ${mcp.status.sessions} session${mcp.status.sessions === 1 ? "" : "s"} · ${mcp.status.tools} tools`
                    : "not running"
                }
              />
              <StatusRow
                label="Registered in ~/.claude.json"
                ok={!!mcp.status?.registered}
                detail={mcp.status?.claudeJsonStatus || "unknown"}
              />
              <StatusRow
                label="Available in any terminal"
                ok={mcp.status?.terminalPathStatus === "enabled"}
                warn={mcp.status?.terminalPathStatus === "partial"}
                detail={mcp.status?.terminalPathStatus || "unknown"}
              />

              <Toggle
                label="Available in any terminal"
                description="Adds ~/.config/ai-dev-sidebar to PATH via ~/.zshrc / ~/.bashrc and drops a `claude` wrapper that loads the MCP token."
                checked={mcp.status?.terminalPathStatus === "enabled"}
                onChange={(v) => mcp.setTerminalPath(v)}
              />

              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={mcp.rotateToken}
                  className="flex-1 text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30"
                >
                  Rotate token
                </button>
                <button
                  onClick={mcp.resetRegistration}
                  className="flex-1 text-[10px] py-1 rounded bg-secondary/40 text-fg/80 hover:bg-secondary/60"
                >
                  Reset registration
                </button>
                <button
                  onClick={mcp.refresh}
                  className="text-[10px] py-1 px-2 rounded bg-secondary/30 text-fg/60 hover:bg-secondary/50"
                  title="Refresh status"
                >
                  ↻
                </button>
              </div>
              {mcp.toast && (
                <div className="text-[10px] text-success/90 pt-1">{mcp.toast}</div>
              )}
            </div>
          </div>
        )}

        {/* Tool gates + integrations */}
        <div>
          <label className="text-[11px] text-fg/50 uppercase tracking-wider mb-2 block">
            Tool gates
          </label>
          <div className="bg-card/20 rounded p-2 space-y-2">
            <Toggle
              label="Allow eval_js tool"
              description="Lets MCP clients run arbitrary JS in the active tab. Default OFF."
              checked={settings.allowEvalJs}
              onChange={(v) => onUpdate({ allowEvalJs: v })}
            />
            <Toggle
              label="Allow extensions_uninstall"
              description="Lets MCP clients uninstall other extensions via chrome.management. Default OFF."
              checked={settings.allowExtensionUninstall}
              onChange={(v) => onUpdate({ allowExtensionUninstall: v })}
            />
            <Toggle
              label="Cookies always-allow override"
              description="Skip per-call consent for cookie tools. Default OFF."
              checked={settings.cookiesAllowAll}
              onChange={(v) => onUpdate({ cookiesAllowAll: v })}
            />
            <div className="pt-1">
              <label className="text-[10px] text-fg/50 mb-1 block">Brave Search API key</label>
              <input
                type="password"
                value={settings.braveSearchApiKey}
                onChange={(e) => onUpdate({ braveSearchApiKey: e.target.value })}
                className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="brave_search_…"
              />
            </div>
          </div>
        </div>

        {/* CloudOS Sync */}
        <div className="space-y-2">
          <label className="text-[11px] text-fg/50 uppercase tracking-wider block">CloudOS Sync</label>
          <div className="bg-card/20 rounded p-2 space-y-2">
            <Toggle
              label="Sync conversations to CloudOS"
              description="Auto-saves chats to your notes worker (D1 + Vectorize embedding)"
              checked={settings.cloudosSyncEnabled}
              onChange={(v) => onUpdate({ cloudosSyncEnabled: v })}
            />
            {settings.cloudosSyncEnabled && (
              <>
                <input
                  type="text"
                  value={settings.cloudosNotesUrl}
                  onChange={(e) => onUpdate({ cloudosNotesUrl: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="https://notes.pdx.software/api/notes"
                />
                <input
                  type="password"
                  value={settings.cloudosServiceToken}
                  onChange={(e) => onUpdate({ cloudosServiceToken: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="X-CloudOS-Service-Token (optional)"
                />
                <Toggle
                  label="Prune local after sync"
                  description="Drop synced messages from chrome.storage to keep space low"
                  checked={settings.cloudosPruneAfterSync}
                  onChange={(v) => onUpdate({ cloudosPruneAfterSync: v })}
                />
                <div className="flex items-center justify-between text-[9px] pt-1">
                  <div className="text-fg/40">
                    {cloudosSync.pending
                      ? "Syncing…"
                      : cloudosSync.lastError
                      ? <span className="text-error">Error: {cloudosSync.lastError.slice(0, 60)}</span>
                      : cloudosSync.lastSyncAt
                      ? `Last sync: ${new Date(cloudosSync.lastSyncAt).toLocaleTimeString()}`
                      : "Not synced yet"}
                  </div>
                  <button
                    onClick={cloudosSync.flush}
                    className="text-primary hover:text-primary/80"
                  >
                    Sync now
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Toggles */}
        <div className="space-y-2">
          <label className="text-[11px] text-fg/50 uppercase tracking-wider block">Features</label>
          <Toggle
            label="Auto-scrape pages"
            description="Scrape page content when navigating"
            checked={settings.autoScrape}
            onChange={(v) => onUpdate({ autoScrape: v })}
          />
          <Toggle
            label="Capture console"
            description="Track console errors and warnings"
            checked={settings.captureConsole}
            onChange={(v) => onUpdate({ captureConsole: v })}
          />
          <Toggle
            label="Capture network"
            description="Track network requests"
            checked={settings.captureNetwork}
            onChange={(v) => onUpdate({ captureNetwork: v })}
          />
        </div>

        {/* Connection Status */}
        <div className="bg-card/20 rounded p-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${nativeHost.connected ? "bg-success" : "bg-error"}`} />
            <span className="text-[11px] text-fg/60">
              Native Host: {nativeHost.connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          {!nativeHost.connected && (
            <div className="text-[10px] text-fg/30 mt-2 font-mono">
              Run: npm run install-host
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusRow({
  label,
  ok,
  warn,
  detail
}: {
  label: string
  ok: boolean
  warn?: boolean
  detail: string
}) {
  const color = ok ? "bg-success" : warn ? "bg-warning" : "bg-fg/30"
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      <div className="text-[11px] text-fg/70 flex-1 truncate">{label}</div>
      <div className="text-[9px] text-fg/40 font-mono truncate max-w-[55%]">{detail}</div>
    </div>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="text-[11px] text-fg/70">{label}</div>
        <div className="text-[9px] text-fg/30">{description}</div>
      </div>
      <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onChange(!checked)}
          className="sr-only peer"
        />
        <div className="w-7 h-4 bg-secondary rounded-full peer peer-checked:bg-primary after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-fg after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-3" />
      </label>
    </div>
  )
}
