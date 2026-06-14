import type { InspectorMessage, ScanResult, ScannedAsset } from "../types"
import { collectFromDocument } from "../utils/assets"

const NODE_CAP = 8000
const CHUNK_SIZE = 500
const TRANSPARENT = "rgba(0, 0, 0, 0)"
const FETCH_TIMEOUT_MS = 8000

const SPACING_PROPS = [
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "gap"
] as const

function isVisible(el: Element, cs: CSSStyleDeclaration): boolean {
  if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false
  const r = (el as HTMLElement).getBoundingClientRect?.()
  if (!r) return true
  return r.width > 0 && r.height > 0
}

function bumpCount(map: Map<string, number>, key: string) {
  if (!key) return
  map.set(key, (map.get(key) ?? 0) + 1)
}

function bumpFont(
  map: Map<string, { family: string; sizes: Set<string>; weights: Set<string>; count: number }>,
  family: string,
  size: string,
  weight: string
) {
  if (!family) return
  const existing =
    map.get(family) ?? { family, sizes: new Set<string>(), weights: new Set<string>(), count: 0 }
  if (size) existing.sizes.add(size)
  if (weight) existing.weights.add(weight)
  existing.count += 1
  map.set(family, existing)
}

// Yield to the main thread between chunks. Uses requestIdleCallback when
// available so the scan piggybacks on idle frames; falls back to a 0ms
// setTimeout to defer to the next macrotask.
type IdleDeadlineLike = { timeRemaining: () => number }
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as unknown as {
      requestIdleCallback?: (cb: (d: IdleDeadlineLike) => void, opts?: { timeout: number }) => number
    }).requestIdleCallback
    if (typeof ric === "function") {
      ric(() => resolve(), { timeout: 50 })
    } else {
      setTimeout(resolve, 0)
    }
  })
}

async function runScan(): Promise<ScanResult> {
  const colorCounts = new Map<string, number>()
  const fontMap = new Map<
    string,
    { family: string; sizes: Set<string>; weights: Set<string>; count: number }
  >()
  const spacingCounts = new Map<string, number>()
  const shadowHosts: Element[] = []

  const all = document.querySelectorAll("*")
  const limit = Math.min(all.length, NODE_CAP)

  for (let i = 0; i < limit; i++) {
    if (i > 0 && i % CHUNK_SIZE === 0) await yieldToMain()
    const el = all[i]
    let cs: CSSStyleDeclaration
    try {
      cs = window.getComputedStyle(el)
    } catch {
      // Detached or pseudo-host elements occasionally throw — skip.
      continue
    }
    if (!isVisible(el, cs)) continue

    if (cs.color) bumpCount(colorCounts, cs.color)
    if (cs.backgroundColor && cs.backgroundColor !== TRANSPARENT)
      bumpCount(colorCounts, cs.backgroundColor)
    if (cs.borderTopColor && parseFloat(cs.borderTopWidth) > 0)
      bumpCount(colorCounts, cs.borderTopColor)

    bumpFont(fontMap, cs.fontFamily, cs.fontSize, cs.fontWeight)

    for (const side of SPACING_PROPS) {
      const v = cs.getPropertyValue(side)
      if (v && v !== "0px" && v !== "normal") bumpCount(spacingCounts, v)
    }

    // Cache shadow hosts during this single pass — avoids a second
    // querySelectorAll("*") for asset collection.
    const host = el as Element & { shadowRoot?: ShadowRoot }
    if (host.shadowRoot) shadowHosts.push(el)
  }

  await yieldToMain()
  const assets: ScannedAsset[] = collectFromDocument(document)
  for (const host of shadowHosts) {
    const sr = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot
    if (!sr) continue
    for (const a of collectFromDocument(sr as unknown as Document)) {
      assets.push(a)
    }
  }

  return {
    url: location.href,
    title: document.title,
    scannedAt: new Date().toISOString(),
    colors: [...colorCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    fonts: [...fontMap.values()]
      .map((f) => ({ family: f.family, sizes: [...f.sizes], weights: [...f.weights], count: f.count }))
      .sort((a, b) => b.count - a.count),
    spacing: [...spacingCounts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    assets
  }
}

chrome.runtime.onMessage.addListener((message: InspectorMessage, _sender, sendResponse) => {
  if (message.type === "scan:run") {
    runScan().then(
      (result) => {
        sendResponse({ ok: true, result })
        try {
          chrome.runtime.sendMessage({
            type: "scan:result",
            payload: result
          } satisfies InspectorMessage)
        } catch {
          /* panel may be closed */
        }
      },
      (err) => sendResponse({ ok: false, error: (err as Error).message })
    )
    return true
  }
  if (message.type === "asset:fetch") {
    // Always sendResponse, even on error/timeout — otherwise the caller's
    // sendMessage promise hangs forever and the bulk-zip pipeline stalls.
    fetchAsset(message.url)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch(() => sendResponse({ ok: true, dataUrl: null }))
    return true
  }
})

async function fetchAsset(url: string): Promise<string | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
