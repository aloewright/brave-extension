import { useEffect, useState } from "react"

import { getCachedScan, setCachedScan } from "../storage"
import type {
  InspectorMessage,
  InspectorSettings,
  ScanResult,
  ScannedAsset
} from "../types"
import { getActiveTab, sendToTab } from "../utils/messaging"
import { buildZip, dataUrlToBytes, textEntry } from "../utils/zip"
import { AssetCard } from "./AssetCard"
import { ColorFormatToggle } from "./ColorFormatToggle"
import { ColorSwatch } from "./ColorSwatch"
import { EmptyState } from "./EmptyState"
import { FontCard } from "./FontCard"
import { TokensPanel } from "./TokensPanel"

interface Props {
  settings: InspectorSettings
  onToast: (msg: string) => void
}

export function ScanTab({ settings, onToast }: Props) {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [cachedAt, setCachedAt] = useState<string | null>(null)
  const [colorFormat, setColorFormat] = useState(settings.colorFormat)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const tab = await getActiveTab()
      if (cancelled || !tab?.url) return
      const cached = await getCachedScan(tab.url)
      if (cancelled || !cached) return
      setScan(cached.result)
      setCachedAt(cached.cachedAt)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const runScan = async () => {
    const tab = await getActiveTab()
    if (!tab?.id) return onToast("No active tab")
    setBusy(true)
    const resp = await sendToTab<{ ok: boolean; result?: ScanResult; error?: string }>(
      tab.id,
      { type: "scan:run" } satisfies InspectorMessage
    )
    setBusy(false)
    if (!resp || !resp.ok || !resp.result) {
      onToast("Scan failed — try reloading the page")
      return
    }
    setScan(resp.result)
    setCachedAt(new Date().toISOString())
    await setCachedScan(resp.result)
    onToast(`Scanned ${resp.result.colors.length} colors · ${resp.result.assets.length} assets`)
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    onToast("Copied")
  }

  const downloadAsset = async (asset: ScannedAsset) => {
    if (asset.inlineSvg) {
      const blob = new Blob([asset.inlineSvg], { type: "image/svg+xml" })
      const url = URL.createObjectURL(blob)
      await chrome.downloads.download({ url, filename: `inline-${Date.now()}.svg` })
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      onToast("Downloaded SVG")
      return
    }
    await chrome.downloads.download({ url: asset.url })
  }

  const downloadAll = async () => {
    if (!scan) return
    if (scan.assets.length === 0) return onToast("No assets")
    const tab = await getActiveTab()
    if (!tab?.id) return onToast("No active tab")
    const tabId = tab.id
    setBusy(true)

    // Inline SVGs go straight in — no network needed.
    const entries: { name: string; data: Uint8Array }[] = []
    const remoteAssets: ScannedAsset[] = []
    for (const asset of scan.assets) {
      if (asset.inlineSvg) {
        entries.push(textEntry(`svg/inline-${entries.length + 1}.svg`, asset.inlineSvg))
      } else {
        remoteAssets.push(asset)
      }
    }

    // Parallel-fetch with a bounded worker pool. Each fetch in the content
    // script is wrapped in a per-asset timeout, so a hung CDN can't stall
    // the whole zip.
    const CONCURRENCY = 6
    const fetched: { name: string; data: Uint8Array }[] = []
    let skipped = 0
    let cursor = 0

    async function worker() {
      while (cursor < remoteAssets.length) {
        const asset = remoteAssets[cursor++]
        const resp = await sendToTab<{ ok: boolean; dataUrl: string | null }>(tabId, {
          type: "asset:fetch",
          url: asset.url
        } satisfies InspectorMessage)
        if (!resp?.dataUrl) {
          skipped += 1
          continue
        }
        fetched.push({ name: filenameFor(asset), data: dataUrlToBytes(resp.dataUrl) })
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY, remoteAssets.length) },
      () => worker()
    )
    await Promise.all(workers)

    entries.push(...fetched)

    if (entries.length === 0) {
      setBusy(false)
      return onToast("All assets blocked by CORS")
    }

    const zip = buildZip(entries)
    const blob = new Blob([zip as BlobPart], { type: "application/zip" })
    const url = URL.createObjectURL(blob)
    const filename = `inspector-${hostname(scan.url)}-${Date.now()}.zip`
    await chrome.downloads.download({ url, filename })
    setTimeout(() => URL.revokeObjectURL(url), 8000)
    setBusy(false)
    onToast(`Zipped ${entries.length}${skipped ? ` (${skipped} skipped)` : ""}`)
  }

  return (
    <div className="p-3 space-y-3">
      <button
        onClick={runScan}
        disabled={busy}
        className="w-full text-xs py-2 px-3 rounded bg-chart-1 text-white font-medium border border-white/40 shadow-sm transition-all duration-150 hover:bg-chart-1/90 hover:border-white/70 hover:shadow-md hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-sm">
        {busy ? "Working…" : scan ? "Rescan this page" : "Scan this page"}
      </button>

      {!scan && (
        <EmptyState
          title="No scan yet"
          hint="Scan extracts every color, font, asset, and spacing value."
        />
      )}

      {scan && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-mono text-fg/50 truncate">{hostname(scan.url)}</div>
              {cachedAt && (
                <div className="text-[10px] text-fg/30">scanned {relativeTime(cachedAt)}</div>
              )}
            </div>
            <ColorFormatToggle value={colorFormat} onChange={setColorFormat} />
          </div>

          <Section title={`Colors (${scan.colors.length})`}>
            <div className="space-y-1.5">
              {scan.colors.slice(0, 32).map((c) => (
                <ColorSwatch
                  key={c.value}
                  value={c.value}
                  format={colorFormat}
                  count={c.count}
                  onCopy={copy}
                />
              ))}
            </div>
          </Section>

          <Section title={`Fonts (${scan.fonts.length})`}>
            <div className="space-y-1.5">
              {scan.fonts.slice(0, 12).map((f) => (
                <FontCard
                  key={f.family}
                  family={f.family}
                  size={f.sizes[0]}
                  weight={f.weights[0]}
                  count={f.count}
                  onCopy={copy}
                />
              ))}
            </div>
          </Section>

          <Section title="Tokens">
            <TokensPanel
              scan={scan}
              defaultFormat={settings.exportDefaults.tokenFormat}
              includeSpacing={settings.exportDefaults.includeSpacing}
              includeFonts={settings.exportDefaults.includeFonts}
              onCopy={copy}
            />
          </Section>

          <Section title={`Assets (${scan.assets.length})`}>
            <div className="space-y-1.5">
              {scan.assets.slice(0, 30).map((a, i) => (
                <AssetCard key={`${a.url}-${i}`} asset={a} onDownload={downloadAsset} />
              ))}
            </div>
            {scan.assets.length > 0 && (
              <button
                onClick={downloadAll}
                disabled={busy}
                className="mt-2 w-full text-xs py-1.5 px-3 rounded bg-chart-1/20 text-chart-1 hover:bg-chart-1/30 disabled:opacity-50 transition-colors">
                {busy ? "Zipping…" : `Download all assets (zip)`}
              </button>
            )}
          </Section>

          <Section title={`Spacing (${scan.spacing.length})`}>
            <div className="grid grid-cols-2 gap-1.5">
              {scan.spacing.slice(0, 16).map((s) => (
                <button
                  key={s.value}
                  onClick={() => copy(s.value)}
                  className="px-2 py-1 rounded bg-card border border-border hover:border-accent text-[11px] font-mono text-fg/70 flex items-center justify-between">
                  <span>{s.value}</span>
                  <span className="text-[10px] text-fg/30">×{s.count}</span>
                </button>
              ))}
            </div>
          </Section>
        </>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-wider text-fg/40 mb-1.5">{title}</div>
      {children}
    </section>
  )
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "page"
  }
}

function filenameFor(asset: ScannedAsset): string {
  try {
    const u = new URL(asset.url)
    const last = u.pathname.split("/").filter(Boolean).pop()
    if (last) return last
  } catch {
    /* fall through */
  }
  const ext =
    asset.type === "svg"
      ? "svg"
      : asset.type === "lottie"
        ? "json"
        : asset.type === "video"
          ? "mp4"
          : "bin"
  return `${asset.type}-${Math.random().toString(36).slice(2, 8)}.${ext}`
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 30) return "just now"
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
