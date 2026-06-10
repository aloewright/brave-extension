import { useEffect, useRef, useState } from "react"
import { InspectorPanel } from "../../components/InspectorPanel"
import type { ConsoleError } from "../../types"
import { NetworkPanel, useInfoPanels } from "../_lx/components/InfoPanels"

export function InspectorSection() {
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const info = useInfoPanels()

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return
      chrome.runtime.sendMessage(
        { type: "GET_CONSOLE_ERRORS", tabId: tab.id },
        (result) => {
          if (result?.errors?.length) setConsoleErrors(result.errors)
        }
      )
    })()
  }, [])

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setToast(label)
        setTimeout(() => setToast(null), 1500)
      },
      () => {
        setToast("Copy failed")
        setTimeout(() => setToast(null), 1500)
      }
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" data-testid="inspector-section">
      <div className="relative flex-shrink-0">
        <NetworkPanel userIp={info.userIp} siteIp={info.siteIp} onCopy={copy} />
        {toast && (
          <span className="absolute right-3 top-2 text-[10px] text-success/80">
            {toast}
          </span>
        )}
      </div>
      <ReverseImageSearchPanel />
      <div className="min-h-0 flex-1">
        <InspectorPanel
          consoleErrors={consoleErrors}
          onClose={() => {}}
          onSendToChat={() => {}}
        />
      </div>
    </div>
  )
}

type ReverseImageEngineId = "google" | "bing" | "yandex" | "baidu" | "tineye"

type ReverseImageEngine = {
  id: ReverseImageEngineId
  label: string
  buildUrl: (imageUrl: string) => string
}

type PageImageCandidate = {
  src: string
  alt: string
  width: number
  height: number
}

const REVERSE_IMAGE_ENGINES: ReverseImageEngine[] = [
  {
    id: "google",
    label: "Google Lens",
    buildUrl: (imageUrl) =>
      `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`
  },
  {
    id: "bing",
    label: "Bing",
    buildUrl: (imageUrl) =>
      `https://www.bing.com/images/search?view=detailv2&iss=sbiupload&FORM=SBIHMP&sbisrc=UrlPaste&q=${encodeURIComponent(
        `imgurl:${imageUrl}`
      )}`
  },
  {
    id: "yandex",
    label: "Yandex",
    buildUrl: (imageUrl) =>
      `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(imageUrl)}`
  },
  {
    id: "baidu",
    label: "Baidu",
    buildUrl: (imageUrl) =>
      `https://graph.baidu.com/details?isfromtusoupc=1&tn=pc&carousel=0&image=${encodeURIComponent(
        imageUrl
      )}`
  },
  {
    id: "tineye",
    label: "TinEye",
    buildUrl: (imageUrl) =>
      `https://tineye.com/search?url=${encodeURIComponent(imageUrl)}`
  }
]

