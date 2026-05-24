import { useEffect, useState } from "react";
import {
  RECORDER_STORAGE_KEY,
  type RecorderSource,
  type RecordingMetadata,
} from "../../types";
import { openPopupWindow } from "../../lib/popup-window";

interface RecState {
  active: boolean;
  paused: boolean;
  source: RecorderSource | null;
  startedAt: number | null;
  elapsedMs: number;
  lastResumedAt: number | null;
  lastSaved: {
    id: string;
    filename: string;
    sizeBytes: number;
    at: number;
  } | null;
  lastError: string | null;
}

export function RecorderSection() {
  const [state, setState] = useState<RecState>({
    active: false,
    paused: false,
    source: null,
    startedAt: null,
    elapsedMs: 0,
    lastResumedAt: null,
    lastSaved: null,
    lastError: null,
  });
  const [history, setHistory] = useState<RecordingMetadata[]>([]);
  const [now, setNow] = useState(Date.now());

  // Initial state pull + storage subscription.
  useEffect(() => {
    chrome.runtime.sendMessage(
      { type: "GET_RECORDING_STATE" },
      (res: { state: RecState }) => {
        if (res?.state) setState(res.state);
      },
    );
    chrome.storage.local.get(RECORDER_STORAGE_KEY).then((got) => {
      const list =
        (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? [];
      setHistory(list);
    });
    const onMsg = (msg: any) => {
      if (msg?.type === "recording-state" && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const onChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && RECORDER_STORAGE_KEY in changes) {
        const list =
          (changes[RECORDER_STORAGE_KEY].newValue as
            | RecordingMetadata[]
            | undefined) ?? [];
        setHistory(list);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, []);

  // Tick for the active duration display.
  useEffect(() => {
    if (!state.active || state.paused) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [state.active, state.paused]);

  const handleStart = async () => {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const [tab] = win?.id
      ? await chrome.tabs.query({ active: true, windowId: win.id })
      : [];
    if (!tab?.id) {
      setState((s) => ({ ...s, lastError: "No active tab" }));
      return;
    }
    chrome.runtime.sendMessage(
      { type: "START_RECORDING", source: "tab", tabId: tab.id },
      (res: { ok: boolean; error?: string }) => {
        if (!res?.ok) {
          setState((s) => ({ ...s, lastError: res?.error || "Start failed" }));
        }
      },
    );
  };

  const handleStop = () => {
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });
  };

  const handlePause = () => {
    chrome.runtime.sendMessage({ type: "PAUSE_RECORDING" });
  };

  const handleResume = () => {
    chrome.runtime.sendMessage({ type: "RESUME_RECORDING" });
  };

  const elapsedMs = elapsedRecordingMs(state, now);

  return (
    <div className="flex flex-col h-full p-4 gap-4 text-fg">
      <div className="text-sm font-medium">Recorder</div>

      <div className="flex items-center gap-3">
        {!state.active ? (
          <button
            type="button"
            onClick={handleStart}
            className="px-3 py-2 rounded bg-red-500 text-white text-sm font-medium hover:bg-red-600"
          >
            Start recording
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={state.paused ? handleResume : handlePause}
              className="px-3 py-2 rounded border border-fg/20 text-fg text-sm font-medium hover:bg-fg/10"
            >
              {state.paused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={handleStop}
              className="px-3 py-2 rounded bg-fg text-bg text-sm font-medium hover:opacity-90"
            >
              Stop ({formatDuration(elapsedMs)})
            </button>
          </>
        )}
        {state.active && (
          <span className="text-xs text-fg/60">
            {state.paused ? "paused" : `recording ${state.source}...`}
          </span>
        )}
      </div>

      {state.lastError && (
        <div className="text-xs text-red-500 break-words">
          {state.lastError}
        </div>
      )}

      {state.lastSaved && !state.active && (
        <div className="text-xs text-fg/70">
          Saved <span className="font-mono">{state.lastSaved.filename}</span> to
          your Downloads folder ({formatBytes(state.lastSaved.sizeBytes)}).
        </div>
      )}

      <div className="flex flex-col gap-2 mt-2">
        <div className="text-xs uppercase tracking-wide text-fg/50">
          Recent recordings
        </div>
        {history.length === 0 ? (
          <div className="text-xs text-fg/40">No recordings yet.</div>
        ) : (
          <ul className="grid gap-2 text-xs">
            {history.slice(0, 10).map((r) => (
              <li
                key={r.id}
                className="rounded border border-border bg-card/25 p-2 text-fg/70"
              >
                <button
                  type="button"
                  onClick={() => void openRecordingPreview(r)}
                  className="flex w-full items-center gap-2 text-left"
                  aria-label={`Open recording preview ${r.filename}`}
                >
                  <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-accent/50 text-[10px] uppercase text-fg/45">
                    Video
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono">{r.filename}</span>
                    {r.originalFilename && (
                      <span className="block truncate text-[10px] text-fg/35">
                        {r.originalFilename}
                      </span>
                    )}
                    <span className="block truncate text-[10px] text-fg/45">
                      {r.source} · {formatDuration(r.durationMs)} ·{" "}
                      {formatBytes(r.sizeBytes)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

async function openRecordingPreview(recording: RecordingMetadata) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(recording.filename)}</title><style>body{margin:0;background:#111;color:#f6f6f6;font:13px system-ui;padding:24px}main{max-width:720px;margin:auto}.thumb{height:220px;border:1px solid #333;border-radius:8px;display:grid;place-items:center;color:#aaa;margin-bottom:16px}code{word-break:break-all}</style></head><body><main><div class="thumb">Video saved to Downloads</div><h1>${escapeHtml(recording.filename)}</h1><p>${escapeHtml(recording.source)} · ${formatDuration(recording.durationMs)} · ${formatBytes(recording.sizeBytes)}</p>${recording.originUrl ? `<p><code>${escapeHtml(recording.originUrl)}</code></p>` : ""}</main></body></html>`
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  await openPopupWindow(url, 760, 560)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;"
      case "<":
        return "&lt;"
      case ">":
        return "&gt;"
      case '"':
        return "&quot;"
      default:
        return "&#39;"
    }
  })
}

function elapsedRecordingMs(state: RecState, now: number): number {
  if (!state.active) return state.elapsedMs || 0;
  if (state.paused || !state.lastResumedAt) return state.elapsedMs || 0;
  return (state.elapsedMs || 0) + Math.max(0, now - state.lastResumedAt);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
