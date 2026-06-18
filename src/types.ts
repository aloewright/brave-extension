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
  type: "exec" | "exec-oneshot" | "exec-raw" | "stream" | "kill" | "cwd" | "config" | "mcp" | "reset-backend" | "session-status" | "system.snapshot" | "system.stop"
  command?: string
  args?: string[]
  cwd?: string
  pid?: number
  label?: string
  target?: SystemStopTarget
  backend?: CLIBackend
  data?: any
}

export interface NativeHostResponse {
  type: "stdout" | "stderr" | "exit" | "error" | "cwd" | "config" | "mcp" | "session-started" | "session-ended" | "session-reset" | "session-status" | "system.snapshot" | "system.stop"
  data: string
  pid?: number
  code?: number
  backend?: CLIBackend
  ok?: boolean
  snapshot?: SystemSnapshot
  error?: string
  label?: string
  target?: SystemStopTarget
}

export type SystemStopTarget = "server" | "daemon"

export interface SystemPortInfo {
  pid: number
  command: string
  address: string
  port: number
  protocol: "tcp"
  url?: string
}

export interface SystemServerInfo {
  pid: number
  command: string
  ports: SystemPortInfo[]
  urls: string[]
}

export interface SystemDaemonInfo {
  pid: number | null
  status: number | null
  label: string
  state: "running" | "loaded"
}

export interface SystemSnapshot {
  collectedAt: string
  ports: SystemPortInfo[]
  servers: SystemServerInfo[]
  daemons: SystemDaemonInfo[]
  errors?: string[]
}

import type { CaptureSaveLocation } from "./lib/capture-destination"

export interface GitHubFeatureSettings {
  /** Master switch. When false, the content script runs nothing. */
  enabled: boolean
  /** Per-feature on/off overrides keyed by feature id. Absent ⇒ registry default. */
  features: Record<string, boolean>
}

export type ThemeName = "dark" | "light" | "aurora" | "paper" | "ember" | "custom"
export type AppearanceDensity = "compact" | "comfortable" | "spacious"
export type AppearanceBackgroundStyle = "flat" | "glow" | "grain"
export type AppearanceColorKey =
  | "background"
  | "foreground"
  | "card"
  | "cardForeground"
  | "popover"
  | "popoverForeground"
  | "primary"
  | "primaryForeground"
  | "secondary"
  | "secondaryForeground"
  | "muted"
  | "mutedForeground"
  | "accent"
  | "accentForeground"
  | "destructive"
  | "destructiveForeground"
  | "border"
  | "input"
  | "sidebar"
  | "sidebarForeground"
  | "success"
  | "warning"
  | "error"
  | "info"

export interface AppearanceSettings {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  border: string
  input: string
  sidebar: string
  sidebarForeground: string
  success: string
  warning: string
  error: string
  info: string
  radius: number
  shadowOpacity: number
  fontScale: number
  fontFamily: string
  monoFontFamily: string
  density: AppearanceDensity
  backgroundStyle: AppearanceBackgroundStyle
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  background: "#3b3b3f",
  foreground: "#f1f1f1",
  card: "#4a4a4e",
  cardForeground: "#f1f1f1",
  popover: "#3b3b3f",
  popoverForeground: "#f1f1f1",
  primary: "#e1e3e6",
  primaryForeground: "#3b3b3f",
  secondary: "#505055",
  secondaryForeground: "#f1f1f1",
  muted: "#4a4a4e",
  mutedForeground: "#b0b0b5",
  accent: "#5a5a60",
  accentForeground: "#f1f1f1",
  destructive: "#9e5e5e",
  destructiveForeground: "#fceaea",
  border: "#505055",
  input: "#505055",
  sidebar: "#313135",
  sidebarForeground: "#f1f1f1",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#f87171",
  info: "#60a5fa",
  radius: 8,
  shadowOpacity: 0.3,
  fontScale: 1,
  fontFamily: '"Inter", system-ui, sans-serif',
  monoFontFamily: '"JetBrains Mono", "Fira Code", monospace',
  density: "comfortable",
  backgroundStyle: "flat"
}

