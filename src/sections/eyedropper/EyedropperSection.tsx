import { useEffect, useMemo, useState, useRef } from "react";
import { formatColor, parseColor } from "../../utils/color";
import type { RGBA } from "../../types";
import {
  getSavedColors,
  savePickedColor,
  type SavedColor,
} from "../../lib/eyedropper";

type EyeDropperResult = {
  sRGBHex: string;
};

type EyeDropperConstructor = new () => {
  open: () => Promise<EyeDropperResult>;
};

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor;
  }
}

const INITIAL_COLOR = "#61d394";

type EyedropperSectionProps = {
  embedded?: boolean;
};

function colorValues(color: string) {
  const parsed = parseColor(color);
  if (!parsed) return [];

  return [
    ["HEX", formatColor(parsed, "hex")],
    ["RGB", formatColor(parsed, "rgb")],
    ["HSL", formatColor(parsed, "hsl")],
    ["OKLCH", formatColor(parsed, "oklch")],
  ] as const;
}

function relativeLuminance({ r, g, b }: RGBA) {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function SavedColorCard({
  color,
  onCopy,
}: {
  color: SavedColor;
  onCopy: (text: string) => void;
}) {
  const values = colorValues(color.hex);
  const parsed = parseColor(color.hex);
  const fg = parsed && relativeLuminance(parsed) > 0.54 ? "#111111" : "#ffffff";
  const display = values[0]?.[1] ?? color.hex;

  return (
    <div
      className="rounded-md border border-border bg-card px-3 py-2.5 shadow-sm"
      data-testid="saved-color-card"
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="mt-0.5 h-9 w-9 shrink-0 rounded border border-border/60"
          style={{ background: color.hex, color: fg }}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-[11px] font-semibold text-fg/90">
                {display}
              </div>
              <div className="mt-0.5 text-[9px] uppercase tracking-wide text-fg/35">
                Saved color
              </div>
            </div>

            <button
              type="button"
              onClick={() => onCopy(display)}
              className="shrink-0 rounded border border-border px-2 py-1 text-[10px] font-medium text-fg/70 transition-colors hover:border-accent hover:text-fg"
              title={`Copy ${display}`}
            >
              Copy
            </button>
          </div>

          <div className="mt-2 grid gap-1">
            {values.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <span className="w-10 shrink-0 text-[9px] font-medium uppercase tracking-wide text-fg/30">
                  {label}
                </span>
                <span className="min-w-0 truncate font-mono text-[10px] text-fg/75">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EyedropperSection({
  embedded = false,
}: EyedropperSectionProps = {}) {
  const [color, setColor] = useState(INITIAL_COLOR);
  const [status, setStatus] = useState<string | null>(null);
  const [savedColors, setSavedColors] = useState<SavedColor[]>([]);
  const values = useMemo(() => colorValues(color), [color]);
  const parsed = parseColor(color);
  const fg = parsed && relativeLuminance(parsed) > 0.54 ? "#111111" : "#ffffff";

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
      window.setTimeout(() => setStatus(null), 1200);
    } catch {
      setStatus("Copy failed");
      window.setTimeout(() => setStatus(null), 1200);
    }
  };

  const pick = async () => {
    const EyeDropper = window.EyeDropper;
    if (!EyeDropper) {
      setStatus("Unavailable");
      return;
    }

    try {
      const result = await new EyeDropper().open();
      const next = await savePickedColor(result.sRGBHex);
      setColor(result.sRGBHex);
      setSavedColors(next);
      await copy(result.sRGBHex);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus(err instanceof Error ? err.message : "Pick failed");
    }
  };

  useEffect(() => {
    let cancelled = false;
    getSavedColors().then((colors) => {
      if (!cancelled) {
        setSavedColors((current) => (current.length > 0 ? current : colors));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className={
        embedded
          ? "flex-shrink-0 border-b border-border bg-bg-alt/70 px-3 py-2.5 flex max-h-[320px] flex-col gap-3 overflow-y-auto overflow-x-hidden"
          : "h-full flex flex-col overflow-y-auto overflow-x-hidden p-4 gap-4"
      }
      data-testid="eyedropper-section"
    >
      {embedded && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-fg/35">
            Eyedropper
          </p>
          <span className="text-[10px] text-fg/35">
            {savedColors.length} saved
          </span>
        </div>
      )}

      <div
        className={`rounded-lg border border-border shadow-lg flex items-end ${
          embedded ? "h-20 p-3" : "h-40 p-4"
        }`}
        style={{ background: color, color: fg }}
      >
        <div
          className={`font-mono font-semibold ${embedded ? "text-base" : "text-2xl"}`}
        >
          {values[0]?.[1] ?? color}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={pick}
          className="flex-1 px-3 py-2 rounded bg-primary/20 text-primary hover:bg-primary/30 text-xs font-medium"
        >
          Pick Color
        </button>
        {status && (
          <span className="text-[11px] text-fg/50 min-w-16">{status}</span>
        )}
      </div>

      <div className="grid gap-2">
        {values.map(([label, value]) => (
          <button
            key={label}
            type="button"
            onClick={() => copy(value)}
            className="flex items-center gap-3 px-3 py-2 rounded border border-border bg-card hover:border-accent text-left"
            title={`Copy ${value}`}
          >
            <span className="w-12 text-[10px] text-fg/35 font-medium">
              {label}
            </span>
            <span className="font-mono text-xs text-fg/80 truncate">
              {value}
            </span>
          </button>
        ))}
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/40">
            Saved colors
          </h3>
          <span className="text-[10px] text-fg/35">{savedColors.length}</span>
        </div>

        {savedColors.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-card/40 px-3 py-3 text-[11px] text-fg/45">
            Pick a color to keep it here.
          </div>
        ) : (
          <div className="grid gap-2">
            {savedColors.map((saved) => (
              <SavedColorCard key={saved.id} color={saved} onCopy={copy} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
