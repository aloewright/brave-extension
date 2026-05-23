import type { ScanResult, TokenFormat } from "../types"

import { parseColor, toHex } from "./color"

export interface TokenInputs {
  colors: string[]
  fonts: { family: string; sizes: string[]; weights: string[] }[]
  spacing: string[]
  includeSpacing: boolean
  includeFonts: boolean
}

export function inputsFromScan(scan: ScanResult, includeSpacing = true, includeFonts = true): TokenInputs {
  return {
    colors: scan.colors.map((c) => c.value),
    fonts: scan.fonts.map((f) => ({ family: f.family, sizes: f.sizes, weights: f.weights })),
    spacing: scan.spacing.map((s) => s.value),
    includeSpacing,
    includeFonts
  }
}

export function generateTokens(inputs: TokenInputs, format: TokenFormat): string {
  switch (format) {
    case "tailwind":
      return generateTailwindTheme(inputs)
    case "css":
      return generateCssVars(inputs)
    case "json":
      return generateJson(inputs)
  }
}

function normalizeColors(colors: string[]): { name: string; hex: string }[] {
  const seen = new Set<string>()
  const out: { name: string; hex: string }[] = []
  let i = 1
  for (const raw of colors) {
    const parsed = parseColor(raw)
    if (!parsed) continue
    const hex = toHex(parsed).toLowerCase()
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push({ name: `color-${i}`, hex })
    i++
  }
  return out
}

function generateTailwindTheme(inputs: TokenInputs): string {
  const lines: string[] = ["@theme {"]
  const palette = normalizeColors(inputs.colors)
  for (const { name, hex } of palette) {
    lines.push(`  --${name}: ${hex};`)
  }
  if (inputs.includeFonts) {
    inputs.fonts.forEach((f, idx) => {
      const safe = sanitize(f.family) || `font-${idx + 1}`
      lines.push(`  --font-${safe}: ${f.family};`)
    })
  }
  if (inputs.includeSpacing) {
    inputs.spacing.forEach((value, idx) => {
      lines.push(`  --spacing-${idx + 1}: ${value};`)
    })
  }
  lines.push("}")
  return lines.join("\n")
}

function generateCssVars(inputs: TokenInputs): string {
  const lines: string[] = [":root {"]
  const palette = normalizeColors(inputs.colors)
  for (const { name, hex } of palette) {
    lines.push(`  --${name}: ${hex};`)
  }
  if (inputs.includeFonts) {
    inputs.fonts.forEach((f, idx) => {
      const safe = sanitize(f.family) || `font-${idx + 1}`
      lines.push(`  --font-${safe}: ${f.family};`)
    })
  }
  if (inputs.includeSpacing) {
    inputs.spacing.forEach((value, idx) => {
      lines.push(`  --spacing-${idx + 1}: ${value};`)
    })
  }
  lines.push("}")
  return lines.join("\n")
}

function generateJson(inputs: TokenInputs): string {
  const palette = normalizeColors(inputs.colors)
  const obj: Record<string, unknown> = {
    colors: Object.fromEntries(palette.map(({ name, hex }) => [name, { value: hex }]))
  }
  if (inputs.includeFonts) {
    obj.fonts = inputs.fonts.map((f) => ({
      family: f.family,
      sizes: f.sizes,
      weights: f.weights
    }))
  }
  if (inputs.includeSpacing) {
    obj.spacing = inputs.spacing.map((value, idx) => ({ name: `spacing-${idx + 1}`, value }))
  }
  return JSON.stringify(obj, null, 2)
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