function ReverseImageSearchPanel() {
  const [images, setImages] = useState<PageImageCandidate[]>([])
  const [selectedImageUrl, setSelectedImageUrl] = useState("")
  const [manualUrl, setManualUrl] = useState("")
  const mountedRef = useRef(true)
  const [enabledEngines, setEnabledEngines] = useState<ReverseImageEngineId[]>(
    REVERSE_IMAGE_ENGINES.map((engine) => engine.id)
  )
  const [status, setStatus] = useState<string | null>("Scanning page images...")

  const scanPageImages = () => {
    setStatus("Scanning page images...")
    void loadPageImages(
      (nextImages) => {
        if (mountedRef.current) setImages(nextImages)
      },
      (nextUrl) => {
        if (mountedRef.current) setSelectedImageUrl(nextUrl)
      },
      (nextStatus) => {
        if (mountedRef.current) setStatus(nextStatus)
      }
    )
  }

  useEffect(() => {
    mountedRef.current = true
    scanPageImages()
    return () => {
      mountedRef.current = false
    }
  }, [])

  const searchUrl = manualUrl.trim() || selectedImageUrl
  const selectedEngines = REVERSE_IMAGE_ENGINES.filter((engine) =>
    enabledEngines.includes(engine.id)
  )

  const toggleEngine = (engineId: ReverseImageEngineId) => {
    setEnabledEngines((current) =>
      current.includes(engineId)
        ? current.filter((id) => id !== engineId)
        : [...current, engineId]
    )
  }

  const openReverseSearches = () => {
    if (!isSearchableImageUrl(searchUrl)) {
      setStatus("Paste or select a public http(s) image URL first")
      return
    }
    if (selectedEngines.length === 0) {
      setStatus("Choose at least one search engine")
      return
    }

    selectedEngines.forEach((engine) => {
      void chrome.tabs.create({
        active: false,
        url: engine.buildUrl(searchUrl)
      }).catch(() => {
        setStatus(`Could not open ${engine.label}`)
      })
    })
    setStatus(`Opened ${selectedEngines.length} reverse image search tab${selectedEngines.length === 1 ? "" : "s"}`)
  }

  return (
    <div className="flex-shrink-0 border-b border-border bg-bg-alt/80 px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <p className="text-[10px] text-fg/30 uppercase tracking-wider">
            Reverse image search
          </p>
          <p className="text-[11px] text-fg/40 mt-0.5">
            Verify a page image across major image engines.
          </p>
        </div>
        <button
          className="rounded border border-border bg-card/60 px-2 py-1 text-[10px] text-fg/60 hover:text-fg hover:bg-card"
          onClick={scanPageImages}
          type="button">
          Rescan
        </button>
      </div>

      <input
        className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none placeholder:text-fg/25 focus:border-chart-1/70"
        onChange={(event) => setManualUrl(event.target.value)}
        placeholder="Paste image URL, or choose a detected image below"
        type="url"
        value={manualUrl}
      />

      {images.length > 0 ? (
        <select
          className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none focus:border-chart-1/70"
          disabled={Boolean(manualUrl.trim())}
          onChange={(event) => setSelectedImageUrl(event.target.value)}
          value={selectedImageUrl}>
          {images.map((image) => (
            <option key={image.src} value={image.src}>
              {formatImageCandidate(image)}
            </option>
          ))}
        </select>
      ) : (
        <div className="rounded border border-border/70 bg-card/30 px-2 py-2 text-[11px] text-fg/35">
          No public image URLs detected on this page yet.
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {REVERSE_IMAGE_ENGINES.map((engine) => {
          const active = enabledEngines.includes(engine.id)
          return (
            <button
              className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
                active
                  ? "border-chart-1/50 bg-chart-1/15 text-chart-1"
                  : "border-border bg-card/30 text-fg/35 hover:text-fg/70"
              }`}
              key={engine.id}
              onClick={() => toggleEngine(engine.id)}
              type="button">
              {engine.label}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded bg-chart-1 px-2.5 py-1.5 text-[11px] font-medium text-bg hover:bg-chart-1/90 disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!searchUrl}
          onClick={openReverseSearches}
          type="button">
          Search selected engines
        </button>
        {status && <span className="min-w-0 flex-1 truncate text-[10px] text-fg/35">{status}</span>}
      </div>
    </div>
  )
}

async function loadPageImages(
  setImages: (images: PageImageCandidate[]) => void,
  setSelectedImageUrl: (url: string) => void,
  setStatus: (status: string | null) => void
) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    setStatus("No active tab found")
    return
  }
  if (!chrome.scripting?.executeScript) {
    setStatus("Page image scanning is unavailable here")
    return
  }

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: () => {
        const seen = new Set<string>()
        return Array.from(document.images)
          .map((image) => ({
            alt: image.alt || image.getAttribute("aria-label") || "",
            height: image.naturalHeight || image.height || 0,
            src: image.currentSrc || image.src || "",
            width: image.naturalWidth || image.width || 0
          }))
          .filter((image) => {
            if (!image.src || seen.has(image.src)) return false
            seen.add(image.src)
            try {
              const parsed = new URL(image.src, window.location.href)
              image.src = parsed.href
              return parsed.protocol === "http:" || parsed.protocol === "https:"
            } catch {
              return false
            }
          })
          .sort((left, right) => right.width * right.height - left.width * left.height)
          .slice(0, 30)
      }
    },
    (results) => {
      if (chrome.runtime.lastError) {
        setStatus("Could not scan this page for images")
        return
      }
      const detectedImages = results?.[0]?.result ?? []
      setImages(detectedImages)
      setSelectedImageUrl(detectedImages[0]?.src ?? "")
      setStatus(
        detectedImages.length
          ? `Found ${detectedImages.length} page image${detectedImages.length === 1 ? "" : "s"}`
          : "No public image URLs detected"
      )
    }
  )
}

function isSearchableImageUrl(url: string) {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function formatImageCandidate(image: PageImageCandidate) {
  const size = image.width && image.height ? `${image.width}x${image.height}` : "unknown size"
  const label = image.alt || image.src
  return `${size} - ${label.slice(0, 82)}`
}