export interface Settings {
  backend: CLIBackend
  workingDirectory: string
  claudeConfigPath: string
  autoScrape: boolean
  captureConsole: boolean
  captureNetwork: boolean
  theme: ThemeName
  appearance: AppearanceSettings
  // ALO-467 — capture (screenshot + full-page PDF) destination control.
  // "downloads" is the default for backwards compatibility with prior
  // releases; ALO-468 introduces "cloud" + cloudCapturesEnabled gating.
  captureSaveLocation: CaptureSaveLocation
  captureSubfolder: string
  cloudCapturesEnabled: boolean
  // Sidebar-api Worker sync (Phases 1–4). Replaces the cloudos integration.
  // The Worker owns /api/conversations, /api/links, /api/bookmarks/snapshot,
  // /api/recordings, /api/pdfs, /api/search; uploads also write embeddings
  // into a shared Vectorize index keyed by `${type}:${id}:${chunkIndex}`.
  sidebarSyncEnabled: boolean
  sidebarApiUrl: string
  sidebarApiToken: string
  // Optional dedicated token for cal.fly.pm task endpoints.
  // Falls back to sidebarApiToken when empty.
  tasksApiToken: string
  sidebarPruneAfterSync: boolean
  ttsModel: TtsModel
  ttsVoice: TtsVoice
  ttsCartesiaVoiceId: string
  // Kokoro (mlx-audio) runs as a local server reachable directly from this
  // machine; its voice + base URL are kept independent of the Worker-routed
  // models above. See offscreen.tsx for why Kokoro bypasses /api/tts.
  ttsKokoroVoice: string
  ttsKokoroBaseUrl: string
  ttsPlaybackRate: number
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosSyncEnabled: boolean
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosNotesUrl: string
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosServiceToken: string
  /** @deprecated since Phase 5 — kept for one release while users migrate. */
  cloudosPruneAfterSync: boolean
  // MCP / install gates (M7, ALO-251)
  allowEvalJs: boolean
  allowExtensionUninstall: boolean
  cookiesAllowAll: boolean
  browserAgentCloudPlanningEnabled: boolean
  browserAgentCloudVisionEnabled: boolean
  browserAgentCloudOcrEnabled: boolean
  hiddenRailSections: string[]
  railSectionOrder: string[]
  hideRailQuickActions: boolean
  passwordManagerProvider: PasswordManagerProvider
  passwordAppUrl: string
  signalEnabled: boolean
  signalProfileLabel: string
  signalBridgeRuntime: SignalBridgeRuntime
  signalLastStatus: SignalLastStatus
  braveSearchApiKey: string
  dopplerProject: string
  dopplerConfig: string
  dopplerScope: string
  // Phase 1 — Joplin clipper feature
  joplinToken: string
  // Agent App Worker (Cloudflare Access service token auth)
  agentApiUrl: string
  agentAccessClientId: string
  agentAccessClientSecret: string
  // Hindsight memory service creds (feed the Worker via Doppler later).
  hindsightUrl: string
  hindsightBearer: string
  hindsightAccessClientId: string
  hindsightAccessClientSecret: string
  github: GitHubFeatureSettings
}

export type TtsVoice = "hyperion" | "thalia" | "andromeda" | "helena" | "apollo"
export type TtsModel = "frontier-aura" | "dynamic-audio-gen" | "cartesia-sonic" | "kokoro-m4"
export type PasswordManagerProvider = "proton-pass" | "none" | "nodewarden-self-hosted"
export type SignalBridgeRuntime = "auto" | "podman" | "docker" | "disabled"
export type SignalLastStatus =
  | "missing-runtime"
  | "locked"
  | "linking"
  | "linked"
  | "starting"
  | "error"

/** Status reported by the native host's mcp.status RPC. */
export interface MCPStatus {
  port: number | null
  configPath?: string
  sessions: number
  registered: boolean
  claudeJsonStatus: "registered" | "missing"
  terminalPathStatus: "enabled" | "partial" | "disabled"
  hasRcBlock: boolean
  hasWrapper: boolean
  tokenSet: boolean
  tools: number
  resources: number
}

