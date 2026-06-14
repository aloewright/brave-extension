import { useEffect, useRef, useState } from "react";
import { InspectorPanel } from "../../components/InspectorPanel";
import { LeoIcon } from "../../components/leo";
import type { ConsoleError } from "../../types";
import { NetworkPanel, useInfoPanels } from "../_lx/components/InfoPanels";
import { EyedropperSection } from "../eyedropper/EyedropperSection";

export function InspectorSection() {
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const info = useInfoPanels();

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      chrome.runtime.sendMessage(
        { type: "GET_CONSOLE_ERRORS", tabId: tab.id },
        (result) => {
          if (result?.errors?.length) setConsoleErrors(result.errors);
        },
      );
    })();
  }, []);

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setToast(label);
        setTimeout(() => setToast(null), 1500);
      },
      () => {
        setToast("Copy failed");
        setTimeout(() => setToast(null), 1500);
      },
    );
  };

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      data-testid="inspector-section"
    >
      <div className="relative flex-shrink-0">
        <NetworkPanel userIp={info.userIp} siteIp={info.siteIp} onCopy={copy} />
        {toast && (
          <span className="absolute right-3 top-2 text-[10px] text-success/80">
            {toast}
          </span>
        )}
      </div>
      <ReverseImageSearchPanel />
      <EyedropperSection embedded />
      <div className="min-h-0 flex-1">
        <InspectorPanel
          consoleErrors={consoleErrors}
          onClose={() => {}}
          onSendToChat={() => {}}
        />
      </div>
    </div>
  );
}

type ReverseImageEngineId = "google" | "bing" | "yandex" | "baidu" | "tineye";

type ReverseImageEngine = {
  id: ReverseImageEngineId;
  label: string;
  buildUrl: (imageUrl: string) => string;
};

type PageImageCandidate = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

type UploadedReverseImage = {
  name: string;
  size: number;
  dataUrl: string;
};

const REVERSE_IMAGE_ENGINES: ReverseImageEngine[] = [
  {
    id: "google",
    label: "Google Lens",
    buildUrl: (imageUrl) =>
      `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}`,
  },
  {
    id: "yandex",
    label: "Yandex",
    buildUrl: (imageUrl) =>
      `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(imageUrl)}`,
  },
  {
    id: "tineye",
    label: "TinEye",
    buildUrl: (imageUrl) =>
      `https://tineye.com/search?url=${encodeURIComponent(imageUrl)}`,
  },
];

const REVERSE_IMAGE_UPLOAD_TARGETS = [
  { label: "Google Lens", url: "https://lens.google.com/" },
  {
    label: "Bing Visual Search",
    url: "https://www.bing.com/images/search?view=detailv2&iss=sbiupload",
  },
  { label: "Yandex Images", url: "https://yandex.com/images/" },
  { label: "TinEye", url: "https://tineye.com/" },
  { label: "Baidu Image Search", url: "https://graph.baidu.com/" },
] as const;

const FRAGILE_IMAGE_URL_PATTERNS = [
  /googlevideo\.com/i,
  /blob:/i,
  /data:/i,
  /signature=/i,
  /expires?=/i,
  /x-amz-/i,
  /token=/i,
  /auth/i,
  /cdn-cgi/i,
];

function describeReverseImageUrlRisk(imageUrl: string): string | null {
  if (FRAGILE_IMAGE_URL_PATTERNS.some((pattern) => pattern.test(imageUrl))) {
    return "This image URL looks signed, private, or short-lived. Search engines may reject it; use capture fallback if providers show an error.";
  }

  try {
    const parsed = new URL(imageUrl);
    const extension = parsed.pathname.split(".").pop()?.toLowerCase();
    if (
      extension &&
      !["avif", "gif", "jpeg", "jpg", "png", "webp"].includes(extension)
    ) {
      return "This URL does not look like a direct image file. If providers fail, use capture fallback.";
    }
  } catch {
    return "This is not a valid image URL. Use capture fallback or paste a public image URL.";
  }

  return null;
}

function formatUploadedImageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReverseImageSearchPanel() {
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState<PageImageCandidate[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [uploadedImage, setUploadedImage] =
    useState<UploadedReverseImage | null>(null);
  const mountedRef = useRef(true);
  const hasScannedRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [enabledEngines, setEnabledEngines] = useState<ReverseImageEngineId[]>(
    REVERSE_IMAGE_ENGINES.map((engine) => engine.id),
  );
  const [status, setStatus] = useState<string | null>(null);

  const scanPageImages = () => {
    hasScannedRef.current = true;
    setStatus("Scanning page images...");
    void loadPageImages(
      (nextImages) => {
        if (mountedRef.current) setImages(nextImages);
      },
      (nextUrl) => {
        if (mountedRef.current) setSelectedImageUrl(nextUrl);
      },
      (nextStatus) => {
        if (mountedRef.current) setStatus(nextStatus);
      },
    );
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const toggleExpanded = () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (nextExpanded && !hasScannedRef.current) scanPageImages();
  };

  const searchUrl = manualUrl.trim() || selectedImageUrl;
  const urlWarning = searchUrl ? describeReverseImageUrlRisk(searchUrl) : null;
  const selectedEngines = REVERSE_IMAGE_ENGINES.filter((engine) =>
    enabledEngines.includes(engine.id),
  );

  const toggleEngine = (engineId: ReverseImageEngineId) => {
    setEnabledEngines((current) =>
      current.includes(engineId)
        ? current.filter((id) => id !== engineId)
        : [...current, engineId],
    );
  };

  const openReverseImageUploadPages = async (sourceLabel: string) => {
    const results = await Promise.allSettled(
      REVERSE_IMAGE_UPLOAD_TARGETS.map((target) =>
        chrome.tabs.create({ active: false, url: target.url }),
      ),
    );
    const opened = results.filter(
      (result) => result.status === "fulfilled",
    ).length;
    setStatus(
      `Opened ${opened} upload page${opened === 1 ? "" : "s"}. Upload ${sourceLabel} in the provider page.`,
    );
  };

  const handleUploadedImageFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Choose an image file");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setStatus("Could not read the image file");
        return;
      }
      setUploadedImage({
        dataUrl: reader.result,
        name: file.name,
        size: file.size,
      });
      setStatus(`Ready to search uploaded image: ${file.name}`);
    };
    reader.onerror = () => setStatus("Could not read the image file");
    reader.readAsDataURL(file);
  };

  const saveVisibleCaptureAndOpenUploadPages = async () => {
    setStatus("Capturing the visible page for upload fallback...");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.windowId) {
        setStatus("Could not find the active tab to capture");
        return;
      }

      chrome.tabs.captureVisibleTab(
        tab.windowId,
        { format: "png" },
        (dataUrl) => {
          const captureError = chrome.runtime.lastError;
          if (captureError || !dataUrl) {
            setStatus(
              `Capture failed: ${captureError?.message || "no image data returned"}`,
            );
            return;
          }

          const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
          chrome.downloads.download(
            {
              filename: `reverse-image-capture-${timestamp}.png`,
              saveAs: false,
              url: dataUrl,
            },
            () => {
              const downloadError = chrome.runtime.lastError;
              if (downloadError) {
                setStatus(`Capture save failed: ${downloadError.message}`);
                return;
              }

              void openReverseImageUploadPages("the downloaded PNG");
            },
          );
        },
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Capture fallback failed",
      );
    }
  };

  const copySelectedImageUrl = async () => {
    if (!searchUrl) {
      setStatus("Choose an image or paste a URL first");
      return;
    }

    try {
      await navigator.clipboard.writeText(searchUrl);
      setStatus("Copied the selected image URL");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Could not copy the selected image URL",
      );
    }
  };

  const openReverseSearches = () => {
    if (!isSearchableImageUrl(searchUrl)) {
      setStatus("Paste or select a public http(s) image URL first");
      return;
    }
    if (selectedEngines.length === 0) {
      setStatus("Choose at least one search engine");
      return;
    }

    selectedEngines.forEach((engine) => {
      void chrome.tabs
        .create({
          active: false,
          url: engine.buildUrl(searchUrl),
        })
        .catch(() => {
          setStatus(`Could not open ${engine.label}`);
        });
    });
    setStatus(
      `Opened ${selectedEngines.length} reverse image search tab${selectedEngines.length === 1 ? "" : "s"}`,
    );
  };

  return (
    <section className="flex-shrink-0 border-b border-border bg-bg-alt/80">
      <button
        aria-controls="reverse-image-search-panel"
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-card/35"
        onClick={toggleExpanded}
        type="button"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] uppercase tracking-wider text-fg/35">
            Reverse image search
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-fg/40">
            {status ?? "Collapsed"}
          </span>
        </span>
        <LeoIcon
          className="shrink-0 text-fg/45"
          name={expanded ? "chevrons-up" : "chevrons-down"}
          size={14}
        />
      </button>

      {expanded && (
        <div className="space-y-2 px-3 pb-2.5" id="reverse-image-search-panel">
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <p className="text-[10px] text-fg/30 uppercase tracking-wider">
                Image source
              </p>
              <p className="text-[11px] text-fg/40 mt-0.5">
                URL search needs a public direct image. If providers fail, use
                capture fallback.
              </p>
            </div>
            <button
              className="rounded border border-border bg-card/60 px-2 py-1 text-[10px] text-fg/60 hover:text-fg hover:bg-card"
              onClick={scanPageImages}
              type="button"
            >
              Rescan
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none placeholder:text-fg/25 focus:border-chart-1/70"
              onChange={(event) => setManualUrl(event.target.value)}
              placeholder="Paste image URL, or choose a detected image below"
              type="url"
              value={manualUrl}
            />
            <button
              className="shrink-0 rounded border border-border bg-card/60 px-2 py-1 text-[10px] text-fg/65 hover:bg-card hover:text-fg"
              onClick={() => uploadInputRef.current?.click()}
              type="button"
            >
              Upload
            </button>
          </div>

          <input
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              handleUploadedImageFile(event.currentTarget.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
            ref={uploadInputRef}
            type="file"
          />

          {uploadedImage && (
            <button
              className="rounded bg-chart-1 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-chart-1/90"
              onClick={() =>
                void openReverseImageUploadPages(uploadedImage.name)
              }
              type="button"
            >
              Search uploaded image
            </button>
          )}

          {uploadedImage && (
            <div className="flex items-center gap-2 rounded border border-border/70 bg-card/35 p-2">
              <img
                alt=""
                className="h-10 w-10 rounded object-cover"
                src={uploadedImage.dataUrl}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] text-fg/80">
                  {uploadedImage.name}
                </div>
                <div className="text-[10px] text-fg/35">
                  {formatUploadedImageSize(uploadedImage.size)}
                </div>
              </div>
              <button
                className="text-[10px] text-fg/35 hover:text-fg/70"
                onClick={() => setUploadedImage(null)}
                type="button"
              >
                Clear
              </button>
            </div>
          )}

          {images.length > 0 ? (
            <select
              className="w-full rounded border border-border bg-bg px-2 py-1.5 text-[11px] text-fg outline-none focus:border-chart-1/70"
              disabled={Boolean(manualUrl.trim())}
              onChange={(event) => setSelectedImageUrl(event.target.value)}
              value={selectedImageUrl}
            >
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
              const active = enabledEngines.includes(engine.id);
              return (
                <button
                  className={`rounded-full border px-2 py-1 text-[10px] transition-colors ${
                    active
                      ? "border-chart-1/50 bg-chart-1/15 text-chart-1"
                      : "border-border bg-card/30 text-fg/35 hover:text-fg/70"
                  }`}
                  key={engine.id}
                  onClick={() => toggleEngine(engine.id)}
                  type="button"
                >
                  {engine.label}
                </button>
              );
            })}
          </div>

          {urlWarning && (
            <div className="rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] text-warning">
              {urlWarning}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              className="rounded bg-chart-1 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-chart-1/90 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!searchUrl}
              onClick={openReverseSearches}
              type="button"
            >
              Search selected engines
            </button>
            <button
              className="rounded border border-border bg-card/60 px-2.5 py-1.5 text-[11px] text-fg/60 hover:bg-card hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!searchUrl}
              onClick={() => void copySelectedImageUrl()}
              type="button"
            >
              Copy URL
            </button>
            <button
              className="rounded border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning hover:bg-warning/15"
              onClick={() => void saveVisibleCaptureAndOpenUploadPages()}
              type="button"
            >
              Capture fallback
            </button>
            {status && (
              <span className="min-w-0 flex-1 truncate text-[10px] text-fg/35">
                {status}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

async function loadPageImages(
  setImages: (images: PageImageCandidate[]) => void,
  setSelectedImageUrl: (url: string) => void,
  setStatus: (status: string | null) => void,
) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("No active tab found");
    return;
  }
  if (!chrome.scripting?.executeScript) {
    setStatus("Page image scanning is unavailable here");
    return;
  }

  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: () => {
        const seen = new Set<string>();
        return Array.from(document.images)
          .map((image) => ({
            alt: image.alt || image.getAttribute("aria-label") || "",
            height: image.naturalHeight || image.height || 0,
            src: image.currentSrc || image.src || "",
            width: image.naturalWidth || image.width || 0,
          }))
          .filter((image) => {
            if (!image.src || seen.has(image.src)) return false;
            seen.add(image.src);
            try {
              const parsed = new URL(image.src, window.location.href);
              image.src = parsed.href;
              return (
                parsed.protocol === "http:" || parsed.protocol === "https:"
              );
            } catch {
              return false;
            }
          })
          .sort(
            (left, right) =>
              right.width * right.height - left.width * left.height,
          )
          .slice(0, 30);
      },
    },
    (results) => {
      if (chrome.runtime.lastError) {
        setStatus("Could not scan this page for images");
        return;
      }
      const detectedImages = results?.[0]?.result ?? [];
      setImages(detectedImages);
      setSelectedImageUrl(detectedImages[0]?.src ?? "");
      setStatus(
        detectedImages.length
          ? `Found ${detectedImages.length} page image${detectedImages.length === 1 ? "" : "s"}`
          : "No public image URLs detected",
      );
    },
  );
}

function isSearchableImageUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatImageCandidate(image: PageImageCandidate) {
  const size =
    image.width && image.height
      ? `${image.width}x${image.height}`
      : "unknown size";
  const label = image.alt || image.src;
  return `${size} - ${label.slice(0, 82)}`;
}
