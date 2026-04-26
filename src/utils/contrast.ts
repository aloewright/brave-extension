import type { RGBA } from "../types"

import { parseColor } from "./color"

export function relativeLuminance(c: RGBA): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  }
  const r = lin(c.r)
  const g = lin(c.g)
  const b = lin(c.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export interface WCAGResult {
  ratio: number
  AAlarge: boolean
  AAnormal: boolean
  AAAlarge: boolean
  AAAnormal: boolean
}

export function evaluateContrast(fg: RGBA, bg: RGBA): WCAGResult {
  const ratio = contrastRatio(fg, bg)
  return {
    ratio,
    AAlarge: ratio >= 3,
    AAnormal: ratio >= 4.5,
    AAAlarge: ratio >= 4.5,
    AAAnormal: ratio >= 7
  }
}

export function evaluateContrastFromStrings(fg: string, bg: string): WCAGResult | null {
  const f = parseColor(fg)
  const b = parseColor(bg)
  if (!f || !b) return null
  return evaluateContrast(f, b)
}
