export type CLIBackend = "claude" | "gemini" | "copilot" | "codex"

export interface CLIConfig {
  backend: CLIBackend
  workingDirectory: string
  claudeConfigPath?: string
  mcpServers?: MCPServer[]
}

export interface MCPServer {
  name: string
  type?: "stdio" | "http" | "sse"
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  status?: "connected" | "failed" | "needs-auth" | "disconnected" | "unknown"
  source?: "claude-ai" | "plugin" | "user-config"
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system" | "error" | "clear"
  content: string
  timestamp: number
  backend?: CLIBackend
  isStreaming?: boolean
}

export interface PageInspection {
  url: string
  title: string
  html?: string
  css?: CSSIssue[]
  errors?: ConsoleError[]
  network?: NetworkEntry[]
  meta?: Record<string, string>
  timestamp: number
}

export interface CSSIssue {
  selector: string
  property: string
  value: string
  issue: string
}

export interface ConsoleError {
  level: "error" | "warning" | "info" | "log"
  message: string
  source?: string
  line?: number
  timestamp: number
}

export interface NetworkEntry {
  url: string
  method: string
  status: number
  type: string
  size: number
  time: number
}

export interface ScrapeResult {
  url: string
  title: string
  text: string
  html: string
  links: { href: string; text: string }[]
  images: { src: string; alt: string }[]
  meta: Record<string, string>
  timestamp: number
}

export interface NativeHostMessage {
  type: "exec" | "exec-oneshot" | "exec-raw" | "stream" | "kill" | "cwd" | "config" | "mcp" | "reset-backend" | "session-status"
  command?: string
  args?: string[]
  cwd?: string
  pid?: number
  backend?: CLIBackend
  data?: any
}

export interface NativeHostResponse {
  type: "stdout" | "stderr" | "exit" | "error" | "cwd" | "config" | "mcp" | "session-started" | "session-ended" | "session-reset" | "session-status"
  data: string
  pid?: number
  code?: number
  backend?: CLIBackend
}

export interface Settings {
  backend: CLIBackend
  workingDirectory: string
  claudeConfigPath: string
  autoScrape: boolean
  captureConsole: boolean
  captureNetwork: boolean
  theme: "dark" | "light"
  // CloudOS sync — pushes conversations to the cloudos-notes worker
  // (auto-embeds into Vectorize for cross-cloudos semantic search)
  cloudosSyncEnabled: boolean
  cloudosNotesUrl: string
  cloudosServiceToken: string
  cloudosPruneAfterSync: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  backend: "claude",
  workingDirectory: "~",
  claudeConfigPath: "~/.claude.json",
  autoScrape: false,
  captureConsole: true,
  captureNetwork: false,
  theme: "dark",
  cloudosSyncEnabled: false,
  cloudosNotesUrl: "https://notes.pdx.software/api/notes",
  cloudosServiceToken: "",
  cloudosPruneAfterSync: false
}

export const BACKEND_INFO: Record<CLIBackend, { name: string; command: string; color: string; description: string }> = {
  claude: {
    name: "Claude Code",
    command: "claude",
    color: "#d97706",
    description: "Anthropic's CLI for Claude — full agentic coding"
  },
  gemini: {
    name: "Gemini CLI",
    command: "gemini",
    color: "#4285f4",
    description: "Google's Gemini CLI for code assistance"
  },
  copilot: {
    name: "GitHub Copilot",
    command: "gh copilot",
    color: "#6e40c9",
    description: "GitHub Copilot CLI for suggestions and explanations"
  },
  codex: {
    name: "Codex CLI",
    command: "codex",
    color: "#10b981",
    description: "OpenAI's Codex CLI for code generation"
  }
}
