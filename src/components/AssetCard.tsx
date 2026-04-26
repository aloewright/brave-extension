import type { ScannedAsset } from "../types"

interface Props {
  asset: ScannedAsset
  onDownload?: (asset: ScannedAsset) => void
  onSave?: (asset: ScannedAsset) => void
}

export function AssetCard({ asset, onDownload, onSave }: Props) {
  const filename = filenameFromUrl(asset.url) || `${asset.type}.${defaultExt(asset.type)}`
  const label = asset.type.toUpperCase()

  return (
    <div className="flex items-center gap-2 p-2 rounded bg-card border border-border">
      <div className="w-10 h-10 rounded bg-bg flex-shrink-0 flex items-center justify-center overflow-hidden">
        {asset.type === "svg" && asset.inlineSvg ? (
          <div className="w-full h-full flex items-center justify-center text-fg/60" dangerouslySetInnerHTML={{ __html: scaledSvg(asset.inlineSvg) }} />
        ) : asset.type === "image" || asset.type === "svg" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[9px] uppercase tracking-wider text-fg/40">{label}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-fg/30">{label}</div>
        <div className="text-[11px] truncate font-mono text-fg/70" title={asset.url}>
          {filename}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {onDownload && (
          <button
            onClick={() => onDownload(asset)}
            title="Download"
            className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        )}
        {onSave && (
          <button
            onClick={() => onSave(asset)}
            title="Save to library"
            className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

function filenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url, location.href)
    const last = u.pathname.split("/").filter(Boolean).pop()
    return last || null
  } catch {
    return null
  }
}

function defaultExt(type: ScannedAsset["type"]): string {
  if (type === "image") return "png"
  if (type === "svg") return "svg"
  if (type === "lottie") return "json"
  if (type === "video") return "mp4"
  return "bin"
}

function scaledSvg(svg: string): string {
  return svg.replace(/<svg([^>]*)>/, '<svg$1 width="100%" height="100%" preserveAspectRatio="xMidYMid meet">')
}