export interface DopplerStatus {
  cliAvailable: boolean
  cliVersion: string | null
  tokenSet: boolean
  tokenSource: "none" | "cli" | "env"
  tokenPreview: string | null
  workplaceName: string | null
  workplaceSlug: string | null
  authType: string | null
  tokenName: string | null
  defaults: {
    project: string
    config: string
    scope?: string
  }
  tokenScope?: string | null
  lastCheckedAt: string
  error: string | null
}

export const DEFAULT_SETTINGS: Settings = {
  backend: "claude",
  workingDirectory: "~",
  claudeConfigPath: "~/.claude.json",
  autoScrape: false,
  captureConsole: true,
  captureNetwork: false,
  theme: "dark",
  appearance: DEFAULT_APPEARANCE,
  captureSaveLocation: "downloads",
  captureSubfolder: "ai-dev-sidebar",
  cloudCapturesEnabled: false,
  // Enabled by default so saved links/highlights surface in the hub + search.
  // Still gated on sidebarApiUrl + sidebarApiToken being set, so nothing syncs
  // until the backend is configured (the token auto-loads from Doppler).
  sidebarSyncEnabled: false,
  sidebarApiUrl: "https://txt.fly.pm",
  sidebarApiToken: "",
  tasksApiToken: "",
  sidebarPruneAfterSync: false,
  ttsModel: "frontier-aura",
  ttsVoice: "hyperion",
  ttsCartesiaVoiceId: "694f9389-aac1-45b6-b726-9d9369183238",
  ttsKokoroVoice: "af_heart",
  ttsKokoroBaseUrl: "http://100.64.125.66:8082",
  ttsPlaybackRate: 1,
  cloudosSyncEnabled: false,
  cloudosNotesUrl: "https://notes.pdx.software/api/notes",
  cloudosServiceToken: "",
  cloudosPruneAfterSync: false,
  allowEvalJs: false,
  allowExtensionUninstall: false,
  cookiesAllowAll: false,
  browserAgentCloudPlanningEnabled: false,
  browserAgentCloudVisionEnabled: false,
  browserAgentCloudOcrEnabled: false,
  hiddenRailSections: [],
  railSectionOrder: [],
  hideRailQuickActions: false,
  passwordManagerProvider: "nodewarden-self-hosted",
  passwordAppUrl: "https://go.lazee.workers.dev",
  signalEnabled: false,
  signalProfileLabel: "Brave Dev Sidebar",
  signalBridgeRuntime: "auto",
  signalLastStatus: "locked",
  braveSearchApiKey: "",
  dopplerProject: "",
  dopplerConfig: "",
  dopplerScope: "/",
  joplinToken: "",
  agentApiUrl: "https://agent.fly.pm",
  agentAccessClientId: "",
  agentAccessClientSecret: "",
  hindsightUrl: "",
  hindsightBearer: "",
  hindsightAccessClientId: "",
  hindsightAccessClientSecret: "",
  github: { enabled: true, features: {} }
}

// ─── Design inspector types (folded in from Alexometer) ───────────────

export type ColorFormat = "hex" | "rgb" | "hsl" | "oklch"

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface BoxModel {
  margin: { top: number; right: number; bottom: number; left: number }
  border: { top: number; right: number; bottom: number; left: number }
  padding: { top: number; right: number; bottom: number; left: number }
  width: number
  height: number
}

export interface ElementSnapshot {
  tagName: string
  selector: string
  rect: { x: number; y: number; width: number; height: number }
  box: BoxModel
  computed: Record<string, string>
  colors: { kind: "color" | "background" | "border"; value: string }[]
  font: {
    family: string
    size: string
    weight: string
    lineHeight: string
    letterSpacing: string
    style: string
  }
  text?: string
  outerHTML: string
}

export interface ScannedAsset {
  type: "image" | "svg" | "lottie" | "video"
  url: string
  inlineSvg?: string
  alt?: string
  width?: number
  height?: number
}

export interface ScanResult {
  url: string
  title: string
  scannedAt: string
  colors: { value: string; count: number }[]
  fonts: { family: string; sizes: string[]; weights: string[]; count: number }[]
  spacing: { value: string; count: number }[]
  assets: ScannedAsset[]
}

