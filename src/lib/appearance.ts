import {
  DEFAULT_APPEARANCE,
  type AppearanceColorKey,
  type AppearanceSettings,
  type Settings,
  type ThemeName
} from "../types"

type PresetThemeName = Exclude<ThemeName, "custom">

export interface AppearancePreset {
  name: string
  description: string
  settings: AppearanceSettings
  swatches: string[]
  preview: string
}

const DARK = DEFAULT_APPEARANCE

export const APPEARANCE_PRESETS: Record<PresetThemeName, AppearancePreset> = {
  dark: {
    name: "Graphite",
    description: "The current low-glare Brave-style default.",
    settings: DARK,
    swatches: [DARK.background, DARK.card, DARK.primary, DARK.accent],
    preview: "linear-gradient(135deg, #313135, #4a4a4e)"
  },
  light: {
    name: "Paper",
    description: "Clean, pale, and readable in daylight.",
    settings: {
      ...DARK,
      background: "#f7f7f8",
      foreground: "#3b3b3f",
      card: "#ffffff",
      cardForeground: "#3b3b3f",
      popover: "#ffffff",
      popoverForeground: "#3b3b3f",
      primary: "#3b3b3f",
      primaryForeground: "#f7f7f8",
      secondary: "#e1e3e6",
      secondaryForeground: "#3b3b3f",
      muted: "#f1f2f4",
      mutedForeground: "#6e6e73",
      accent: "#eceef0",
      accentForeground: "#3b3b3f",
      destructive: "#f4a7a7",
      destructiveForeground: "#4a1515",
      border: "#e2e2e5",
      input: "#e2e2e5",
      sidebar: "#f1f2f4",
      sidebarForeground: "#3b3b3f",
      shadowOpacity: 0.05,
      backgroundStyle: "flat"
    },
    swatches: ["#f7f7f8", "#ffffff", "#3b3b3f", "#eceef0"],
    preview: "linear-gradient(135deg, #ffffff, #eceef0)"
  },
  aurora: {
    name: "Aurora",
    description: "Deep blue-black with green and cyan charge.",
    settings: {
      ...DARK,
      background: "#071411",
      foreground: "#e7fff4",
      card: "#10231f",
      cardForeground: "#e7fff4",
      popover: "#091916",
      popoverForeground: "#e7fff4",
      primary: "#7cf7b6",
      primaryForeground: "#06110e",
      secondary: "#15352e",
      secondaryForeground: "#d9fff0",
      muted: "#10231f",
      mutedForeground: "#8bb7a8",
      accent: "#2ee6d6",
      accentForeground: "#041312",
      destructive: "#e46f73",
      destructiveForeground: "#2d0708",
      border: "#1f4a42",
      input: "#17352f",
      sidebar: "#06100e",
      sidebarForeground: "#d9fff0",
      info: "#54c7ff",
      backgroundStyle: "glow"
    },
    swatches: ["#071411", "#10231f", "#7cf7b6", "#2ee6d6"],
    preview: "radial-gradient(circle at top left, #7cf7b6 0, transparent 42%), linear-gradient(135deg, #071411, #10231f)"
  },
  paper: {
    name: "Ledger",
    description: "Warm off-white, ink, and restrained brass.",
    settings: {
      ...DARK,
      background: "#f3ead8",
      foreground: "#2e261d",
      card: "#fff8ea",
      cardForeground: "#2e261d",
      popover: "#fff8ea",
      popoverForeground: "#2e261d",
      primary: "#7a4d1f",
      primaryForeground: "#fff8ea",
      secondary: "#ead8b6",
      secondaryForeground: "#2e261d",
      muted: "#eadfcb",
      mutedForeground: "#786653",
      accent: "#d6a84f",
      accentForeground: "#2e261d",
      destructive: "#b8604f",
      destructiveForeground: "#fff4ee",
      border: "#d8c6aa",
      input: "#e7d9c0",
      sidebar: "#eadcc4",
      sidebarForeground: "#2e261d",
      success: "#3f8f5d",
      warning: "#bd7b23",
      error: "#b84f48",
      info: "#3d78a8",
      shadowOpacity: 0.1,
      backgroundStyle: "grain"
    },
    swatches: ["#f3ead8", "#fff8ea", "#7a4d1f", "#d6a84f"],
    preview: "linear-gradient(135deg, #fff8ea, #eadcc4)"
  },
  ember: {
    name: "Ember",
    description: "Near-black graphite with hot amber focus states.",
    settings: {
      ...DARK,
      background: "#17120f",
      foreground: "#fff0dd",
      card: "#241b16",
      cardForeground: "#fff0dd",
      popover: "#1d1511",
      popoverForeground: "#fff0dd",
      primary: "#ffb35c",
      primaryForeground: "#1a0d05",
      secondary: "#35251d",
      secondaryForeground: "#ffead2",
      muted: "#2b211c",
      mutedForeground: "#c7a58b",
      accent: "#ff6b35",
      accentForeground: "#fff6ef",
      destructive: "#e05d5d",
      destructiveForeground: "#fff0f0",
      border: "#4a3328",
      input: "#35251d",
      sidebar: "#110d0b",
      sidebarForeground: "#ffead2",
      warning: "#ffca5c",
      info: "#75bfff",
      backgroundStyle: "glow"
    },
    swatches: ["#17120f", "#241b16", "#ffb35c", "#ff6b35"],
    preview: "radial-gradient(circle at top right, #ff6b35 0, transparent 46%), linear-gradient(135deg, #17120f, #241b16)"
  }
}

