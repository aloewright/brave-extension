import type { ScannedAsset } from "../types"

const LOTTIE_RE = /\.lottie(\?|$)/i
const LOTTIE_JSON_RE = /\.json(\?|$)/i

export function looksLikeLottieUrl(url: string, hint?: string): boolean {
  if (LOTTIE_RE.test(url)) return true
  if (LOTTIE_JSON_RE.test(url) && hint && /lottie|bodymovin/i.test(hint)) return true
  return false
}

export function collectFromDocument(doc: Document): ScannedAsset[] {
  const assets: ScannedAsset[] = []
  const seen = new Set<string>()

  doc.querySelectorAll("img").forEach((img) => {
    const src = (img as HTMLImageElement).currentSrc || (img as HTMLImageElement).src
    if (!src || seen.has(src)) return
    seen.add(src)
    const isSvg = /\.svg(\?|$)/i.test(src)
    assets.push({
      type: isSvg ? "svg" : "image",
      url: src,
      alt: (img as HTMLImageElement).alt || undefined,
      width: (img as HTMLImageElement).naturalWidth || undefined,
      height: (img as HTMLImageElement).naturalHeight || undefined
    })
  })

  doc.querySelectorAll("svg").forEach((svg) => {
    const serialized = svg.outerHTML
    const key = `inline:${serialized.slice(0, 80)}:${serialized.length}`
    if (seen.has(key)) return
    seen.add(key)
    assets.push({
      type: "svg",
      url: "inline-svg",
      inlineSvg: serialized
    })
  })

  doc.querySelectorAll("video").forEach((v) => {
    const src = (v as HTMLVideoElement).currentSrc || (v as HTMLVideoElement).src
    if (!src || seen.has(src)) return
    seen.add(src)
    assets.push({ type: "video", url: src })
  })

  doc.querySelectorAll("source").forEach((s) => {
    const src = (s as HTMLSourceElement).src
    if (!src || seen.has(src)) return
    seen.add(src)
    if (looksLikeLottieUrl(src)) {
      assets.push({ type: "lottie", url: src })
    }
  })

  doc.querySelectorAll("lottie-player, dotlottie-player").forEach((el) => {
    const src = (el as HTMLElement).getAttribute("src")
    if (!src || seen.has(src)) return
    seen.add(src)
    assets.push({ type: "lottie", url: src })
  })

  doc.querySelectorAll("script[src]").forEach((s) => {
    const src = (s as HTMLScriptElement).src
    if (!/lottie|bodymovin/i.test(src)) return
    doc.querySelectorAll("[data-animation], [data-bm-renderer]").forEach((el) => {
      const candidate = el.getAttribute("data-animation") || el.getAttribute("data-src")
      if (candidate && !seen.has(candidate)) {
        seen.add(candidate)
        assets.push({ type: "lottie", url: candidate })
      }
    })
  })

  return assets
}