export type TokenFormat = "tailwind" | "css" | "json"

export interface InspectorSettings {
  colorFormat: ColorFormat
  contrastTarget: "AA" | "AAA"
  exportDefaults: {
    tokenFormat: TokenFormat
    includeSpacing: boolean
    includeFonts: boolean
  }
}

export const DEFAULT_INSPECTOR_SETTINGS: InspectorSettings = {
  colorFormat: "hex",
  contrastTarget: "AA",
  exportDefaults: {
    tokenFormat: "tailwind",
    includeSpacing: true,
    includeFonts: true
  }
}

export type InspectorMessage =
  | { type: "inspector:start" }
  | { type: "inspector:stop" }
  | { type: "inspector:stopped" }
  | { type: "inspector:hover"; payload: ElementSnapshot }
  | { type: "inspector:pick"; payload: ElementSnapshot }
  | { type: "scan:run" }
  | { type: "scan:result"; payload: ScanResult }
  | { type: "asset:fetch"; url: string }
  | { type: "asset:fetched"; url: string; dataUrl: string | null }

export interface CachedScan {
  url: string
  result: ScanResult
  cachedAt: string
}

// ── Recorder (M6, ALO-248) ──────────────────────────────────────────────

export type RecorderSource = "tab" | "screen" | "camera"
export type RecordingMimeType = "video/mp4" | "video/quicktime"

export const RECORDER_MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1.64001F,mp4a.40.2",
  "video/mp4;codecs=h264,aac",
  "video/mp4;codecs=h264",
  "video/mp4",
  "video/quicktime;codecs=h264,aac",
  "video/quicktime"
] as const

export function normalizeRecordingMimeType(mimeType?: string | null): RecordingMimeType {
  const normalized = mimeType?.toLowerCase() ?? ""
  return normalized.includes("quicktime") || normalized.includes("mov")
    ? "video/quicktime"
    : "video/mp4"
}

export function isAllowedRecordingMimeType(mimeType?: string | null): boolean {
  const normalized = mimeType?.toLowerCase() ?? ""
  return (
    normalized === "" ||
    normalized.includes("mp4") ||
    normalized.includes("quicktime") ||
    normalized.includes("mov")
  )
}

export function recordingExtensionForMimeType(mimeType?: string | null): "mp4" | "mov" {
  return normalizeRecordingMimeType(mimeType) === "video/quicktime" ? "mov" : "mp4"
}

export interface RecordingMetadata {
  id: string
  source: RecorderSource
  durationMs: number
  sizeBytes: number
  mimeType: RecordingMimeType
  /** OS-side filename, e.g. "recording-2026-04-29T12-34-56.mp4". */
  filename: string
  /** Deterministic pre-AI filename, when cloud renaming changed the saved name. */
  originalFilename?: string
  /** ISO timestamp at stop. */
  createdAt: string
  /** Tab URL captured at start, only for source==="tab". */
  originUrl?: string
}

export const RECORDER_STORAGE_KEY = "recorder.recordings"

// ── Element picker (Reference capture) ──────────────────────────────────
// Separate from the Inspector. The picker captures a single element from
// the active tab and returns a Reference payload the Terminal section
// attaches to its prompt.

export interface ReferenceBoundingBox {
  x: number
  y: number
  w: number
  h: number
}

export interface PickerCapture {
  selector: string
  outerHTML: string
  textContent: string
  boundingBox: ReferenceBoundingBox
  // Device pixel ratio for the page at capture time. Background uses this
  // when cropping captureVisibleTab output.
  devicePixelRatio: number
}

export interface Reference {
  id: string
  tabId: number
  url: string
  title: string
  selector: string
  outerHTML: string
  textContent: string
  boundingBox: ReferenceBoundingBox
  screenshot: string
  createdAt: number
}

export type PickerMessage =
  | { type: "picker:start"; tabId?: number }
  | { type: "picker:cancel"; tabId?: number }
  | { type: "picker:cancelled" }
  | { type: "picker:captured"; payload: PickerCapture }

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
