import { useState, useEffect, type ReactNode } from "react";
import type {
  AppearanceColorKey,
  AppearanceSettings,
  Settings,
  DopplerStatus,
  MCPServer,
  MCPStatus,
  PasswordManagerProvider,
  TtsVoice,
  ThemeName,
} from "../types";
import type { ToolSourceState } from "../lib/agent-api";
import { ping } from "../lib/joplin";
import {
  checkPasswordAppStatus,
  getLegacyPasswordStorageState,
  PASSWORD_STRATEGY,
  purgeLegacyPasswordStorage,
  type PasswordAppStatus,
} from "../lib/password-strategy";
import { normalizeRailSectionOrder } from "../lib/rail-order";
import {
  APPEARANCE_COLOR_FIELDS,
  APPEARANCE_PRESETS,
  cloneAppearance,
  createCustomAppearance,
  normalizeHexColor,
  resolveAppearanceSettings,
} from "../lib/appearance";
import {
  DEFAULT_CAPTURE_SUBFOLDER,
  sanitizeSubfolder,
  type CaptureSaveLocation,
} from "../lib/capture-destination";
import { getAutoPipEnabled, setAutoPipEnabled } from "../lib/pip/auto";
import { SECTIONS } from "../sections/types";

interface CartesiaVoiceOption {
  id: string;
  name: string;
  description?: string | null;
}

const DENSITY_OPTIONS: Array<{
  value: AppearanceSettings["density"];
  label: string;
}> = [
  { value: "compact", label: "Compact" },
  { value: "comfortable", label: "Comfortable" },
  { value: "spacious", label: "Spacious" },
];

const BACKGROUND_STYLE_OPTIONS: Array<{
  value: AppearanceSettings["backgroundStyle"];
  label: string;
}> = [
  { value: "flat", label: "Flat" },
  { value: "glow", label: "Glow" },
  { value: "grain", label: "Grain" },
];

function AppearanceColorControl({
  label,
  token,
  value,
  onChange,
}: {
  label: string;
  token: AppearanceColorKey;
  value: string;
  onChange: (value: string) => void;
}) {
  const colorValue = normalizeHexColor(value);
  return (
    <label className="rounded border border-border/60 bg-card/25 p-1.5">
      <span className="block text-[8px] uppercase tracking-wider text-fg/35">
        {label}
      </span>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="color"
          value={colorValue}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 w-7 shrink-0 cursor-pointer rounded border border-border bg-input p-0"
          title={token}
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-1 font-mono text-[9px] text-fg outline-none focus:border-primary/50"
          spellCheck={false}
        />
      </div>
    </label>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const applyValue = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    onChange(Math.min(max, Math.max(min, parsed)));
  };
  return (
    <label className="block">
      <span className="text-[9px] text-fg/45 uppercase tracking-wider">
        {label}
      </span>
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => applyValue(event.target.value)}
          className="min-w-0 flex-1 accent-primary"
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => applyValue(event.target.value)}
          className="w-14 rounded border border-border bg-input px-1 py-1 text-right text-[9px] text-fg outline-none focus:border-primary/50"
        />
        {suffix && <span className="text-[9px] text-fg/35">{suffix}</span>}
      </div>
    </label>
  );
}

function SettingsAccordionSection({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: string | number | null;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className="group rounded border border-border/60 bg-card/15 open:bg-card/20"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-card/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-fg/55">
          {title}
        </span>
        {meta !== undefined && meta !== null && (
          <span className="max-w-[55%] truncate rounded bg-bg/45 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-fg/35">
            {meta}
          </span>
        )}
        <span
          aria-hidden="true"
          className="shrink-0 text-[10px] text-fg/35 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="border-t border-border/45 p-2.5">{children}</div>
    </details>
  );
}

function themeRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex).slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function createBraveThemeManifest(appearance: AppearanceSettings) {
  return {
    manifest_version: 3,
    name: "Brave Dev Custom Theme",
    version: "1.0.0",
    description: "Generated from Brave Dev Extension Appearance settings.",
    theme: {
      colors: {
        frame: themeRgb(appearance.sidebar),
        frame_inactive: themeRgb(appearance.background),
        toolbar: themeRgb(appearance.card),
        tab_text: themeRgb(appearance.foreground),
        tab_background_text: themeRgb(appearance.mutedForeground),
        bookmark_text: themeRgb(appearance.foreground),
        button_background: themeRgb(appearance.primary),
        toolbar_button_icon: themeRgb(appearance.foreground),
        omnibox_background: themeRgb(appearance.input),
        omnibox_text: themeRgb(appearance.foreground),
        omnibox_results_bg: themeRgb(appearance.popover),
        omnibox_results_text: themeRgb(appearance.popoverForeground),
        ntp_background: themeRgb(appearance.background),
        ntp_text: themeRgb(appearance.foreground),
        ntp_link: themeRgb(appearance.primary),
        control_background: themeRgb(appearance.secondary),
      },
    },
  };
}

