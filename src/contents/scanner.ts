import type { PlasmoCSConfig } from "plasmo"

import type { InspectorMessage, ScanResult, ScannedAsset } from "../types"
import { collectFromDocument } from "../utils/assets"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false
}

const NODE_CAP = 20000
const TRANSPARENT = "rgba(0, 0, 0, 0)"

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
  const existing = map.get(family) ?? { family, sizes: new Set<string>(), weights: new Set<string>(), count: 0 }
  if (size) existing.sizes.add(size)
  if (weight) existing.weights.add(weight)
  existing.count += 1
  map.set(family, existing)
}

function runScan(): ScanResult {
  const colorCounts = new Map<string, number>()
  const fontMap = new Map<string, { family: string; sizes: Set<string>; weights: Set<string>; count: number }>()
  const spacingCounts = new Map<string, number>()

  const all = document.querySelectorAll("*")
  const limit = Math.min(all.length, NODE_CAP)

  for (let i = 0; i < limit; i++) {
    const el = all[i]
    const cs = window.getComputedStyle(el)
    if (!isVisible(el, cs)) continue

    if (cs.color) bumpCount(colorCounts, cs.color)
    if (cs.backgroundColor && cs.backgroundColor !== TRANSPARENT) bumpCount(colorCounts, cs.backgroundColor)
    if (cs.borderTopColor && parseFloat(cs.borderTopWidth) > 0) bumpCount(colorCounts, cs.borderTopColor)

    bumpFont(fontMap, cs.fontFamily, cs.fontSize, cs.fontWeight)

    for (const side of ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-right", "margin-bottom", "margin-left", "gap"] as const) {
      const v = cs.getPropertyValue(side)
      if (v && v !== "0px" && v !== "normal") bumpCount(spacingCounts, v)
    }

    if ((el as Element & { shadowRoot?: ShadowRoot }).shadowRoot) {
      // shallow: collect inline svg from shadow roots; deep traversal omitted for cost
      ;(el as Element & { shadowRoot?: ShadowRoot }).shadowRoot!.querySelectorAll("svg").forEach(() => {
        // captured by collectFromDocument when run on shadowRoot below
      })
    }
  }

  const assets: ScannedAsset[] = collectFromDocument(document)
  document.querySelectorAll("*").forEach((el) => {
    const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot
    if (sr) {
      for (const a of collectFromDocument(sr as unknown as Document)) {
        assets.push(a)
      }
    }
  })

  return {
    url: location.href,
    title: document.title,
    scannedAt: new Date().toISOString(),
    colors: [...colorCounts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    fonts: [...fontMap.values()]
      .map((f) => ({ family: f.family, sizes: [...f.sizes], weights: [...f.weights], count: f.count }))
      .sort((a, b) => b.count - a.count),
    spacing: [...spacingCounts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
    assets
  }
}

chrome.runtime.onMessage.addListener((message: InspectorMessage, _sender, sendResponse) => {
  if (message.type === "scan:run") {
    try {
      const result = runScan()
      sendResponse({ ok: true, result })
      chrome.runtime.sendMessage({ type: "scan:result", payload: result } satisfies InspectorMessage)
    } catch (err) {
      sendResponse({ ok: false, error: (err as Error).message })
    }
    return
  }
  if (message.type === "asset:fetch") {
    fetchAsset(message.url).then((dataUrl) => {
      sendResponse({ ok: true, dataUrl })
    })
    return true
  }
})

async function fetchAsset(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