export const APPEARANCE_COLOR_FIELDS: Array<{ key: AppearanceColorKey; label: string }> = [
  { key: "background", label: "Background" },
  { key: "foreground", label: "Text" },
  { key: "card", label: "Cards" },
  { key: "cardForeground", label: "Card text" },
  { key: "sidebar", label: "Rail" },
  { key: "sidebarForeground", label: "Rail text" },
  { key: "primary", label: "Primary" },
  { key: "primaryForeground", label: "Primary text" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "muted", label: "Muted" },
  { key: "mutedForeground", label: "Muted text" },
  { key: "border", label: "Borders" },
  { key: "input", label: "Inputs" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Warning" },
  { key: "error", label: "Error" },
  { key: "info", label: "Info" }
]

const COLOR_TOKEN_MAP: Array<[AppearanceColorKey, string]> = [
  ["background", "background"],
  ["foreground", "foreground"],
  ["card", "card"],
  ["cardForeground", "card-foreground"],
  ["popover", "popover"],
  ["popoverForeground", "popover-foreground"],
  ["primary", "primary"],
  ["primaryForeground", "primary-foreground"],
  ["secondary", "secondary"],
  ["secondaryForeground", "secondary-foreground"],
  ["muted", "muted"],
  ["mutedForeground", "muted-foreground"],
  ["accent", "accent"],
  ["accentForeground", "accent-foreground"],
  ["destructive", "destructive"],
  ["destructiveForeground", "destructive-foreground"],
  ["border", "border"],
  ["input", "input"],
  ["sidebar", "sidebar"],
  ["sidebarForeground", "sidebar-foreground"],
  ["success", "success"],
  ["warning", "warning"],
  ["error", "error"],
  ["info", "info"]
]

export function cloneAppearance(settings: AppearanceSettings): AppearanceSettings {
  return { ...settings }
}

export function createCustomAppearance(
  base: AppearanceSettings,
  patch: Partial<AppearanceSettings>
): AppearanceSettings {
  return normalizeAppearance({ ...base, ...patch })
}

export function resolveAppearanceSettings(settings?: Partial<Settings> | null): AppearanceSettings {
  const theme = settings?.theme ?? "dark"
  const preset = theme !== "custom" ? APPEARANCE_PRESETS[theme as PresetThemeName] : undefined
  return normalizeAppearance({
    ...DEFAULT_APPEARANCE,
    ...(preset?.settings ?? settings?.appearance ?? {})
  })
}

export function applyAppearanceSettings(settings?: Partial<Settings> | null): void {
  if (typeof document === "undefined") return

  const appearance = resolveAppearanceSettings(settings)
  const root = document.documentElement

  for (const [key, token] of COLOR_TOKEN_MAP) {
    root.style.setProperty(`--${token}`, hexToRgbTriplet(appearance[key]))
  }

  root.style.setProperty("--radius", `${appearance.radius}px`)
  root.style.setProperty("--shadow-opacity", String(appearance.shadowOpacity))
  root.style.setProperty("--app-font-scale", String(appearance.fontScale))
  root.style.setProperty("--app-font-family", appearance.fontFamily)
  root.style.setProperty("--app-mono-font-family", appearance.monoFontFamily)
  root.style.setProperty("--app-background", buildBackground(appearance))
  root.dataset.appTheme = settings?.theme ?? "dark"
  root.dataset.appDensity = appearance.density
  root.dataset.appBackground = appearance.backgroundStyle
}

export function normalizeHexColor(value: unknown, fallback = "#000000"): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`
  }
  return fallback
}

function normalizeAppearance(value: AppearanceSettings): AppearanceSettings {
  const next = { ...DEFAULT_APPEARANCE, ...value }
  for (const [key] of COLOR_TOKEN_MAP) {
    next[key] = normalizeHexColor(next[key], DEFAULT_APPEARANCE[key])
  }
  next.radius = clampNumber(next.radius, 0, 28, DEFAULT_APPEARANCE.radius)
  next.shadowOpacity = clampNumber(next.shadowOpacity, 0, 0.8, DEFAULT_APPEARANCE.shadowOpacity)
  next.fontScale = clampNumber(next.fontScale, 0.75, 1.35, DEFAULT_APPEARANCE.fontScale)
  if (!["compact", "comfortable", "spacious"].includes(next.density)) {
    next.density = DEFAULT_APPEARANCE.density
  }
  if (!["flat", "glow", "grain"].includes(next.backgroundStyle)) {
    next.backgroundStyle = DEFAULT_APPEARANCE.backgroundStyle
  }
  next.fontFamily = next.fontFamily?.trim() || DEFAULT_APPEARANCE.fontFamily
  next.monoFontFamily = next.monoFontFamily?.trim() || DEFAULT_APPEARANCE.monoFontFamily
  return next
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function hexToRgbTriplet(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  return `${r} ${g} ${b}`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex)
  const raw = normalized.slice(1)
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16)
  }
}

function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function buildBackground(appearance: AppearanceSettings): string {
  const base = `rgb(${hexToRgbTriplet(appearance.background)})`
  if (appearance.backgroundStyle === "flat") return base
  if (appearance.backgroundStyle === "grain") {
    return [
      `linear-gradient(135deg, ${rgba(appearance.foreground, 0.045)} 0 1px, transparent 1px 12px)`,
      `radial-gradient(circle at 18% 10%, ${rgba(appearance.primary, 0.14)}, transparent 34%)`,
      base
    ].join(", ")
  }
  return [
    `radial-gradient(circle at 12% 0%, ${rgba(appearance.primary, 0.22)}, transparent 38%)`,
    `radial-gradient(circle at 92% 8%, ${rgba(appearance.accent, 0.18)}, transparent 36%)`,
    `radial-gradient(circle at 50% 115%, ${rgba(appearance.info, 0.12)}, transparent 42%)`,
    base
  ].join(", ")
}
