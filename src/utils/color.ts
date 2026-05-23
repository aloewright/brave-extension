import type { ColorFormat, RGBA } from "../types"

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#ff00ff",
  purple: "#800080",
  orange: "#ffa500",
  pink: "#ffc0cb",
  brown: "#a52a2a",
  transparent: "#00000000"
}

export function parseColor(input: string): RGBA | null {
  if (!input) return null
  const s = input.trim().toLowerCase()
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 }
  if (s in NAMED_COLORS) return parseHex(NAMED_COLORS[s])

  if (s.startsWith("#")) return parseHex(s)
  if (s.startsWith("rgb")) return parseRgb(s)
  if (s.startsWith("hsl")) return parseHsl(s)
  return null
}

function parseHex(hex: string): RGBA | null {
  const h = hex.replace(/^#/, "")
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: 1
    }
  }
  if (h.length === 4) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
      a: parseInt(h[3] + h[3], 16) / 255
    }
  }
  if (h.length === 6) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1
    }
  }
  if (h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255
    }
  }
  return null
}

function parseRgb(input: string): RGBA | null {
  const m = input.match(/rgba?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const r = parseChannel(parts[0])
  const g = parseChannel(parts[1])
  const b = parseChannel(parts[2])
  const a = parts[3] !== undefined ? parseAlpha(parts[3]) : 1
  if ([r, g, b, a].some((v) => Number.isNaN(v))) return null
  return { r, g, b, a }
}

function parseHsl(input: string): RGBA | null {
  const m = input.match(/hsla?\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const h = parseFloat(parts[0])
  const sStr = parts[1]
  const lStr = parts[2]
  const s = parseFloat(sStr) / 100
  const l = parseFloat(lStr) / 100
  const a = parts[3] !== undefined ? parseAlpha(parts[3]) : 1
  if ([h, s, l, a].some((v) => Number.isNaN(v))) return null

  const c = (1 - Math.abs(2 * l - 1)) * s
  const hh = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hh % 2) - 1))
  let r1 = 0
  let g1 = 0
  let b1 = 0
  if (hh < 1) [r1, g1, b1] = [c, x, 0]
  else if (hh < 2) [r1, g1, b1] = [x, c, 0]
  else if (hh < 3) [r1, g1, b1] = [0, c, x]
  else if (hh < 4) [r1, g1, b1] = [0, x, c]
  else if (hh < 5) [r1, g1, b1] = [x, 0, c]
  else [r1, g1, b1] = [c, 0, x]
  const m2 = l - c / 2
  return {
    r: Math.round((r1 + m2) * 255),
    g: Math.round((g1 + m2) * 255),
    b: Math.round((b1 + m2) * 255),
    a
  }
}

function parseChannel(s: string): number {
  if (s.endsWith("%")) return Math.round((parseFloat(s) / 100) * 255)
  return Math.round(parseFloat(s))
}

function parseAlpha(s: string): number {
  if (s.endsWith("%")) return parseFloat(s) / 100
  return parseFloat(s)
}

export function toHex(c: RGBA): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")
  if (c.a >= 1) return `#${h(c.r)}${h(c.g)}${h(c.b)}`
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${h(Math.round(c.a * 255))}`
}

export function toRgb(c: RGBA): string {
  if (c.a >= 1) return `rgb(${c.r}, ${c.g}, ${c.b})`
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${round(c.a, 3)})`
}

export function toHsl(c: RGBA): string {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      case b:
        h = (r - g) / d + 4
        break
    }
    h *= 60
  }
  const H = Math.round(h)
  const S = Math.round(s * 100)
  const L = Math.round(l * 100)
  if (c.a >= 1) return `hsl(${H}, ${S}%, ${L}%)`
  return `hsla(${H}, ${S}%, ${L}%, ${round(c.a, 3)})`
}

export function toOklch(c: RGBA): string {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  const r = lin(c.r)
  const g = lin(c.g)
  const b = lin(c.b)

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b

  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_

  const C = Math.sqrt(A * A + B * B)
  let H = (Math.atan2(B, A) * 180) / Math.PI
  if (H < 0) H += 360

  const Lp = round(L * 100, 2)
  const Cp = round(C, 4)
  const Hp = round(H, 2)

  if (c.a >= 1) return `oklch(${Lp}% ${Cp} ${Hp})`
  return `oklch(${Lp}% ${Cp} ${Hp} / ${round(c.a, 3)})`
}

export function formatColor(c: RGBA, format: ColorFormat): string {
  switch (format) {
    case "hex":
      return toHex(c)
    case "rgb":
      return toRgb(c)
    case "hsl":
      return toHsl(c)
    case "oklch":
      return toOklch(c)
  }
}

function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits)
  return Math.round(n * f) / f
}