export function SettingsPanel({
  settings,
  onUpdate,
  onClose,
  nativeHost,
  mcpServers,
  agentToolStatus,
  sidebarSync,
  mcp,
  doppler,
}: {
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
  onClose: () => void;
  nativeHost: {
    connected: boolean;
    getMCPServers: (path?: string) => void;
    addMCPServer: (server: any, path?: string) => void;
  };
  mcpServers: MCPServer[];
  agentToolStatus?: ToolSourceState[];
  sidebarSync: {
    lastSyncAt: number | null;
    lastError: string | null;
    pending: boolean;
    flush: () => void;
  };
  mcp?: {
    status: MCPStatus | null;
    refresh: () => void;
    rotateToken: () => void;
    resetRegistration: () => void;
    setTerminalPath: (enabled: boolean) => void;
    pending?: {
      refresh?: boolean;
      rotateToken?: boolean;
      resetRegistration?: boolean;
      terminalPath?: boolean;
    };
    loading?: {
      refresh?: boolean;
      rotateToken?: boolean;
      resetRegistration?: boolean;
      terminalPath?: boolean;
    };
    toast: string | null;
  };
  doppler?: {
    status: DopplerStatus | null;
    refresh: () => void;
    login: () => void;
    saveDefaults: () => void;
    pending?: {
      refresh?: boolean;
      login?: boolean;
      saveDefaults?: boolean;
    };
    loading?: {
      refresh?: boolean;
      login?: boolean;
      saveDefaults?: boolean;
    };
    toast: string | null;
  };
}) {
  const [newServer, setNewServer] = useState({
    name: "",
    command: "",
    args: "",
  });
  const [showAddMCP, setShowAddMCP] = useState(false);
  const [localJoplinToken, setLocalJoplinToken] = useState(
    settings.joplinToken ?? "",
  );
  const [joplinTesting, setJoplinTesting] = useState(false);
  const [joplinTestResult, setJoplinTestResult] = useState<
    "ok" | "fail" | null
  >(null);
  const [braveThemeStatus, setBraveThemeStatus] = useState<string | null>(null);
  const [passwordCleanupStatus, setPasswordCleanupStatus] = useState<
    string | null
  >(null);
  const [legacyPasswordKeys, setLegacyPasswordKeys] = useState<string[]>([]);
  const [passwordAppStatus, setPasswordAppStatus] =
    useState<PasswordAppStatus | null>(null);
  const [passwordAppChecking, setPasswordAppChecking] = useState(false);
  const appearance = resolveAppearanceSettings(settings);
  const appearancePresets = Object.entries(APPEARANCE_PRESETS) as Array<
    [
      Exclude<ThemeName, "custom">,
      (typeof APPEARANCE_PRESETS)[Exclude<ThemeName, "custom">],
    ]
  >;
  const activeThemeName =
    settings.theme === "custom"
      ? "Custom"
      : (APPEARANCE_PRESETS[settings.theme]?.name ?? "Custom");
  const updateAppearance = (patch: Partial<AppearanceSettings>) => {
    onUpdate({
      theme: "custom",
      appearance: createCustomAppearance(appearance, patch),
    });
  };
  const selectPreset = (theme: Exclude<ThemeName, "custom">) => {
    onUpdate({
      theme,
      appearance: cloneAppearance(APPEARANCE_PRESETS[theme].settings),
    });
  };
  const downloadBraveThemeManifest = () => {
    setBraveThemeStatus(null);
    const manifest = createBraveThemeManifest(appearance);
    const blob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    chrome.downloads.download(
      {
        url,
        filename: "brave-dev-theme/manifest.json",
        conflictAction: "overwrite",
        saveAs: false,
      },
      (downloadId) => {
        URL.revokeObjectURL(url);
        if (chrome.runtime.lastError || !downloadId) {
          setBraveThemeStatus(
            chrome.runtime.lastError?.message ||
              "Theme manifest download failed.",
          );
          return;
        }
        setBraveThemeStatus(
          "Downloaded to Downloads/brave-dev-theme. Load that folder unpacked from brave://extensions.",
        );
      },
    );
  };

  const refreshLegacyPasswordState = () => {
    void getLegacyPasswordStorageState()
      .then((state) => {
        setLegacyPasswordKeys(
          state.filter((entry) => entry.present).map((entry) => entry.key),
        );
      })
      .catch(() => setLegacyPasswordKeys([]));
  };

  const purgePasswordCache = () => {
    setPasswordCleanupStatus("Purging old password cache...");
    void purgeLegacyPasswordStorage()
      .then(() => {
        setLegacyPasswordKeys([]);
        setPasswordCleanupStatus("Legacy Nodewarden/password cache purged.");
      })
      .catch((err) => {
        setPasswordCleanupStatus(
          err instanceof Error ? err.message : "Password cache purge failed.",
        );
      });
  };
  const refreshPasswordAppStatus = () => {
    const url = settings.passwordAppUrl.trim();
    if (!url) return;

    setPasswordAppChecking(true);
    void checkPasswordAppStatus(url)
      .then(setPasswordAppStatus)
      .catch((error) => {
        setPasswordAppStatus({
          ok: false,
          url,
          checkedAt: new Date().toISOString(),
          version: null,
          jwtUnsafeReason: null,
          registrationInviteRequired: null,
          error:
            error instanceof Error
              ? error.message
              : "Password app status check failed.",
        });
      })
      .finally(() => setPasswordAppChecking(false));
  };
  const passwordProvider = settings.passwordManagerProvider;
  const passwordStrategyTitle =
    passwordProvider === "none"
      ? "Extension password features are off"
      : passwordProvider === "nodewarden-self-hosted"
        ? "go is the password vault"
        : "Proton Pass is in charge";
  const passwordStrategyDescription =
    passwordProvider === "none"
      ? "No extension password integration is active. Keep password management in your external manager."
      : passwordProvider === "nodewarden-self-hosted"
        ? "The extension opens go and checks health, while go owns login, encryption, imports, and backups."
        : "The extension keeps Proton external: no local vault storage, no passive password autofill, no auto-submit.";
  const passwordStrategyBadge =
    passwordProvider === "nodewarden-self-hosted"
      ? "Active"
      : passwordProvider === "none"
        ? "Off"
        : "Active";
  const passwordStrategyBadgeClass =
    passwordProvider === "nodewarden-self-hosted"
      ? "bg-success/15 text-success"
      : passwordProvider === "none"
        ? "bg-fg/10 text-fg/45"
        : "bg-success/15 text-success";

  useEffect(() => {
    setLocalJoplinToken(settings.joplinToken ?? "");
  }, [settings.joplinToken]);

  useEffect(() => {
    refreshLegacyPasswordState();
  }, []);

  useEffect(() => {
    setPasswordAppStatus(null);
  }, [settings.passwordAppUrl]);

  useEffect(() => {
    if (nativeHost.connected) {
      nativeHost.getMCPServers(settings.claudeConfigPath);
    }
  }, [nativeHost.connected]);

  return (
    <div className="flex flex-col h-full bg-bg-alt">
      <div className="px-3 py-2 border-b border-border flex items-center">
        <span className="text-xs font-medium text-fg/80 flex-1">Settings</span>
        <button onClick={onClose} className="text-fg/40 hover:text-fg text-xs">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {/* Appearance */}
        <SettingsAccordionSection
          title="Appearance"
          meta={activeThemeName}
          defaultOpen
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-1.5">
              {appearancePresets.map(([theme, preset]) => (
                <button
                  key={theme}
                  onClick={() => selectPreset(theme)}
                  className={`rounded border p-2 text-left transition-all ${
                    settings.theme === theme
                      ? "border-primary bg-primary/15 text-fg"
                      : "border-border/70 bg-card/30 hover:bg-card/50 text-fg/70"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-5 w-5 rounded-full border border-border/70 shadow-sm"
                      style={{ background: preset.preview }}
                    />
                    <span className="text-[11px] font-medium">
                      {preset.name}
                    </span>
                  </div>
                  <div className="mt-1 flex gap-1">
                    {preset.swatches.map((swatch) => (
                      <span
                        key={swatch}
                        className="h-2 flex-1 rounded-full border border-border/50"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </div>
                  <div className="mt-1 text-[9px] leading-snug text-fg/35">
                    {preset.description}
                  </div>
                </button>
              ))}
              <button
                onClick={() =>
                  onUpdate({
                    theme: "custom",
                    appearance: cloneAppearance(appearance),
                  })
                }
                className={`rounded border p-2 text-left transition-all ${
                  settings.theme === "custom"
                    ? "border-primary bg-primary/15 text-fg"
                    : "border-border/70 bg-card/30 hover:bg-card/50 text-fg/70"
                }`}
              >
                <div className="text-[11px] font-medium">Custom</div>
                <div className="mt-1 text-[9px] leading-snug text-fg/35">
                  Locks the current look and lets every token below become
                  editable.
                </div>
              </button>
            </div>

            <div>
              <div className="text-[10px] text-fg/45 uppercase tracking-wider mb-1.5">
                Color tokens
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {APPEARANCE_COLOR_FIELDS.map((field) => (
                  <AppearanceColorControl
                    key={field.key}
                    label={field.label}
                    token={field.key}
                    value={appearance[field.key]}
                    onChange={(value) =>
                      updateAppearance({
                        [field.key]: value,
                      } as Partial<AppearanceSettings>)
                    }
                  />
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] text-fg/45 uppercase tracking-wider mb-1.5">
                Shape, type, and surface
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <NumberSetting
                  label="Corner radius"
                  value={appearance.radius}
                  min={0}
                  max={28}
                  step={1}
                  suffix="px"
                  onChange={(value) => updateAppearance({ radius: value })}
                />
                <NumberSetting
                  label="Font scale"
                  value={appearance.fontScale}
                  min={0.75}
                  max={1.35}
                  step={0.01}
                  suffix="x"
                  onChange={(value) => updateAppearance({ fontScale: value })}
                />
                <NumberSetting
                  label="Shadow"
                  value={appearance.shadowOpacity}
                  min={0}
                  max={0.8}
                  step={0.01}
                  suffix=""
                  onChange={(value) =>
                    updateAppearance({ shadowOpacity: value })
                  }
                />
                <label className="block">
                  <span className="text-[9px] text-fg/45 uppercase tracking-wider">
                    Density
                  </span>
                  <select
                    value={appearance.density}
                    onChange={(event) =>
                      updateAppearance({
                        density: event.target
                          .value as AppearanceSettings["density"],
                      })
                    }
                    className="mt-1 w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-fg outline-none focus:border-primary/50"
                  >
                    {DENSITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-[9px] text-fg/45 uppercase tracking-wider">
                    Backdrop
                  </span>
                  <select
                    value={appearance.backgroundStyle}
                    onChange={(event) =>
                      updateAppearance({
                        backgroundStyle: event.target
                          .value as AppearanceSettings["backgroundStyle"],
                      })
                    }
                    className="mt-1 w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-fg outline-none focus:border-primary/50"
                  >
                    {BACKGROUND_STYLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-2 rounded border border-border/70 bg-card/30 p-2">
                <div className="text-[10px] font-medium text-fg/75">
                  Browser title bar theme
                </div>
                <div className="mt-1 text-[9px] leading-snug text-fg/40">
                  Exports a tiny Brave theme manifest using this Appearance
                  palette. The tab strip/title bar uses the Rail color.
                </div>
                <button
                  type="button"
                  onClick={downloadBraveThemeManifest}
                  className="mt-2 w-full rounded bg-primary px-2 py-1.5 text-[10px] font-medium hover:bg-primary/85"
                  style={{ color: "rgb(var(--primary-foreground))" }}
                >
                  Download Brave theme manifest
                </button>
                {braveThemeStatus && (
                  <div className="mt-1.5 text-[9px] leading-snug text-fg/45">
                    {braveThemeStatus}
                  </div>
                )}
              </div>
              <div className="mt-1.5 space-y-1.5">
                <label className="block">
                  <span className="text-[9px] text-fg/45 uppercase tracking-wider">
                    UI font stack
                  </span>
                  <input
                    type="text"
                    value={appearance.fontFamily}
                    onChange={(event) =>
                      updateAppearance({ fontFamily: event.target.value })
                    }
                    className="mt-1 w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-fg outline-none focus:border-primary/50"
                    placeholder='"Inter", system-ui, sans-serif'
                  />
                </label>
                <label className="block">
                  <span className="text-[9px] text-fg/45 uppercase tracking-wider">
                    Mono font stack
                  </span>
                  <input
                    type="text"
                    value={appearance.monoFontFamily}
                    onChange={(event) =>
                      updateAppearance({ monoFontFamily: event.target.value })
                    }
                    className="mt-1 w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-fg outline-none focus:border-primary/50"
                    placeholder='"JetBrains Mono", "Fira Code", monospace'
                  />
                </label>
              </div>
            </div>
          </div>
        </SettingsAccordionSection>

        {/* Paths */}
        <SettingsAccordionSection title="Paths">
          <div className="space-y-2">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-fg/50">
                Working Directory
              </span>
              <input
                type="text"
                value={settings.workingDirectory}
                onChange={(e) => onUpdate({ workingDirectory: e.target.value })}
                className="w-full text-xs py-1.5 px-2.5 rounded bg-input border border-border text-fg font-mono placeholder-fg/30 outline-none focus:border-primary/50"
                placeholder="~/Projects/my-app"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-fg/50">
                Claude Config Path
              </span>
              <input
                type="text"
                value={settings.claudeConfigPath}
                onChange={(e) => onUpdate({ claudeConfigPath: e.target.value })}
                className="w-full text-xs py-1.5 px-2.5 rounded bg-input border border-border text-fg font-mono placeholder-fg/30 outline-none focus:border-primary/50"
                placeholder="~/.claude.json"
              />
            </label>
          </div>
        </SettingsAccordionSection>

        {/* MCP Servers */}
        <SettingsAccordionSection
          title="MCP Servers"
          meta={
            mcpServers.length > 0
              ? `${mcpServers.length} local`
              : "local Claude Code"
          }
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-fg/40">
                Local Claude Code server list
              </div>
              <button
                type="button"
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
                  onChange={(e) =>
                    setNewServer({ ...newServer, name: e.target.value })
                  }
                  className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="Server name"
                />
                <input
                  type="text"
                  value={newServer.command}
                  onChange={(e) =>
                    setNewServer({ ...newServer, command: e.target.value })
                  }
                  className="w-full text-[11px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="Command (e.g., npx -y @modelcontextprotocol/server-github)"
                />
                <input
                  type="text"
                  value={newServer.args}
                  onChange={(e) =>
                    setNewServer({ ...newServer, args: e.target.value })
                  }
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
                          args: newServer.args
                            ? newServer.args.split(",").map((a) => a.trim())
                            : [],
                        },
                        settings.claudeConfigPath,
                      );
                      setNewServer({ name: "", command: "", args: "" });
                      setShowAddMCP(false);
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
                  const isHttp =
                    server.type === "http" ||
                    server.type === "sse" ||
                    !!server.url;
                  const statusColor =
                    server.status === "connected"
                      ? "bg-success"
                      : server.status === "failed"
                        ? "bg-error"
                        : server.status === "needs-auth"
                          ? "bg-warning"
                          : server.status === "disconnected"
                            ? "bg-fg/30"
                            : "bg-fg/20";
                  const sourceLabel =
                    server.source === "claude-ai"
                      ? "claude.ai"
                      : server.source === "plugin"
                        ? "plugin"
                        : "local";
                  return (
                    <div key={server.name} className="bg-card/20 rounded p-2">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColor}`}
                          title={server.status || "unknown"}
                        />
                        <div className="text-[11px] text-fg/80 font-medium flex-1 truncate">
                          {server.name}
                        </div>
                        <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/40 text-fg/50">
                          {server.type || "stdio"}
                        </span>
                        <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/30 text-fg/40">
                          {sourceLabel}
                        </span>
                      </div>
                      <div className="text-[9px] text-fg/30 font-mono mt-0.5 break-all">
                        {isHttp
                          ? server.url
                          : `${server.command || ""} ${(server.args || []).join(" ")}`.trim()}
                      </div>
                      {server.status === "needs-auth" && (
                        <div className="text-[9px] text-warning/80 mt-1">
                          Run <span className="font-mono">claude</span> in a
                          terminal and trigger a tool to authenticate.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[10px] text-fg/30 text-center py-2">
                {nativeHost.connected
                  ? "No MCP servers configured"
                  : "Connect native host to manage servers"}
              </div>
            )}
          </div>
        </SettingsAccordionSection>

        {/* Agent Tools (cloud agent) — reachability from the AI agent chat */}
        <SettingsAccordionSection
          title="Agent Tools"
          meta={
            agentToolStatus?.length
              ? `${agentToolStatus.length} sources`
              : "cloud agent"
          }
        >
          {agentToolStatus && agentToolStatus.length > 0 ? (
            <div className="space-y-1">
              {agentToolStatus.map((source) => {
                const state = source.status.state;
                const toolCount =
                  "tools" in source.status ? source.status.tools : undefined;
                const reason =
                  "reason" in source.status ? source.status.reason : undefined;
                return (
                  <div key={source.id} className="bg-card/20 rounded p-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${agentDot(state)}`}
                        title={state}
                      />
                      <div className="text-[11px] text-fg/80 font-medium flex-1 truncate">
                        {source.id}
                      </div>
                      <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/40 text-fg/50">
                        {state}
                      </span>
                      {typeof toolCount === "number" && (
                        <span className="text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/30 text-fg/40">
                          {toolCount} tools
                        </span>
                      )}
                    </div>
                    {reason && (
                      <div className="text-[9px] text-fg/40 mt-0.5 break-all">
                        {reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[10px] text-fg/30 text-center py-2">
              {settings.agentApiUrl &&
              settings.agentAccessClientId &&
              settings.agentAccessClientSecret
                ? "No tool sources reported (or agent unreachable)"
                : "Configure Agent API (URL + Access client id/secret) below to see tool status"}
            </div>
          )}
        </SettingsAccordionSection>

        {/* MCP Server (this extension's own server) */}
        {mcp && (
          <SettingsAccordionSection
            title="Brave Extension MCP"
            meta={
              mcp.status?.port ? `127.0.0.1:${mcp.status.port}` : "not running"
            }
          >
            <div className="space-y-2">
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
                label="Registered in configured Claude config"
                ok={!!mcp.status?.registered}
                detail={
                  mcp.status?.configPath ||
                  mcp.status?.claudeJsonStatus ||
                  "unknown"
                }
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
                disabled={mcp.pending?.terminalPath}
                loading={mcp.loading?.terminalPath}
                onChange={(v) => mcp.setTerminalPath(v)}
              />

              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={mcp.rotateToken}
                  disabled={mcp.pending?.rotateToken}
                  className="flex-1 text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40 disabled:cursor-wait inline-flex items-center justify-center gap-1.5"
                >
                  {mcp.loading?.rotateToken && (
                    <LoadingGlyph label="Rotating token" />
                  )}
                  Rotate token
                </button>
                <button
                  onClick={mcp.resetRegistration}
                  disabled={mcp.pending?.resetRegistration}
                  className="flex-1 text-[10px] py-1 rounded bg-secondary/40 text-fg/80 hover:bg-secondary/60 disabled:opacity-40 disabled:cursor-wait inline-flex items-center justify-center gap-1.5"
                >
                  {mcp.loading?.resetRegistration && (
                    <LoadingGlyph label="Resetting registration" />
                  )}
                  Reset registration
                </button>
                <button
                  onClick={mcp.refresh}
                  disabled={mcp.pending?.refresh}
                  className="text-[10px] py-1 px-2 rounded bg-secondary/30 text-fg/60 hover:bg-secondary/50 disabled:opacity-40 disabled:cursor-wait inline-flex items-center justify-center min-w-7"
                  title="Refresh status"
                >
                  {mcp.loading?.refresh ? (
                    <LoadingGlyph label="Refreshing MCP status" />
                  ) : (
                    "↻"
                  )}
                </button>
              </div>
              {mcp.toast && (
                <div className="text-[10px] text-success/90 pt-1">
                  {mcp.toast}
                </div>
              )}
            </div>
          </SettingsAccordionSection>
        )}

        {/* Tool gates + integrations */}
        <SettingsAccordionSection title="Tool gates">
          <div className="space-y-2">
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
              <label className="text-[10px] text-fg/50 mb-1 block">
                Brave Search API key
              </label>
              <input
                type="password"
                value={settings.braveSearchApiKey}
                onChange={(e) =>
                  onUpdate({ braveSearchApiKey: e.target.value })
                }
                className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="brave_search_…"
              />
            </div>
          </div>
        </SettingsAccordionSection>

        {/* Password strategy */}
        <SettingsAccordionSection
          title="Password strategy"
          meta={passwordStrategyBadge}
        >
          <div className="space-y-2">
            <div className="rounded border border-success/20 bg-success/5 p-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium text-fg">
                    {passwordStrategyTitle}
                  </div>
                  <div className="text-[9px] leading-snug text-fg/45">
                    {passwordStrategyDescription}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[8px] uppercase tracking-wider ${passwordStrategyBadgeClass}`}
                >
                  {passwordStrategyBadge}
                </span>
              </div>
            </div>

            <label className="block">
              <span className="text-[10px] text-fg/50 mb-1 block">
                Provider of record
              </span>
              <select
                value={settings.passwordManagerProvider}
                onChange={(event) =>
                  onUpdate({
                    passwordManagerProvider: event.target
                      .value as PasswordManagerProvider,
                  })
                }
                className="w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-fg outline-none"
              >
                <option value="nodewarden-self-hosted">
                  Self-hosted go
                </option>
                <option value="proton-pass">Proton Pass</option>
                <option value="none">No extension password integration</option>
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] text-fg/50 mb-1 block">
                Self-hosted password app URL
              </span>
              <input
                type="url"
                value={settings.passwordAppUrl}
                onChange={(event) =>
                  onUpdate({ passwordAppUrl: event.target.value })
                }
                className="w-full rounded border border-border bg-input px-2 py-1 text-[10px] text-fg outline-none"
                placeholder="https://passwords.example.com"
              />
            </label>

            <div
              className={`rounded border p-2 ${
                passwordAppStatus?.ok
                  ? "border-success/20 bg-success/5"
                  : passwordAppStatus
                    ? "border-warning/25 bg-warning/5"
                    : "border-border/60 bg-card/20"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-medium text-fg/70">
                    Custom app status
                  </div>
                  <div className="truncate text-[9px] leading-snug text-fg/45">
                    {passwordAppChecking
                      ? "Checking password app..."
                      : passwordAppStatus
                        ? passwordAppStatus.ok
                          ? `Reachable${passwordAppStatus.version ? ` - ${passwordAppStatus.version}` : ""}`
                          : passwordAppStatus.error || "Status check failed."
                        : "Not checked yet."}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={passwordAppChecking || !settings.passwordAppUrl.trim()}
                  onClick={refreshPasswordAppStatus}
                  className="shrink-0 rounded bg-primary/15 px-2 py-1 text-[10px] text-primary hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {passwordAppChecking ? "Checking" : "Check"}
                </button>
              </div>

              {passwordAppStatus && (
                <div className="mt-2 grid gap-1">
                  <StatusRow
                    label="JWT secret"
                    ok={
                      !passwordAppStatus.error &&
                      passwordAppStatus.jwtUnsafeReason === null
                    }
                    warn={
                      !!passwordAppStatus.error ||
                      passwordAppStatus.jwtUnsafeReason !== null
                    }
                    detail={
                      passwordAppStatus.error &&
                      passwordAppStatus.jwtUnsafeReason === null
                        ? "unknown"
                        : passwordAppStatus.jwtUnsafeReason
                        ? passwordAppStatus.jwtUnsafeReason.replace(/_/g, " ")
                        : "safe"
                    }
                  />
                  <StatusRow
                    label="Registration gate"
                    ok={
                      !passwordAppStatus.error &&
                      passwordAppStatus.registrationInviteRequired === true
                    }
                    warn={
                      !!passwordAppStatus.error ||
                      passwordAppStatus.registrationInviteRequired !== true
                    }
                    detail={
                      passwordAppStatus.error &&
                      passwordAppStatus.registrationInviteRequired === null
                        ? "unknown"
                        : passwordAppStatus.registrationInviteRequired === true
                        ? "active"
                        : passwordAppStatus.registrationInviteRequired === false
                          ? "open"
                          : "unknown"
                    }
                  />
                  <StatusRow
                    label="Last check"
                    ok={passwordAppStatus.ok}
                    warn={!passwordAppStatus.ok}
                    detail={new Date(
                      passwordAppStatus.checkedAt,
                    ).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <StatusRow
                label="Stores vault passwords"
                ok={!PASSWORD_STRATEGY.extensionStoresVaultPasswords}
                detail={
                  PASSWORD_STRATEGY.extensionStoresVaultPasswords
                    ? "enabled"
                    : "disabled"
                }
              />
              <StatusRow
                label="Passive autofill"
                ok={!PASSWORD_STRATEGY.passiveAutofillEnabled}
                detail={
                  PASSWORD_STRATEGY.passiveAutofillEnabled
                    ? "enabled"
                    : "disabled"
                }
              />
              <StatusRow
                label="Self-hosted go"
                ok={
                  PASSWORD_STRATEGY.selfHostedNodewardenStatus ===
                  "go external vault"
                }
                detail={PASSWORD_STRATEGY.selfHostedNodewardenStatus}
              />
              <StatusRow
                label="Legacy cache"
                ok={legacyPasswordKeys.length === 0}
                warn={legacyPasswordKeys.length > 0}
                detail={
                  legacyPasswordKeys.length === 0
                    ? "clear"
                    : `${legacyPasswordKeys.length} old key${legacyPasswordKeys.length === 1 ? "" : "s"}`
                }
              />
            </div>

            {legacyPasswordKeys.length > 0 && (
              <div className="rounded border border-warning/20 bg-warning/5 p-1.5 text-[9px] leading-snug text-fg/45">
                Found old Nodewarden/password cache keys:{" "}
                {legacyPasswordKeys.join(", ")}
              </div>
            )}

            <div className="flex gap-1.5">
              <button
                type="button"
                disabled={!settings.passwordAppUrl.trim()}
                onClick={() =>
                  window.open(
                    settings.passwordAppUrl.trim(),
                    "go",
                    "popup,width=1100,height=760",
                  )
                }
                className="flex-1 rounded bg-primary/15 px-2 py-1 text-[10px] text-primary hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Open custom app
              </button>
              <button
                type="button"
                onClick={() =>
                  window.open(
                    "https://pass.proton.me",
                    "proton-pass",
                    "popup,width=1100,height=760",
                  )
                }
                className="flex-1 rounded bg-primary/20 px-2 py-1 text-[10px] text-primary hover:bg-primary/30"
              >
                Open Proton Pass
              </button>
              <button
                type="button"
                onClick={purgePasswordCache}
                className="flex-1 rounded bg-secondary/40 px-2 py-1 text-[10px] text-fg/80 hover:bg-secondary/60"
              >
                Purge old cache
              </button>
            </div>
            {passwordCleanupStatus && (
              <div className="text-[10px] text-fg/45">
                {passwordCleanupStatus}
              </div>
            )}
          </div>
        </SettingsAccordionSection>

        {/* Joplin clipper */}
        <SettingsAccordionSection title="Joplin">
          <div className="space-y-2">
            <div className="text-[10px] text-fg/50">
              Paste the Web Clipper token from Joplin Desktop (Tools → Options →
              Web Clipper → Advanced options → Copy token).
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                className="flex-1 text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="Joplin API token"
                value={localJoplinToken}
                onChange={(e) => setLocalJoplinToken(e.target.value)}
              />
              <button
                className="text-[10px] py-1 px-2 rounded bg-primary/20 text-primary hover:bg-primary/30"
                onClick={() => {
                  onUpdate({ joplinToken: localJoplinToken });
                  setJoplinTestResult(null);
                }}
              >
                Save
              </button>
              <button
                className="text-[10px] py-1 px-2 rounded bg-secondary/40 text-fg/80 hover:bg-secondary/60 inline-flex items-center gap-1"
                onClick={async () => {
                  setJoplinTesting(true);
                  const ok = await ping();
                  setJoplinTesting(false);
                  setJoplinTestResult(ok ? "ok" : "fail");
                }}
              >
                {joplinTesting ? (
                  <>
                    <LoadingGlyph label="Testing Joplin connection" /> Testing…
                  </>
                ) : (
                  "Test connection"
                )}
              </button>
            </div>
            {joplinTestResult === "ok" && (
              <div className="text-[10px] text-success/90">
                ✓ JoplinClipperServer reachable.
              </div>
            )}
            {joplinTestResult === "fail" && (
              <div className="text-[10px] text-error/90">
                Couldn't reach Joplin on localhost:41184. Enable the Web Clipper
                service in Joplin.
              </div>
            )}
          </div>
        </SettingsAccordionSection>

        {/* Doppler */}
        {doppler && (
          <SettingsAccordionSection
            title="Doppler"
            meta={doppler.status?.tokenSet ? "logged in" : "not logged in"}
          >
            <div className="space-y-2">
              <StatusRow
                label="CLI"
                ok={!!doppler.status?.cliAvailable}
                detail={doppler.status?.cliVersion || "not found"}
              />
              <StatusRow
                label="Auth"
                ok={!!doppler.status?.tokenSet && !doppler.status?.error}
                warn={!!doppler.status?.tokenSet && !!doppler.status?.error}
                detail={
                  doppler.status?.tokenSet
                    ? `${doppler.status.tokenSource} · ${doppler.status.workplaceName || doppler.status.tokenPreview || "token set"}`
                    : "not logged in"
                }
              />
              <StatusRow
                label="Defaults"
                ok={!!(settings.dopplerProject && settings.dopplerConfig)}
                detail={
                  settings.dopplerProject && settings.dopplerConfig
                    ? `${settings.dopplerProject}/${settings.dopplerConfig}`
                    : "project/config optional"
                }
              />

              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  value={settings.dopplerProject}
                  onChange={(e) => onUpdate({ dopplerProject: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="project"
                />
                <input
                  type="text"
                  value={settings.dopplerConfig}
                  onChange={(e) => onUpdate({ dopplerConfig: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="config"
                />
              </div>
              <input
                type="text"
                value={settings.dopplerScope}
                onChange={(e) => onUpdate({ dopplerScope: e.target.value })}
                className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                placeholder="/"
              />

              <div className="flex gap-1.5 pt-1">
                <button
                  onClick={doppler.login}
                  disabled={!nativeHost.connected || doppler.pending?.login}
                  className="flex-1 text-[10px] py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40 disabled:cursor-wait inline-flex items-center justify-center gap-1.5"
                >
                  {doppler.loading?.login && (
                    <LoadingGlyph label="Connecting Doppler OAuth" />
                  )}
                  OAuth login
                </button>
                <button
                  onClick={doppler.saveDefaults}
                  disabled={
                    !nativeHost.connected || doppler.pending?.saveDefaults
                  }
                  className="flex-1 text-[10px] py-1 rounded bg-secondary/40 text-fg/80 hover:bg-secondary/60 disabled:opacity-40 disabled:cursor-wait inline-flex items-center justify-center gap-1.5"
                >
                  {doppler.loading?.saveDefaults && (
                    <LoadingGlyph label="Saving Doppler defaults" />
                  )}
                  Save defaults
                </button>
                <button
                  onClick={doppler.refresh}
                  disabled={!nativeHost.connected || doppler.pending?.refresh}
                  className="text-[10px] py-1 px-2 rounded bg-secondary/30 text-fg/60 hover:bg-secondary/50 disabled:opacity-40 disabled:cursor-wait inline-flex items-center justify-center min-w-7"
                  title="Refresh Doppler status"
                >
                  {doppler.loading?.refresh ? (
                    <LoadingGlyph label="Refreshing Doppler status" />
                  ) : (
                    "↻"
                  )}
                </button>
              </div>

              {doppler.status?.error && (
                <div className="text-[10px] text-warning/90 pt-1 break-words">
                  {doppler.status.error.slice(0, 140)}
                </div>
              )}
            </div>
          </SettingsAccordionSection>
        )}

        {/* Sidebar Sync (Phase 5 cutover from CloudOS) */}
        <SettingsAccordionSection
          title="Sidebar Sync"
          meta={settings.sidebarSyncEnabled ? "on" : "off"}
        >
          <div className="space-y-2">
            <Toggle
              label="Sync conversations to sidebar-api"
              description="Auto-saves chats to your Cloudflare Worker (D1 + Vectorize embedding)"
              checked={settings.sidebarSyncEnabled}
              onChange={(v) => onUpdate({ sidebarSyncEnabled: v })}
            />
            {settings.sidebarSyncEnabled && (
              <>
                <input
                  type="text"
                  value={settings.sidebarApiUrl}
                  onChange={(e) => onUpdate({ sidebarApiUrl: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="https://txt.fly.pm"
                />
                <input
                  type="password"
                  value={settings.sidebarApiToken}
                  onChange={(e) =>
                    onUpdate({ sidebarApiToken: e.target.value })
                  }
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="X-Sidebar-Token (required)"
                />
                <input
                  type="password"
                  value={settings.tasksApiToken}
                  onChange={(e) => onUpdate({ tasksApiToken: e.target.value })}
                  className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
                  placeholder="Tasks API token (auto-fills from Doppler; falls back to sidebar token)"
                />
                <p className="text-[9px] text-muted-fg leading-snug">
                  Tasks also accept your cal.fly.pm browser session. Sign in at{" "}
                  <a
                    href="https://cal.fly.pm/tasks"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    cal.fly.pm/tasks
                  </a>{" "}
                  if token auth fails.
                </p>
                <Toggle
                  label="Prune local after sync"
                  description="Drop synced messages from chrome.storage to keep space low"
                  checked={settings.sidebarPruneAfterSync}
                  onChange={(v) => onUpdate({ sidebarPruneAfterSync: v })}
                />
                <Toggle
                  label="Cloud browser planning"
                  description="Allow cloud AI (sidebar-api / AI Gateway) for features like media renaming when local models need fallback"
                  checked={settings.browserAgentCloudPlanningEnabled}
                  onChange={(v) =>
                    onUpdate({ browserAgentCloudPlanningEnabled: v })
                  }
                />
                <Toggle
                  label="Cloud vision fallback"
                  description="Allow future screenshot-based visual reasoning through AI Gateway. Screenshot bytes are not sent by default."
                  checked={settings.browserAgentCloudVisionEnabled}
                  onChange={(v) =>
                    onUpdate({ browserAgentCloudVisionEnabled: v })
                  }
                />
                <Toggle
                  label="Cloud OCR fallback"
                  description="Allow future screenshot OCR through AI Gateway. Page text still stays local unless cloud planning is enabled."
                  checked={settings.browserAgentCloudOcrEnabled}
                  onChange={(v) => onUpdate({ browserAgentCloudOcrEnabled: v })}
                />
                <div className="flex items-center justify-between text-[9px] pt-1">
                  <div className="text-fg/40">
                    {sidebarSync.pending ? (
                      "Syncing…"
                    ) : sidebarSync.lastError ? (
                      <span className="text-error">
                        Error: {sidebarSync.lastError.slice(0, 60)}
                      </span>
                    ) : sidebarSync.lastSyncAt ? (
                      `Last sync: ${new Date(sidebarSync.lastSyncAt).toLocaleTimeString()}`
                    ) : (
                      "Not synced yet"
                    )}
                  </div>
                  <button
                    onClick={sidebarSync.flush}
                    className="text-primary hover:text-primary/80"
                  >
                    Sync now
                  </button>
                </div>
              </>
            )}
            {settings.cloudosSyncEnabled && !settings.sidebarSyncEnabled && (
              <div className="text-[9px] text-fg/40 pt-1">
                Legacy CloudOS sync is still on. Migrate by toggling "Sync
                conversations to sidebar-api" above; the CloudOS settings will
                be removed in a follow-up release.
              </div>
            )}
          </div>
        </SettingsAccordionSection>

        {/* Agent API (Cloudflare Access) — streaming agent chat tab */}
        <SettingsAccordionSection
          title="Agent API"
          meta={settings.agentApiUrl ? "Cloudflare Access" : "not configured"}
        >
          <div className="space-y-2">
            <input
              type="text"
              value={settings.agentApiUrl}
              onChange={(e) => onUpdate({ agentApiUrl: e.target.value })}
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
              placeholder="https://agent.fly.pm"
            />
            <input
              type="password"
              value={settings.agentAccessClientId}
              onChange={(e) =>
                onUpdate({ agentAccessClientId: e.target.value })
              }
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
              placeholder="CF-Access-Client-Id"
            />
            <input
              type="password"
              value={settings.agentAccessClientSecret}
              onChange={(e) =>
                onUpdate({ agentAccessClientSecret: e.target.value })
              }
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none"
              placeholder="CF-Access-Client-Secret"
            />
          </div>
        </SettingsAccordionSection>

        <TtsSettingsSection settings={settings} onUpdate={onUpdate} />

        {/* Captures (ALO-467) — destination for screenshot/full-page PDF saves */}
        <CapturesSection settings={settings} onUpdate={onUpdate} />

        {/* Sidebar UX (ALO-471) — Auto-PiP toggle plus future rail tweaks */}
        <SettingsAccordionSection
          title="Sidebar UX"
          meta={
            settings.hideRailQuickActions
              ? "quick actions hidden"
              : "rail controls"
          }
        >
          <div className="space-y-2">
            <AutoPipToggleRow />
            <RailVisibilitySection settings={settings} onUpdate={onUpdate} />
          </div>
        </SettingsAccordionSection>

        {/* Toggles */}
        <SettingsAccordionSection title="Features">
          <div className="space-y-2">
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
        </SettingsAccordionSection>

        {/* Connection Status */}
        <SettingsAccordionSection
          title="Connection Status"
          meta={nativeHost.connected ? "connected" : "disconnected"}
        >
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${nativeHost.connected ? "bg-success" : "bg-error"}`}
            />
            <span className="text-[11px] text-fg/60">
              Native Host: {nativeHost.connected ? "Connected" : "Disconnected"}
            </span>
          </div>
          {!nativeHost.connected && (
            <div className="text-[10px] text-fg/30 mt-2 font-mono">
              Run: npm run install-host
            </div>
          )}
        </SettingsAccordionSection>
      </div>
    </div>
  );
}

const agentDot = (state: string) =>
  state === "connected"
    ? "bg-success"
    : state === "failed"
      ? "bg-error"
      : state === "needs-auth" ||
          state === "needs-config" ||
          state === "degraded"
        ? "bg-warning"
        : "bg-fg/30";

function AutoPipToggleRow() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    void getAutoPipEnabled().then(setEnabled);
  }, []);
  if (enabled === null) return null;
  return (
    <Toggle
      label="Auto Picture-in-picture"
      description="Default ON. When you switch tabs, the active video pops out into a floating window automatically."
      checked={enabled}
      onChange={async (v) => {
        setEnabled(v);
        await setAutoPipEnabled(v);
      }}
    />
  );
}

const TTS_VOICE_OPTIONS: { value: TtsVoice; label: string }[] = [
  { value: "hyperion", label: "Hyperion" },
  { value: "thalia", label: "Thalia" },
  { value: "andromeda", label: "Andromeda" },
  { value: "helena", label: "Helena" },
  { value: "apollo", label: "Apollo" },
];
const TTS_MODEL_OPTIONS: {
  value: Settings["ttsModel"];
  label: string;
  hint: string;
}[] = [
  {
    value: "frontier-aura",
    label: "Fast Aura 2",
    hint: "Direct Workers AI TTS through AI Gateway; fastest and safest default.",
  },
  {
    value: "dynamic-audio-gen",
    label: "Dynamic audio route",
    hint: "Use Cloudflare AI Gateway dynamic/audio_gen routing when you want gateway-side model selection.",
  },
  {
    value: "cartesia-sonic",
    label: "Cartesia Sonic",
    hint: "Use Cartesia's low-latency native TTS endpoint through AI Gateway.",
  },
];
const TTS_LAST_ERROR_KEY = "tts.lastError";

interface TtsLastError {
  code?: string;
  badge?: string;
  message?: string;
  cause?: string | null;
  at?: string;
}

function clampTtsPlaybackRate(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(5, Math.max(0.1, parsed));
}

function TtsSettingsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
}) {
  const [lastError, setLastError] = useState<TtsLastError | null>(null);
  const [cartesiaVoices, setCartesiaVoices] = useState<CartesiaVoiceOption[]>(
    [],
  );
  const [cartesiaVoicesLoading, setCartesiaVoicesLoading] = useState(false);
  const [cartesiaVoicesError, setCartesiaVoicesError] = useState<string | null>(
    null,
  );
  const activeModelLabel = TTS_MODEL_OPTIONS.find(
    (model) => model.value === settings.ttsModel,
  )?.label;

  useEffect(() => {
    void chrome.storage.local.get(TTS_LAST_ERROR_KEY).then((result) => {
      const value = result[TTS_LAST_ERROR_KEY];
      setLastError(
        value && typeof value === "object" ? (value as TtsLastError) : null,
      );
    });
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[TTS_LAST_ERROR_KEY]) return;
      const value = changes[TTS_LAST_ERROR_KEY].newValue;
      setLastError(
        value && typeof value === "object" ? (value as TtsLastError) : null,
      );
    };
    if (!chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged?.removeListener(listener);
  }, []);

  useEffect(() => {
    if (settings.ttsModel !== "cartesia-sonic") return;
    const apiUrl = settings.sidebarApiUrl?.trim();
    const apiToken = settings.sidebarApiToken?.trim();
    if (!apiUrl || !apiToken) {
      setCartesiaVoices([]);
      setCartesiaVoicesError(
        "Sidebar API URL/token required to load Cartesia voices.",
      );
      return;
    }
    const controller = new AbortController();
    setCartesiaVoicesLoading(true);
    setCartesiaVoicesError(null);
    void fetch(`${apiUrl.replace(/\/+$/, "")}/api/tts/voices`, {
      headers: { "x-sidebar-token": apiToken },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(
            body?.error?.message ||
              `Cartesia voices request failed: ${res.status}`,
          );
        }
        return res.json() as Promise<{ voices?: CartesiaVoiceOption[] }>;
      })
      .then((body) => {
        const voices = Array.isArray(body.voices) ? body.voices : [];
        setCartesiaVoices(voices);
        if (
          voices.length > 0 &&
          !voices.some((voice) => voice.id === settings.ttsCartesiaVoiceId)
        ) {
          onUpdate({ ttsCartesiaVoiceId: voices[0].id });
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCartesiaVoices([]);
        setCartesiaVoicesError(
          err instanceof Error ? err.message : String(err),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCartesiaVoicesLoading(false);
      });
    return () => controller.abort();
  }, [
    settings.ttsModel,
    settings.sidebarApiUrl,
    settings.sidebarApiToken,
    settings.ttsCartesiaVoiceId,
    onUpdate,
  ]);

  return (
    <SettingsAccordionSection title="TTS" meta={activeModelLabel}>
      <div className="space-y-2">
        <div>
          <label className="text-[10px] text-fg/50 mb-1 block">TTS model</label>
          <select
            value={settings.ttsModel}
            onChange={(e) =>
              onUpdate({ ttsModel: e.target.value as Settings["ttsModel"] })
            }
            className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg outline-none focus:border-primary/50"
          >
            {TTS_MODEL_OPTIONS.map((model) => (
              <option key={model.value} value={model.value}>
                {model.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[9px] text-fg/45 leading-snug">
            {
              TTS_MODEL_OPTIONS.find(
                (model) => model.value === settings.ttsModel,
              )?.hint
            }
          </p>
        </div>
        {settings.ttsModel === "cartesia-sonic" ? (
          <div>
            <label className="text-[10px] text-fg/50 mb-1 block">
              Cartesia voice
            </label>
            <select
              value={settings.ttsCartesiaVoiceId}
              onChange={(e) => onUpdate({ ttsCartesiaVoiceId: e.target.value })}
              disabled={cartesiaVoicesLoading || cartesiaVoices.length === 0}
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg outline-none focus:border-primary/50 disabled:opacity-60"
            >
              {cartesiaVoices.length === 0 ? (
                <option value={settings.ttsCartesiaVoiceId}>
                  {cartesiaVoicesLoading
                    ? "Loading Cartesia voices..."
                    : "Default Cartesia voice"}
                </option>
              ) : (
                cartesiaVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name || voice.id}
                  </option>
                ))
              )}
            </select>
            {cartesiaVoicesError ? (
              <p className="mt-1 text-[9px] text-error/90 leading-snug break-words">
                {cartesiaVoicesError}
              </p>
            ) : (
              <p className="mt-1 text-[9px] text-fg/45 leading-snug">
                {cartesiaVoicesLoading
                  ? "Loading available Cartesia voices..."
                  : "Voices are loaded from Cartesia through the sidebar Worker."}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label className="text-[10px] text-fg/50 mb-1 block">Voice</label>
            <select
              value={settings.ttsVoice}
              onChange={(e) =>
                onUpdate({ ttsVoice: e.target.value as TtsVoice })
              }
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg outline-none focus:border-primary/50"
            >
              {TTS_VOICE_OPTIONS.map((voice) => (
                <option key={voice.value} value={voice.value}>
                  {voice.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-[10px] text-fg/50 mb-1 block">
            Playback speed
          </label>
          <input
            type="number"
            min="0.1"
            max="5"
            step="0.1"
            value={settings.ttsPlaybackRate}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (Number.isFinite(parsed))
                onUpdate({ ttsPlaybackRate: parsed });
            }}
            onBlur={(e) =>
              onUpdate({
                ttsPlaybackRate: clampTtsPlaybackRate(e.target.value),
              })
            }
            className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none focus:border-primary/50"
          />
        </div>
        {lastError && (
          <div className="text-[9px] text-error/90 leading-snug break-words">
            Last TTS error: {lastError.badge || lastError.code || "ERR"} —{" "}
            {lastError.message || "Unknown error"}
            {lastError.cause ? ` (${lastError.cause})` : ""}
          </div>
        )}
      </div>
    </SettingsAccordionSection>
  );
}

function CapturesSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
}) {
  const locations: {
    value: CaptureSaveLocation;
    label: string;
    hint: string;
  }[] = [
    {
      value: "downloads",
      label: "Downloads folder",
      hint: "Default Chrome downloads location.",
    },
    {
      value: "downloads-subfolder",
      label: "Downloads subfolder",
      hint: "Keep captures grouped in a single folder inside Downloads.",
    },
    {
      value: "cloud",
      label: "Cloud (sidebar-api)",
      hint: "Upload to your Cloudflare Worker; R2 storage with Vectorize search.",
    },
  ];
  const cloudReady = !!(settings.sidebarApiUrl && settings.sidebarApiToken);
  return (
    <SettingsAccordionSection
      title="Captures"
      meta={settings.captureSaveLocation}
    >
      <div className="space-y-2">
        <div className="text-[10px] text-fg/50">
          Where Screenshot visible area and full-page PDF saves go.
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {locations.map((loc) => {
            const disabled = loc.value === "cloud" && !cloudReady;
            const isActive = settings.captureSaveLocation === loc.value;
            return (
              <button
                key={loc.value}
                type="button"
                disabled={disabled}
                onClick={() => onUpdate({ captureSaveLocation: loc.value })}
                title={
                  disabled
                    ? "Configure Sidebar API URL + token first"
                    : loc.hint
                }
                className={`p-2 rounded text-left transition-all text-[10px] ${
                  isActive
                    ? "ring-1 ring-primary/50 bg-primary/10 text-fg"
                    : "bg-card/30 hover:bg-card/50 text-fg/70"
                } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                <div className="font-medium">{loc.label}</div>
                <div className="text-[9px] text-fg/40 mt-0.5">{loc.hint}</div>
              </button>
            );
          })}
        </div>
        {settings.captureSaveLocation === "downloads-subfolder" && (
          <div>
            <label className="text-[10px] text-fg/50 mb-1 block">
              Subfolder name
            </label>
            <input
              type="text"
              value={settings.captureSubfolder}
              onChange={(e) =>
                onUpdate({
                  captureSubfolder: sanitizeSubfolder(e.target.value),
                })
              }
              className="w-full text-[10px] py-1 px-2 rounded bg-input border border-border text-fg font-mono outline-none focus:border-primary/50"
              placeholder={DEFAULT_CAPTURE_SUBFOLDER}
            />
            <div className="text-[9px] text-fg/40 mt-1">
              Chrome creates this folder inside Downloads. Path separators
              allowed; leading slashes and ".." segments are stripped.
            </div>
          </div>
        )}
        {settings.captureSaveLocation === "cloud" && (
          <div className="space-y-1.5">
            <Toggle
              label="Upload captures to cloud"
              description="Required to actually route captures to the Worker. Off = falls back to Downloads."
              checked={settings.cloudCapturesEnabled}
              onChange={(v) => onUpdate({ cloudCapturesEnabled: v })}
            />
            {!cloudReady && (
              <div className="text-[10px] text-warning/80">
                Set Sidebar API URL + token in the Sidebar Sync section below
                first.
              </div>
            )}
          </div>
        )}
      </div>
    </SettingsAccordionSection>
  );
}

function StatusRow({
  label,
  ok,
  warn,
  detail,
}: {
  label: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
}) {
  const color = ok ? "bg-success" : warn ? "bg-warning" : "bg-fg/30";
  return (
    <div className="flex items-center gap-2">
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
      <div className="text-[11px] text-fg/70 flex-1 truncate">{label}</div>
      <div className="text-[9px] text-fg/40 font-mono truncate max-w-[55%]">
        {detail}
      </div>
    </div>
  );
}

function RailVisibilitySection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const hidden = new Set(settings.hiddenRailSections ?? []);
  const sectionsById = new Map(
    SECTIONS.map((section) => [section.id, section]),
  );
  const orderedSections = normalizeRailSectionOrder(settings.railSectionOrder)
    .map((id) => sectionsById.get(id))
    .filter((section): section is (typeof SECTIONS)[number] =>
      Boolean(section),
    )
    .filter((section) => section.id !== "settings");
  const toggleSection = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onUpdate({ hiddenRailSections: Array.from(next) });
  };

  return (
    <div className="space-y-2 rounded border border-border/60 bg-card/20 p-3">
      <div>
        <div className="text-[11px] text-fg/70">Rail icons</div>
        <div className="text-[9px] text-fg/30">
          Drag icons in the rail to reorder them. Hide icons here without
          removing their features. Settings stays visible.
        </div>
      </div>
      <Toggle
        label="Hide quick actions"
        description="Hide the lower screenshot/PDF/PiP/save-link shortcut cluster"
        checked={settings.hideRailQuickActions}
        onChange={(v) => onUpdate({ hideRailQuickActions: v })}
      />
      <div className="grid grid-cols-2 gap-1.5">
        {orderedSections.map((section) => {
          const isHidden = hidden.has(section.id);
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => toggleSection(section.id)}
              className={`rounded border px-2 py-1.5 text-left text-[10px] transition-colors ${
                isHidden
                  ? "border-border bg-bg/40 text-fg/35 line-through"
                  : "border-primary/25 bg-primary/10 text-primary"
              }`}
              title={
                isHidden ? `Show ${section.label}` : `Hide ${section.label}`
              }
            >
              {section.label}
            </button>
          );
        })}
      </div>
      {settings.railSectionOrder.length > 0 && (
        <button
          type="button"
          onClick={() => onUpdate({ railSectionOrder: [] })}
          className="w-full rounded border border-border/60 bg-bg/35 px-2 py-1.5 text-left text-[10px] text-fg/55 transition-colors hover:bg-accent/35 hover:text-fg"
        >
          Reset rail order
        </button>
      )}
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled = false,
  loading = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  loading?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="text-[11px] text-fg/70">{label}</div>
        <div className="text-[9px] text-fg/30">{description}</div>
      </div>
      {loading && <LoadingGlyph label={`${label} loading`} />}
      <label
        className={`relative inline-flex items-center flex-shrink-0 ${disabled ? "cursor-wait opacity-70" : "cursor-pointer"}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => onChange(!checked)}
          className="sr-only peer"
        />
        <div className="w-7 h-4 rounded-full border border-border bg-secondary/50 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-success/40 peer-checked:border-success/70 peer-checked:bg-success/80 after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:h-2.5 after:w-2.5 after:rounded-full after:bg-fg/55 after:shadow-sm after:transition-all after:duration-150 peer-checked:after:translate-x-3 peer-checked:after:bg-white" />
      </label>
    </div>
  );
}

function LoadingGlyph({ label }: { label: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-3 w-3 flex-shrink-0 animate-spin rounded-full border border-current border-t-transparent"
    />
  );
}
