import { parseColor, toHex } from "../utils/color"

export interface SavedColor {
  id: string
  hex: string
  createdAt: number
}

export const EYEDROPPER_SAVED_COLORS_KEY = "eyedropper.savedColors.v1"
export const EYEDROPPER_SAVED_COLORS_LIMIT = 12

function hasStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local
}

export function normalizeSavedColor(input: string): string | null {
  const parsed = parseColor(input)
  if (!parsed) return null
  return toHex(parsed).toLowerCase()
}

export async function getSavedColors(): Promise<SavedColor[]> {
  if (!hasStorage()) return []
  const got = await chrome.storage.local.get(EYEDROPPER_SAVED_COLORS_KEY)
  const raw = got[EYEDROPPER_SAVED_COLORS_KEY]
  if (!Array.isArray(raw)) return []
  return dedupeSavedColors(raw.filter(isSavedColor))
}

export async function savePickedColor(input: string): Promise<SavedColor[]> {
  const hex = normalizeSavedColor(input)
  if (!hex) return getSavedColors()

  const existing = await getSavedColors()
  const next: SavedColor = {
    id: hex,
    hex,
    createdAt: Date.now()
  }
  const capped = [next, ...existing.filter((item) => item.hex !== hex)].slice(
    0,
    EYEDROPPER_SAVED_COLORS_LIMIT
  )
  await chrome.storage.local.set({ [EYEDROPPER_SAVED_COLORS_KEY]: capped })
  return capped
}

function dedupeSavedColors(colors: SavedColor[]): SavedColor[] {
  const seen = new Set<string>()
  const next: SavedColor[] = []
  for (const color of colors) {
    if (seen.has(color.hex)) continue
    seen.add(color.hex)
    next.push(color)
  }
  return next.slice(0, EYEDROPPER_SAVED_COLORS_LIMIT)
}

function isSavedColor(value: unknown): value is SavedColor {
  if (!value || typeof value !== "object") return false
  const color = value as SavedColor
  return (
    typeof color.id === "string" &&
    typeof color.hex === "string" &&
    typeof color.createdAt === "number"
  )
}
