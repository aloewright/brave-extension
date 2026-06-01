import {
  default as React,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import "./style.css";
import {
  WORKSPACE_APPS,
  type WorkspaceApp,
  type WorkspaceAppIcon,
} from "./newtab-apps";
import {
  createQuickLinkId,
  DEFAULT_QUICK_LINKS,
  QUICK_LINKS_STORAGE_KEY,
  sanitizeQuickLinks,
  type QuickLink,
} from "./newtab-quick-links";

const TOP_APP_COUNT = 3;
const FOCUS_APP_COUNT = 4;
const MAX_OPEN_TAB_ITEMS = 8;

const APP_ICONS: Partial<Record<WorkspaceAppIcon, ReactNode>> = {
  "app-store": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 15.5 12 8l3 7.5" />
      <path d="M10.2 13h3.6" />
      <path d="M8 16h8" />
    </>
  ),
  article: (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  book: (
    <>
      <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v15H7.5A2.5 2.5 0 0 0 5 20.5z" />
      <path d="M5 5.5v15A2.5 2.5 0 0 1 7.5 18" />
      <path d="M9 7h7" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h2M12 14h2M16 14h2" />
    </>
  ),
  cloud: (
    <>
      <path d="M7.5 18h9.25a4.25 4.25 0 0 0 .55-8.46A6 6 0 0 0 6 11.5 3.25 3.25 0 0 0 7.5 18z" />
      <path d="M7.5 18h9.25" />
    </>
  ),
  directory: (
    <>
      <rect x="4" y="5" width="7" height="7" rx="1.5" />
      <rect x="13" y="5" width="7" height="7" rx="1.5" />
      <rect x="4" y="14" width="7" height="5" rx="1.5" />
      <path d="M14 17h5M16.5 14.5v5" />
    </>
  ),
  github: (
    <>
      <path d="M12 3a9 9 0 0 0-2.84 17.54c.45.08.62-.2.62-.43v-1.5c-2.5.54-3.03-1.07-3.03-1.07-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.9.06 1.37.93 1.37.93.8 1.37 2.1.97 2.62.74.08-.58.31-.97.57-1.2-2-.23-4.1-1-4.1-4.45 0-.98.35-1.78.93-2.41-.1-.23-.4-1.15.09-2.4 0 0 .76-.24 2.48.92a8.65 8.65 0 0 1 4.52 0c1.72-1.16 2.48-.92 2.48-.92.5 1.25.18 2.17.09 2.4.58.63.93 1.43.93 2.41 0 3.46-2.1 4.22-4.1 4.44.32.28.6.83.6 1.67v2.48c0 .24.16.52.62.43A9 9 0 0 0 12 3z" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M10.5 7.5 12 6a4 4 0 0 1 5.66 5.66l-1.5 1.5" />
      <path d="M13.5 16.5 12 18a4 4 0 0 1-5.66-5.66l1.5-1.5" />
    </>
  ),
  linear: (
    <>
      <path d="M4 17.5 17.5 4" />
      <path d="M4 12.5 12.5 4" />
      <path d="M4 7.5 7.5 4" />
      <path d="M9.5 20H20V9.5" />
    </>
  ),
  mail: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <path d="m5 8 7 5 7-5" />
      <path d="M8 16h8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 0 0 0 18h1.5a1.8 1.8 0 0 0 1.27-3.07 1.8 1.8 0 0 1 1.27-3.07H17a4 4 0 0 0 4-4A8 8 0 0 0 12 3z" />
      <circle cx="8.5" cy="10" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="7.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="9" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M13.5 8.5 15.5 10.5" />
      <path d="M4 20l1-4" />
    </>
  ),
  video: (
    <>
      <rect x="4" y="6" width="12" height="12" rx="2" />
      <path d="M16 10.5 20 8v8l-4-2.5z" />
      <path d="M9 10l3.5 2L9 14z" />
    </>
  ),
  "phosphor:atom": (
    <>
      <circle cx="12" cy="12" r="1.3" />
      <path d="M19.5 12c0 2-3.36 3.6-7.5 3.6S4.5 14 4.5 12 7.86 8.4 12 8.4s7.5 1.6 7.5 3.6Z" />
      <path d="M15.75 18.5c-1.73 1-4.8-1.38-6.86-4.96S6.55 6.54 8.28 5.54s4.8 1.38 6.86 4.96 2.34 7 .61 8Z" />
      <path d="M8.25 18.5c-1.73-1-1.45-4.42.61-8s5.13-5.96 6.86-4.96 1.45 4.42-.61 8-5.13 5.96-6.86 4.96Z" />
    </>
  ),
  "phosphor:briefcase": (
    <>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
      <path d="M4 12h16M10 12v1.5h4V12" />
    </>
  ),
  "phosphor:chat-circle": (
    <>
      <path d="M12 5a7 7 0 0 0-5.8 10.92L5 20l4.08-1.2A7 7 0 1 0 12 5Z" />
      <path d="M8.5 11h7M8.5 14h4.5" />
    </>
  ),
  "phosphor:code": (
    <>
      <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
      <path d="m13 6-2 12" />
    </>
  ),
  "phosphor:database": (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    </>
  ),
  "phosphor:planet": (
    <>
      <circle cx="12" cy="12" r="6" />
      <path d="M3.2 14.7c1.08 1.88 5.67 1.55 10.25-.72s7.43-5.66 6.35-7.54" />
      <path d="M20.8 9.3c-1.08-1.88-5.67-1.55-10.25.72s-7.43 5.66-6.35 7.54" />
    </>
  ),
  "phosphor:rocket": (
    <>
      <path d="M13.5 14.5 9.5 10.5C10.7 7.5 13.54 4.55 18.5 4c-.55 4.96-3.5 7.8-6.5 9Z" />
      <path d="M9.5 10.5 6 11.2 4.5 15l3.8-.7M13.5 14.5l-.7 3.8L16.6 17l.7-3.5" />
      <path d="M8 16 5 19M15.5 7.5h.01" />
    </>
  ),
  "phosphor:terminal-window": (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 9h16M8 13l2 2-2 2M12.5 17h3.5" />
    </>
  ),
  "hero:academic-cap": (
    <>
      <path d="M3 9.5 12 5l9 4.5-9 4.5z" />
      <path d="M7 11.5v4c1.3 1.2 3 1.8 5 1.8s3.7-.6 5-1.8v-4" />
      <path d="M19 10.5v5.5" />
    </>
  ),
  "hero:bolt": <path d="M13 3 5 14h6l-1 7 9-12h-6z" />,
  "hero:bookmark-square": (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M9 8h6v8l-3-2-3 2z" />
    </>
  ),
  "hero:command-line": (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="m8 10 2.5 2L8 14M13 14h3" />
    </>
  ),
  "hero:cube-transparent": (
    <>
      <path d="M12 3 4.5 7.2 12 11.4l7.5-4.2z" />
      <path d="M4.5 7.2v8.5L12 20l7.5-4.3V7.2" />
      <path d="M12 11.4V20M8.2 5.1l7.6 4.2M15.8 5.1 8.2 9.3" />
    </>
  ),
  "hero:globe-alt": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2 2.2 3 4.8 3 8s-1 5.8-3 8c-2-2.2-3-4.8-3-8s1-5.8 3-8Z" />
    </>
  ),
  "hero:paper-airplane": (
    <>
      <path d="M20 4 9.5 14.5" />
      <path d="m20 4-6.2 16-4.3-5.5L4 12z" />
    </>
  ),
  "hero:sparkles": (
    <>
      <path d="M12 3 13.6 8.4 19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z" />
      <path d="M5.5 15.5 6.3 18l2.2.7-2.2.7-.8 2.1-.8-2.1-2.2-.7 2.2-.7z" />
      <path d="M18 15.5 18.6 17l1.4.5-1.4.5-.6 1.5-.6-1.5-1.4-.5 1.4-.5z" />
    </>
  ),
  "lucide:boxes": (
    <>
      <path d="m7.5 8.5 4.5-2.5 4.5 2.5-4.5 2.5z" />
      <path d="m3.5 14.5 4-2.2 4 2.2-4 2.3zM12.5 14.5l4-2.2 4 2.2-4 2.3z" />
      <path d="M7.5 16.8v3.2l4-2.2v-3.3M16.5 16.8v3.2l4-2.2v-3.3M12 11v3.2" />
    </>
  ),
  "lucide:building": (
    <>
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" />
    </>
  ),
  "lucide:database": (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    </>
  ),
  "lucide:monitor": (
    <>
      <rect x="4" y="5" width="16" height="12" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </>
  ),
  "lucide:shield": (
    <path d="M12 3 5 6v5c0 4.5 2.8 7.7 7 10 4.2-2.3 7-5.5 7-10V6z" />
  ),
  "lucide:star": (
    <path d="m12 3 2.7 5.47 6.03.88-4.36 4.25 1.03 6-5.4-2.84L6.6 19.6l1.03-6-4.36-4.25 6.03-.88z" />
  ),
  "lucide:zap": <path d="M13 3 5 14h6l-1 7 9-12h-6z" />,
};

type AppIconSource = "Phosphor" | "Hero" | "Lucide";

interface AppIconChoice {
  icon: WorkspaceAppIcon;
  label: string;
  source: AppIconSource;
  aliases: string[];
}

const APP_ICON_CHOICES: AppIconChoice[] = [
  {
    icon: "app-store",
    label: "App Store",
    source: "Hero",
    aliases: ["apps", "store", "apple"],
  },
  {
    icon: "article",
    label: "Article",
    source: "Hero",
    aliases: ["document", "post", "news"],
  },
  {
    icon: "book",
    label: "Book",
    source: "Lucide",
    aliases: ["reader", "docs"],
  },
  {
    icon: "calendar",
    label: "Calendar",
    source: "Lucide",
    aliases: ["date", "schedule"],
  },
  {
    icon: "cloud",
    label: "Cloud",
    source: "Lucide",
    aliases: ["hosting", "server"],
  },
  {
    icon: "directory",
    label: "Directory",
    source: "Hero",
    aliases: ["grid", "apps"],
  },
  {
    icon: "github",
    label: "GitHub",
    source: "Lucide",
    aliases: ["repo", "code"],
  },
  { icon: "link", label: "Link", source: "Lucide", aliases: ["url", "chain"] },
  {
    icon: "linear",
    label: "Linear",
    source: "Phosphor",
    aliases: ["issue", "project"],
  },
  {
    icon: "mail",
    label: "Mail",
    source: "Lucide",
    aliases: ["email", "inbox"],
  },
  {
    icon: "palette",
    label: "Palette",
    source: "Lucide",
    aliases: ["design", "color"],
  },
  {
    icon: "pencil",
    label: "Pencil",
    source: "Lucide",
    aliases: ["edit", "write"],
  },
  {
    icon: "video",
    label: "Video",
    source: "Lucide",
    aliases: ["media", "play"],
  },
  {
    icon: "phosphor:atom",
    label: "Atom",
    source: "Phosphor",
    aliases: ["science", "ai", "research"],
  },
  {
    icon: "phosphor:briefcase",
    label: "Briefcase",
    source: "Phosphor",
    aliases: ["business", "work"],
  },
  {
    icon: "phosphor:chat-circle",
    label: "Chat Circle",
    source: "Phosphor",
    aliases: ["message", "conversation"],
  },
  {
    icon: "phosphor:code",
    label: "Code",
    source: "Phosphor",
    aliases: ["developer", "brackets"],
  },
  {
    icon: "phosphor:database",
    label: "Database",
    source: "Phosphor",
    aliases: ["data", "storage"],
  },
  {
    icon: "phosphor:planet",
    label: "Planet",
    source: "Phosphor",
    aliases: ["world", "global"],
  },
  {
    icon: "phosphor:rocket",
    label: "Rocket",
    source: "Phosphor",
    aliases: ["launch", "ship"],
  },
  {
    icon: "phosphor:terminal-window",
    label: "Terminal Window",
    source: "Phosphor",
    aliases: ["cli", "shell"],
  },
  {
    icon: "hero:academic-cap",
    label: "Academic Cap",
    source: "Hero",
    aliases: ["learn", "school"],
  },
  {
    icon: "hero:bolt",
    label: "Bolt",
    source: "Hero",
    aliases: ["fast", "lightning"],
  },
  {
    icon: "hero:bookmark-square",
    label: "Bookmark Square",
    source: "Hero",
    aliases: ["save", "favorite"],
  },
  {
    icon: "hero:command-line",
    label: "Command Line",
    source: "Hero",
    aliases: ["terminal", "cli"],
  },
  {
    icon: "hero:cube-transparent",
    label: "Cube Transparent",
    source: "Hero",
    aliases: ["package", "component"],
  },
  {
    icon: "hero:globe-alt",
    label: "Globe Alt",
    source: "Hero",
    aliases: ["web", "world"],
  },
  {
    icon: "hero:paper-airplane",
    label: "Paper Airplane",
    source: "Hero",
    aliases: ["send", "publish"],
  },
  {
    icon: "hero:sparkles",
    label: "Sparkles",
    source: "Hero",
    aliases: ["ai", "magic"],
  },
  {
    icon: "lucide:boxes",
    label: "Boxes",
    source: "Lucide",
    aliases: ["inventory", "stack"],
  },
  {
    icon: "lucide:building",
    label: "Building",
    source: "Lucide",
    aliases: ["company", "office"],
  },
  {
    icon: "lucide:database",
    label: "Database",
    source: "Lucide",
    aliases: ["data", "storage"],
  },
  {
    icon: "lucide:monitor",
    label: "Monitor",
    source: "Lucide",
    aliases: ["screen", "desktop"],
  },
  {
    icon: "lucide:shield",
    label: "Shield",
    source: "Lucide",
    aliases: ["security", "safe"],
  },
  {
    icon: "lucide:star",
    label: "Star",
    source: "Lucide",
    aliases: ["favorite", "featured"],
  },
  {
    icon: "lucide:zap",
    label: "Zap",
    source: "Lucide",
    aliases: ["fast", "lightning"],
  },
];
const APP_ICON_NAMES = new Set(APP_ICON_CHOICES.map((choice) => choice.icon));

const APP_COLOR_CHOICES = [
  { label: "Slate", value: "#9ca3af" },
  { label: "Sky", value: "#38bdf8" },
  { label: "Blue", value: "#60a5fa" },
  { label: "Indigo", value: "#818cf8" },
  { label: "Violet", value: "#a78bfa" },
  { label: "Pink", value: "#f472b6" },
  { label: "Red", value: "#fb7185" },
  { label: "Orange", value: "#fb923c" },
  { label: "Amber", value: "#fbbf24" },
  { label: "Green", value: "#4ade80" },
  { label: "Emerald", value: "#34d399" },
  { label: "Cyan", value: "#22d3ee" },
];

interface BrowserShortcut {
  id: string;
  title: string;
  url: string;
  meta: string;
  tabId?: number;
  windowId?: number;
  keepActive?: boolean;
  discarded?: boolean;
}

function AppIcon({
  name,
  className = "workspace-app-card__icon",
}: {
  name: WorkspaceAppIcon;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {APP_ICONS[name] ?? APP_ICONS.link}
    </svg>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function isHttpUrl(url?: string) {
  return !!url && /^https?:\/\//i.test(url);
}

function hostnameFor(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function normalizeLinkUrl(input: string) {
  let normalized = input.trim();
  if (!normalized) return null;
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
      return `${parsed.protocol}//${parsed.host}`;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeAccent(input: unknown) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  const match = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;

  const hex = match[1].toLowerCase();
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((part) => part + part)
      .join("")}`;
  }
  return `#${hex}`;
}

function getIconChoice(icon: WorkspaceAppIcon) {
  return (
    APP_ICON_CHOICES.find((choice) => choice.icon === icon) ??
    APP_ICON_CHOICES.find((choice) => choice.icon === "link") ??
    APP_ICON_CHOICES[0]
  );
}

function normalizeIconSearch(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fuzzyScore(query: string, target: string) {
  if (!query) return 0;
  if (target.includes(query)) return target.indexOf(query);

  let targetIndex = 0;
  let score = 0;
  for (const char of query) {
    const nextIndex = target.indexOf(char, targetIndex);
    if (nextIndex === -1) return null;
    score += nextIndex - targetIndex;
    targetIndex = nextIndex + 1;
  }
  return score + target.length - query.length;
}

function searchIconChoices(query: string) {
  const normalizedQuery = normalizeIconSearch(query);
  if (!normalizedQuery) return APP_ICON_CHOICES;

  return APP_ICON_CHOICES.map((choice) => {
    const target = normalizeIconSearch(
      [choice.label, choice.source, choice.icon, ...choice.aliases].join(" "),
    );
    const score = fuzzyScore(normalizedQuery, target);
    return score === null ? null : { choice, score };
  })
    .filter(
      (
        result,
      ): result is {
        choice: AppIconChoice;
        score: number;
      } => !!result,
    )
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.choice.source.localeCompare(b.choice.source) ||
        a.choice.label.localeCompare(b.choice.label),
    )
    .map((result) => result.choice);
}

function titleFor(title: string | undefined, url: string) {
  const cleanTitle = title?.trim();
  return cleanTitle || hostnameFor(url);
}

function formatHistoryMeta(item: chrome.history.HistoryItem, url: string) {
  const host = hostnameFor(url);
  if (!item.lastVisitTime) return host;
  return `${host} · ${new Date(item.lastVisitTime).toLocaleString()}`;
}

function formatTabMeta(url: string, keepActive: boolean, discarded?: boolean) {
  return [
    hostnameFor(url),
    keepActive ? "kept active" : null,
    discarded ? "sleeping" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function useBrowserShortcuts() {
  const [tabs, setTabs] = useState<BrowserShortcut[]>([]);
  const [history, setHistory] = useState<BrowserShortcut[]>([]);

  const clearHistory = async () => {
    if (typeof chrome === "undefined" || !chrome.history?.deleteAll) return;
    try {
      await chrome.history.deleteAll();
      setHistory([]);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let live = true;

    async function loadOpenTabs() {
      if (typeof chrome === "undefined" || !chrome.tabs?.query) return;

      try {
        const openTabs = await chrome.tabs.query({ currentWindow: true });
        if (!live) return;

        setTabs(
          openTabs
            .filter((tab) => isHttpUrl(tab.url))
            .slice(0, MAX_OPEN_TAB_ITEMS)
            .map((tab) => {
              const url = tab.url || "";
              const keepActive = tab.autoDiscardable === false;
              return {
                id: `tab-${tab.id ?? url}`,
                title: titleFor(tab.title, url),
                url,
                meta: formatTabMeta(url, keepActive, tab.discarded),
                tabId: tab.id,
                windowId: tab.windowId,
                keepActive,
                discarded: tab.discarded,
              };
            }),
        );
      } catch {
        if (live) setTabs([]);
      }
    }

    async function loadHistory() {
      if (typeof chrome === "undefined" || !chrome.history?.search) return;

      try {
        const recent = await chrome.history.search({
          text: "",
          startTime: 0,
          maxResults: 0,
        });
        if (!live) return;

        setHistory(
          recent
            .filter((item) => isHttpUrl(item.url))
            .map((item) => {
              const url = item.url || "";
              return {
                id: `history-${item.id}`,
                title: titleFor(item.title, url),
                url,
                meta: formatHistoryMeta(item, url),
              };
            }),
        );
      } catch {
        if (live) setHistory([]);
      }
    }

    void loadOpenTabs();
    void loadHistory();

    return () => {
      live = false;
    };
  }, []);

  const toggleKeepActive = async (item: BrowserShortcut) => {
    if (
      item.tabId === undefined ||
      typeof chrome === "undefined" ||
      !chrome.tabs?.update
    ) {
      return;
    }
    const keepActive = !item.keepActive;
    await chrome.tabs.update(item.tabId, { autoDiscardable: !keepActive });
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== item.id) return tab;
        return {
          ...tab,
          keepActive,
          meta: formatTabMeta(tab.url, keepActive, tab.discarded),
        };
      }),
    );
  };

  return { tabs, history, clearHistory, toggleKeepActive };
}

function BraveSearchForm() {
  const [query, setQuery] = useState("");

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    window.location.assign(
      `https://search.brave.com/search?q=${encodeURIComponent(trimmed)}`,
    );
  };

  return (
    <form className="newtab-search" role="search" onSubmit={search}>
      <SearchIcon className="newtab-search__icon" />
      <input
        aria-label="Search Brave"
        autoComplete="off"
        className="newtab-search__input"
        name="q"
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="Search Brave"
        type="search"
        value={query}
      />
      <button
        className="newtab-search__button"
        type="submit"
        aria-label="Search Brave"
      >
        <SearchIcon />
      </button>
    </form>
  );
}

export function EditQuickLinkModal({
  link,
  links,
  onClose,
  onSave,
}: {
  link: QuickLink;
  links: QuickLink[];
  onClose: () => void;
  onSave: (link: QuickLink, updated: QuickLink) => void;
}) {
  const isNew = !links.some((candidate) => candidate.id === link.id);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const [icon, setIcon] = useState<WorkspaceAppIcon>(link.icon);
  const [iconQuery, setIconQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedIcon = getIconChoice(icon);
  const iconResults = useMemo(
    () => searchIconChoices(iconQuery).slice(0, 30),
    [iconQuery],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanLabel = label.trim();
    if (!cleanLabel) {
      setError("Add a link name.");
      return;
    }

    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedUrl) {
      setError("Enter a valid http or https URL.");
      return;
    }

    const duplicate = links.some((candidate) => {
      if (candidate.id === link.id) return false;
      return normalizeLinkUrl(candidate.url) === normalizedUrl;
    });
    if (duplicate) {
      setError("That URL is already in your quick links.");
      return;
    }

    onSave(link, {
      id: link.id || createQuickLinkId(),
      label: cleanLabel,
      url: normalizedUrl,
      icon,
    });
  };

  return (
    <div
      className="newtab-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="newtab-edit-modal newtab-edit-modal--quick-link"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newtab-quick-link-modal-title"
        onSubmit={submit}
      >
        <div className="newtab-edit-modal__header">
          <div>
            <h2 id="newtab-quick-link-modal-title">
              {isNew ? "Add quick link" : "Edit quick link"}
            </h2>
            <p>Icon-only shortcuts under search</p>
          </div>
          <button
            type="button"
            className="newtab-edit-modal__close"
            aria-label="Close quick link modal"
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              fill="none"
              focusable="false"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="newtab-edit-modal__preview newtab-edit-modal__preview--quick-link">
          <span className="newtab-quick-link newtab-quick-link--preview" aria-hidden="true">
            <AppIcon name={icon} className="newtab-quick-link__icon" />
          </span>
          <div>
            <strong>{label.trim() || "Untitled link"}</strong>
            <span>{normalizeLinkUrl(url) ?? url}</span>
          </div>
        </div>

        <div className="newtab-edit-modal__fields">
          <label className="newtab-edit-modal__field">
            <span>Link name</span>
            <input
              autoFocus
              value={label}
              onChange={(event) => {
                setLabel(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
          <label className="newtab-edit-modal__field">
            <span>Link URL</span>
            <input
              inputMode="url"
              value={url}
              onChange={(event) => {
                setUrl(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
        </div>

        <section className="newtab-edit-modal__section">
          <div className="newtab-edit-modal__section-header">
            <h3>Icon</h3>
            <span>
              {selectedIcon.source} / {selectedIcon.label}
            </span>
          </div>
          <label className="newtab-icon-search">
            <SearchIcon className="newtab-icon-search__icon" />
            <input
              aria-label="Search Phosphor, Hero, or Lucide icons"
              placeholder="Search Phosphor, Hero, or Lucide icons"
              value={iconQuery}
              onChange={(event) => setIconQuery(event.currentTarget.value)}
            />
          </label>
          <div className="newtab-icon-grid" aria-label="Icon choices">
            {iconResults.map((choice) => (
              <button
                key={choice.icon}
                type="button"
                className="newtab-icon-choice"
                aria-label={`Use ${choice.source} ${choice.label} icon`}
                aria-pressed={icon === choice.icon}
                onClick={() => setIcon(choice.icon)}
              >
                <span className="newtab-icon-choice__mark" aria-hidden="true">
                  <AppIcon name={choice.icon} />
                </span>
                <span className="newtab-icon-choice__label">
                  {choice.label}
                </span>
                <span className="newtab-icon-choice__source">
                  {choice.source}
                </span>
              </button>
            ))}
          </div>
        </section>

        {error ? <p className="newtab-edit-modal__error">{error}</p> : null}

        <div className="newtab-edit-modal__footer">
          <button
            type="button"
            className="newtab-edit-modal__button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="newtab-edit-modal__button newtab-edit-modal__button--primary"
          >
            {isNew ? "Add link" : "Save link"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function QuickLinks({
  links,
  onChange,
}: {
  links: QuickLink[];
  onChange: (next: QuickLink[]) => void;
}) {
  const [managerOpen, setManagerOpen] = useState(false);
  const [modalLink, setModalLink] = useState<QuickLink | null>(null);

  const closeModal = () => setModalLink(null);
  const closeManager = () => {
    setManagerOpen(false);
    closeModal();
  };

  const saveLink = (original: QuickLink, updated: QuickLink) => {
    const exists = links.some((candidate) => candidate.id === original.id);
    onChange(
      exists
        ? links.map((candidate) =>
            candidate.id === original.id ? updated : candidate,
          )
        : [...links, updated],
    );
    closeModal();
  };

  const removeLink = (id: string) => {
    onChange(links.filter((candidate) => candidate.id !== id));
  };

  return (
    <>
      <div className="newtab-quick-links-row">
        <nav className="newtab-quick-links" aria-label="Quick links">
          {links.map((link) => (
            <div key={link.id} className="newtab-quick-link-item">
              <a
                className="newtab-quick-link"
                href={link.url}
                aria-label={link.label}
                title={link.label}
              >
                <AppIcon name={link.icon} className="newtab-quick-link__icon" />
              </a>
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="newtab-quick-links__toggle"
          aria-expanded={managerOpen}
          aria-haspopup="dialog"
          onClick={() => setManagerOpen(true)}
        >
          Edit links
        </button>
      </div>
      {managerOpen ? (
        <QuickLinksManagerModal
          links={links}
          onAdd={() =>
            setModalLink({
              id: createQuickLinkId(),
              label: "",
              url: "",
              icon: "link",
            })
          }
          onClose={closeManager}
          onEdit={(link) => setModalLink(link)}
          onRemove={removeLink}
          nestedModalOpen={modalLink !== null}
        />
      ) : null}
      {modalLink ? (
        <EditQuickLinkModal
          link={modalLink}
          links={links}
          onClose={closeModal}
          onSave={saveLink}
        />
      ) : null}
    </>
  );
}

function QuickLinksManagerModal({
  links,
  onClose,
  onAdd,
  onEdit,
  onRemove,
  nestedModalOpen,
}: {
  links: QuickLink[];
  onClose: () => void;
  onAdd: () => void;
  onEdit: (link: QuickLink) => void;
  onRemove: (id: string) => void;
  nestedModalOpen: boolean;
}) {
  useEffect(() => {
    if (nestedModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [nestedModalOpen, onClose]);

  return (
    <div
      className="newtab-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="newtab-edit-modal newtab-edit-modal--quick-links"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newtab-quick-links-modal-title"
      >
        <div className="newtab-edit-modal__header">
          <div>
            <h2 id="newtab-quick-links-modal-title">Edit links</h2>
            <p>Manage the links under search.</p>
          </div>
          <button
            type="button"
            className="newtab-edit-modal__close"
            aria-label="Close edit links modal"
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              fill="none"
              focusable="false"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <section className="newtab-edit-modal__section">
          <div className="newtab-edit-modal__section-header">
            <h3>Quick links</h3>
            <button
              type="button"
              className="newtab-edit-modal__button newtab-edit-modal__button--primary"
              onClick={onAdd}
            >
              Add quick link
            </button>
          </div>

          {links.length > 0 ? (
            <div className="newtab-quick-links-modal__list">
              {links.map((link) => (
                <div key={link.id} className="newtab-quick-links-modal__item">
                  <span className="newtab-quick-links-modal__mark" aria-hidden="true">
                    <AppIcon name={link.icon} className="newtab-quick-link__icon" />
                  </span>
                  <div className="newtab-quick-links-modal__details">
                    <strong className="newtab-quick-links-modal__label">
                      {link.label}
                    </strong>
                    <span className="newtab-quick-links-modal__url">
                      {link.url}
                    </span>
                  </div>
                  <div className="newtab-quick-links-modal__actions">
                    <button
                      type="button"
                      className="newtab-quick-links-modal__action"
                      onClick={() => onEdit(link)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="newtab-quick-links-modal__action newtab-quick-links-modal__action--remove"
                      onClick={() => onRemove(link.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="newtab-quick-links-modal__empty">
              No quick links yet.
            </p>
          )}
        </section>

        <div className="newtab-edit-modal__footer">
          <button
            type="button"
            className="newtab-edit-modal__button"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

type AppDrag = {
  index: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
};

export function AppCard({
  app,
  size = "standard",
  drag,
  onEdit,
  onRemove,
}: {
  app: WorkspaceApp;
  size?: "standard" | "small";
  drag: AppDrag;
  onEdit: (app: WorkspaceApp) => void;
  onRemove: (app: WorkspaceApp) => void;
}) {
  const classes = [
    "workspace-app-card",
    size === "small" ? "workspace-app-card--small" : "",
    drag.isDragging ? "workspace-app-card--dragging" : "",
    drag.isDropTarget ? "workspace-app-card--drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(drag.index));
        drag.onDragStart(drag.index);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        drag.onDragOver(drag.index);
      }}
      onDragLeave={drag.onDragLeave}
      onDragEnd={drag.onDragEnd}
      onDrop={(event) => {
        event.preventDefault();
        drag.onDrop(drag.index);
      }}
      style={{ "--workspace-app-accent": app.accent } as CSSProperties}
    >
      <div className="workspace-app-card__actions">
        <button
          type="button"
          className="workspace-app-card__action"
          aria-label={`Edit ${app.name}`}
          title={`Edit ${app.name}`}
          draggable={false}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit(app);
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.9"
            viewBox="0 0 24 24"
          >
            <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
            <path d="M13.5 8.5 15.5 10.5" />
            <path d="M4 20l1-4" />
          </svg>
        </button>
        <button
          type="button"
          className="workspace-app-card__action workspace-app-card__action--remove"
          aria-label={`Remove ${app.name}`}
          title={`Remove ${app.name}`}
          draggable={false}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove(app);
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <svg
            aria-hidden="true"
            fill="none"
            focusable="false"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <a
        className="workspace-app-card__link workspace-app-card__main"
        href={app.url}
        aria-label={app.name}
        draggable={false}
      >
        <span className="workspace-app-card__mark" aria-hidden="true">
          <AppIcon name={app.icon} />
        </span>
        <span className="workspace-app-card__body">
          <span className="workspace-app-card__name">{app.name}</span>
        </span>
      </a>
      {app.quickLinks?.length ? (
        <nav
          className="workspace-app-card__quick-links"
          aria-label={`${app.name} quick links`}
        >
          {app.quickLinks.map((link) => (
            <a
              key={link.url}
              className="workspace-app-card__quick-link"
              draggable={false}
              href={link.url}
            >
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

export function EditAppModal({
  app,
  apps,
  onClose,
  onSave,
}: {
  app: WorkspaceApp;
  apps: WorkspaceApp[];
  onClose: () => void;
  onSave: (app: WorkspaceApp, updatedApp: WorkspaceApp) => void;
}) {
  const [name, setName] = useState(app.name);
  const [url, setUrl] = useState(app.url);
  const [accent, setAccent] = useState(
    normalizeAccent(app.accent) ?? "#9ca3af",
  );
  const [icon, setIcon] = useState<WorkspaceAppIcon>(app.icon);
  const [iconQuery, setIconQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const selectedIcon = getIconChoice(icon);
  const iconResults = useMemo(
    () => searchIconChoices(iconQuery).slice(0, 30),
    [iconQuery],
  );

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Add a link name.");
      return;
    }

    const normalizedUrl = normalizeLinkUrl(url);
    if (!normalizedUrl) {
      setError("Enter a valid http or https URL.");
      return;
    }

    const duplicate = apps.some((candidate) => {
      if (candidate.url === app.url) return false;
      return normalizeLinkUrl(candidate.url) === normalizedUrl;
    });
    if (duplicate) {
      setError("That URL is already in your workspace.");
      return;
    }

    onSave(app, {
      ...app,
      name: cleanName,
      url: normalizedUrl,
      domain: hostnameFor(normalizedUrl),
      icon,
      accent: normalizeAccent(accent) ?? "#9ca3af",
    });
  };

  return (
    <div
      className="newtab-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="newtab-edit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="newtab-edit-modal-title"
        onSubmit={submit}
      >
        <div className="newtab-edit-modal__header">
          <div>
            <h2 id="newtab-edit-modal-title">Edit link</h2>
            <p>{hostnameFor(app.url)}</p>
          </div>
          <button
            type="button"
            className="newtab-edit-modal__close"
            aria-label="Close edit link modal"
            onClick={onClose}
          >
            <svg
              aria-hidden="true"
              fill="none"
              focusable="false"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="newtab-edit-modal__preview"
          style={{ "--workspace-app-accent": accent } as CSSProperties}
        >
          <span className="workspace-app-card__mark" aria-hidden="true">
            <AppIcon name={icon} />
          </span>
          <div>
            <strong>{name.trim() || "Untitled link"}</strong>
            <span>{normalizeLinkUrl(url) ?? url}</span>
          </div>
        </div>

        <div className="newtab-edit-modal__fields">
          <label className="newtab-edit-modal__field">
            <span>Link name</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
          <label className="newtab-edit-modal__field">
            <span>Link URL</span>
            <input
              inputMode="url"
              value={url}
              onChange={(event) => {
                setUrl(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
        </div>

        <section className="newtab-edit-modal__section">
          <div className="newtab-edit-modal__section-header">
            <h3>Color</h3>
            <label className="newtab-edit-modal__color-input">
              <span>Custom color</span>
              <input
                aria-label="Custom card color"
                type="color"
                value={normalizeAccent(accent) ?? "#9ca3af"}
                onChange={(event) => setAccent(event.currentTarget.value)}
              />
            </label>
          </div>
          <div className="newtab-color-grid" aria-label="Card color choices">
            {APP_COLOR_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className="newtab-color-choice"
                aria-label={`Use ${choice.label} card color`}
                aria-pressed={normalizeAccent(accent) === choice.value}
                title={choice.label}
                onClick={() => setAccent(choice.value)}
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: choice.value }}
                />
              </button>
            ))}
          </div>
        </section>

        <section className="newtab-edit-modal__section">
          <div className="newtab-edit-modal__section-header">
            <h3>Icon</h3>
            <span>
              {selectedIcon.source} / {selectedIcon.label}
            </span>
          </div>
          <label className="newtab-icon-search">
            <SearchIcon className="newtab-icon-search__icon" />
            <input
              aria-label="Search Phosphor, Hero, or Lucide icons"
              placeholder="Search Phosphor, Hero, or Lucide icons"
              value={iconQuery}
              onChange={(event) => setIconQuery(event.currentTarget.value)}
            />
          </label>
          <div className="newtab-icon-grid" aria-label="Icon choices">
            {iconResults.map((choice) => (
              <button
                key={choice.icon}
                type="button"
                className="newtab-icon-choice"
                aria-label={`Use ${choice.source} ${choice.label} icon`}
                aria-pressed={icon === choice.icon}
                style={{ "--workspace-app-accent": accent } as CSSProperties}
                onClick={() => setIcon(choice.icon)}
              >
                <span className="newtab-icon-choice__mark" aria-hidden="true">
                  <AppIcon name={choice.icon} />
                </span>
                <span className="newtab-icon-choice__label">
                  {choice.label}
                </span>
                <span className="newtab-icon-choice__source">
                  {choice.source}
                </span>
              </button>
            ))}
          </div>
        </section>

        {error ? <p className="newtab-edit-modal__error">{error}</p> : null}

        <div className="newtab-edit-modal__footer">
          <button
            type="button"
            className="newtab-edit-modal__button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="newtab-edit-modal__button newtab-edit-modal__button--primary"
          >
            Save link
          </button>
        </div>
      </form>
    </div>
  );
}

function BrowserShortcutItem({
  item,
  onToggleKeepActive,
}: {
  item: BrowserShortcut;
  onToggleKeepActive?: (item: BrowserShortcut) => void | Promise<void>;
}) {
  const tabId = item.tabId;
  const windowId = item.windowId;
  const content = (
    <>
      <span className="newtab-shortcut__title">{item.title}</span>
      <span className="newtab-shortcut__meta">{item.meta}</span>
    </>
  );
  const keepActiveButton =
    tabId !== undefined && onToggleKeepActive ? (
      <button
        type="button"
        className="newtab-shortcut__action"
        aria-label={
          item.keepActive
            ? `Allow ${item.title} to sleep`
            : `Keep ${item.title} active`
        }
        aria-pressed={item.keepActive}
        title={item.keepActive ? "Allow sleeping" : "Keep active"}
        onClick={() => void onToggleKeepActive(item)}
      >
        <svg
          aria-hidden="true"
          fill="none"
          focusable="false"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.9"
          viewBox="0 0 24 24"
        >
          <path d="M12 3v18" />
          <path d={item.keepActive ? "M7 8h10M8 16h8" : "M8 8h8"} />
        </svg>
      </button>
    ) : null;

  if (tabId !== undefined) {
    return (
      <div
        className={`newtab-shortcut-row${
          item.keepActive ? " newtab-shortcut-row--kept-active" : ""
        }`}
      >
        <button
          className="newtab-shortcut"
          onClick={async () => {
            try {
              await chrome.tabs.update(tabId, { active: true });
              if (windowId !== undefined) {
                await chrome.windows.update(windowId, { focused: true });
              }
            } catch {
              window.location.assign(item.url);
            }
          }}
          title={item.url}
          type="button"
        >
          {content}
        </button>
        {keepActiveButton}
      </div>
    );
  }

  return (
    <a className="newtab-shortcut" href={item.url} title={item.url}>
      {content}
    </a>
  );
}

function BrowserPanel({
  title,
  emptyText,
  items,
  scroll = false,
  onClear,
  clearLabel = "Clear",
  clearConfirm,
  onToggleKeepActive,
}: {
  title: string;
  emptyText: string;
  items: BrowserShortcut[];
  scroll?: boolean;
  onClear?: () => void | Promise<void>;
  clearLabel?: string;
  clearConfirm?: string;
  onToggleKeepActive?: (item: BrowserShortcut) => void | Promise<void>;
}) {
  return (
    <section className={`newtab-panel ${scroll ? "newtab-panel--scroll" : ""}`}>
      <div className="newtab-panel__header">
        <h2>{title}</h2>
        <div className="newtab-panel__header-actions">
          <span>{items.length}</span>
          {onClear && items.length > 0 ? (
            <button
              type="button"
              className="newtab-panel__clear"
              onClick={() => {
                if (clearConfirm && !window.confirm(clearConfirm)) return;
                void onClear();
              }}
            >
              {clearLabel}
            </button>
          ) : null}
        </div>
      </div>
      {items.length > 0 ? (
        <div className="newtab-shortcut-list">
          {items.map((item) => (
            <BrowserShortcutItem
              key={item.id}
              item={item}
              onToggleKeepActive={onToggleKeepActive}
            />
          ))}
        </div>
      ) : (
        <p className="newtab-panel__empty">{emptyText}</p>
      )}
    </section>
  );
}

const APP_ORDER_STORAGE_KEY = "newtab.appOrder";
const CUSTOM_APPS_STORAGE_KEY = "newtab.customApps";
const HIDDEN_APPS_STORAGE_KEY = "newtab.hiddenApps";
const APP_ICON_STORAGE_KEY = "newtab.appIconOverrides";
const WORKSPACE_APP_STORAGE_KEYS = [
  APP_ORDER_STORAGE_KEY,
  CUSTOM_APPS_STORAGE_KEY,
  HIDDEN_APPS_STORAGE_KEY,
  APP_ICON_STORAGE_KEY,
];

function reorderApps(
  apps: WorkspaceApp[],
  from: number,
  to: number,
): WorkspaceApp[] | null {
  if (from === to) return null;
  const next = apps.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function applyStoredOrder(
  allApps: WorkspaceApp[],
  stored: string[],
): WorkspaceApp[] {
  const remaining = new Map(allApps.map((app) => [app.url, app]));
  const ordered: WorkspaceApp[] = [];
  for (const url of stored) {
    const app = remaining.get(url);
    if (app) {
      ordered.push(app);
      remaining.delete(url);
    }
  }
  for (const app of remaining.values()) ordered.push(app);
  return ordered;
}

function isWorkspaceAppIcon(input: unknown): input is WorkspaceAppIcon {
  return (
    typeof input === "string" && APP_ICON_NAMES.has(input as WorkspaceAppIcon)
  );
}

function sanitizeCustomApps(input: unknown): WorkspaceApp[] {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is WorkspaceApp => {
    return (
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as WorkspaceApp).name === "string" &&
      typeof (entry as WorkspaceApp).url === "string" &&
      typeof (entry as WorkspaceApp).domain === "string" &&
      typeof (entry as WorkspaceApp).accent === "string" &&
      isWorkspaceAppIcon((entry as WorkspaceApp).icon)
    );
  });
}

function sanitizeIconOverrides(
  input: unknown,
): Record<string, WorkspaceAppIcon> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, WorkspaceAppIcon] =>
        typeof entry[0] === "string" && isWorkspaceAppIcon(entry[1]),
    ),
  );
}

function applyIconOverrides(
  allApps: WorkspaceApp[],
  overrides: Record<string, WorkspaceAppIcon>,
): WorkspaceApp[] {
  return allApps.map((app) => {
    const icon = overrides[app.url];
    return icon ? { ...app, icon } : app;
  });
}

function NewTabWorkspace() {
  const { tabs, history, clearHistory, toggleKeepActive } = useBrowserShortcuts();
  const [apps, setApps] = useState<WorkspaceApp[]>(() => WORKSPACE_APPS);
  const [quickLinks, setQuickLinks] = useState<QuickLink[]>(() =>
    DEFAULT_QUICK_LINKS.slice(),
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [editingApp, setEditingApp] = useState<WorkspaceApp | null>(null);

  useEffect(() => {
    let live = true;
    try {
      chrome.storage.local.get(
        [...WORKSPACE_APP_STORAGE_KEYS, QUICK_LINKS_STORAGE_KEY],
        (result) => {
          if (!live) return;
          const customs = sanitizeCustomApps(result?.[CUSTOM_APPS_STORAGE_KEY]);
          const hidden = new Set(
            Array.isArray(result?.[HIDDEN_APPS_STORAGE_KEY])
              ? result[HIDDEN_APPS_STORAGE_KEY].filter(
                  (url): url is string => typeof url === "string",
                )
              : [],
          );
          const combined = [
            ...WORKSPACE_APPS.filter((app) => !hidden.has(app.url)),
            ...customs,
          ];
          const withIconOverrides = applyIconOverrides(
            combined,
            sanitizeIconOverrides(result?.[APP_ICON_STORAGE_KEY]),
          );
          const storedOrder = result?.[APP_ORDER_STORAGE_KEY];
          if (Array.isArray(storedOrder) && storedOrder.length > 0) {
            setApps(
              applyStoredOrder(
                withIconOverrides,
                storedOrder.filter(
                  (url): url is string => typeof url === "string",
                ),
              ),
            );
          } else {
            setApps(withIconOverrides);
          }
          setQuickLinks(sanitizeQuickLinks(result?.[QUICK_LINKS_STORAGE_KEY]));
        },
      );
    } catch {
      /* chrome.storage may be unavailable in some preview contexts */
    }
    return () => {
      live = false;
    };
  }, []);

  const persistQuickLinks = (next: QuickLink[]) => {
    setQuickLinks(next);
    try {
      chrome.storage.local.set({ [QUICK_LINKS_STORAGE_KEY]: next });
    } catch {
      /* ignore */
    }
  };

  const persistOrder = (next: WorkspaceApp[]) => {
    setApps(next);
    try {
      chrome.storage.local.set({
        [APP_ORDER_STORAGE_KEY]: next.map((app) => app.url),
      });
    } catch {
      /* ignore */
    }
  };

  const addCustomApp = () => {
    const nameInput = window.prompt("New link name");
    if (!nameInput?.trim()) return;
    const urlInput = window.prompt("URL (e.g. https://example.com)");
    if (!urlInput?.trim()) return;

    const normalized = normalizeLinkUrl(urlInput);
    if (!normalized) {
      window.alert("That URL doesn't look right.");
      return;
    }

    if (apps.some((existing) => existing.url === normalized)) {
      window.alert("That link is already in your workspace.");
      return;
    }

    const newApp: WorkspaceApp = {
      name: nameInput.trim(),
      domain: hostnameFor(normalized),
      url: normalized,
      icon: "link",
      accent: "#9ca3af",
    };

    const nextApps = [...apps, newApp];
    setApps(nextApps);

    try {
      chrome.storage.local.get(CUSTOM_APPS_STORAGE_KEY, (result) => {
        const existing = sanitizeCustomApps(result?.[CUSTOM_APPS_STORAGE_KEY]);
        chrome.storage.local.set({
          [CUSTOM_APPS_STORAGE_KEY]: [...existing, newApp],
          [APP_ORDER_STORAGE_KEY]: nextApps.map((app) => app.url),
        });
      });
    } catch {
      /* ignore */
    }
  };

  const saveAppEdits = (app: WorkspaceApp, updatedApp: WorkspaceApp) => {
    const nextApps = apps.map((candidate) =>
      candidate.url === app.url ? updatedApp : candidate,
    );
    setApps(nextApps);
    setEditingApp(null);

    try {
      chrome.storage.local.get(
        [
          CUSTOM_APPS_STORAGE_KEY,
          HIDDEN_APPS_STORAGE_KEY,
          APP_ICON_STORAGE_KEY,
        ],
        (result) => {
          const iconOverrides = sanitizeIconOverrides(
            result?.[APP_ICON_STORAGE_KEY],
          );
          const customs = sanitizeCustomApps(result?.[CUSTOM_APPS_STORAGE_KEY]);
          const existingHidden = Array.isArray(
            result?.[HIDDEN_APPS_STORAGE_KEY],
          )
            ? result[HIDDEN_APPS_STORAGE_KEY].filter(
                (url): url is string => typeof url === "string",
              )
            : [];
          const isBuiltIn = WORKSPACE_APPS.some(
            (candidate) => candidate.url === app.url,
          );
          const nextCustoms = [
            ...customs.filter(
              (candidate) =>
                candidate.url !== app.url && candidate.url !== updatedApp.url,
            ),
            updatedApp,
          ];
          const hidden = isBuiltIn
            ? Array.from(new Set([...existingHidden, app.url]))
            : existingHidden;

          delete iconOverrides[app.url];
          chrome.storage.local.set({
            [CUSTOM_APPS_STORAGE_KEY]: nextCustoms,
            [HIDDEN_APPS_STORAGE_KEY]: hidden,
            [APP_ICON_STORAGE_KEY]: {
              ...iconOverrides,
              [updatedApp.url]: updatedApp.icon,
            },
            [APP_ORDER_STORAGE_KEY]: nextApps.map((candidate) => candidate.url),
          });
        },
      );
    } catch {
      /* ignore */
    }
  };

  const removeApp = (app: WorkspaceApp) => {
    const nextApps = apps.filter((candidate) => candidate.url !== app.url);
    setApps(nextApps);
    setDragIndex(null);
    setOverIndex(null);
    setEditingApp(null);

    try {
      chrome.storage.local.get(
        [
          CUSTOM_APPS_STORAGE_KEY,
          HIDDEN_APPS_STORAGE_KEY,
          APP_ICON_STORAGE_KEY,
        ],
        (result) => {
          const existingCustoms = sanitizeCustomApps(
            result?.[CUSTOM_APPS_STORAGE_KEY],
          );
          const iconOverrides = sanitizeIconOverrides(
            result?.[APP_ICON_STORAGE_KEY],
          );
          delete iconOverrides[app.url];
          const existingHidden = Array.isArray(
            result?.[HIDDEN_APPS_STORAGE_KEY],
          )
            ? result[HIDDEN_APPS_STORAGE_KEY].filter(
                (url): url is string => typeof url === "string",
              )
            : [];
          const isBuiltIn = WORKSPACE_APPS.some(
            (candidate) => candidate.url === app.url,
          );
          const hidden = isBuiltIn
            ? Array.from(new Set([...existingHidden, app.url]))
            : existingHidden.filter((url) => url !== app.url);

          chrome.storage.local.set({
            [CUSTOM_APPS_STORAGE_KEY]: existingCustoms.filter(
              (candidate) => candidate.url !== app.url,
            ),
            [HIDDEN_APPS_STORAGE_KEY]: hidden,
            [APP_ICON_STORAGE_KEY]: iconOverrides,
            [APP_ORDER_STORAGE_KEY]: nextApps.map((candidate) => candidate.url),
          });
        },
      );
    } catch {
      /* ignore */
    }
  };

  const appGroups = useMemo(() => {
    const top = apps.slice(0, TOP_APP_COUNT);
    const focus = apps.slice(TOP_APP_COUNT, TOP_APP_COUNT + FOCUS_APP_COUNT);
    const compact = apps.slice(TOP_APP_COUNT + FOCUS_APP_COUNT);
    return { top, focus, compact };
  }, [apps]);

  const handleDrop = (toIndex: number) => {
    const from = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (from === null) return;
    const next = reorderApps(apps, from, toIndex);
    if (next) persistOrder(next);
  };

  const makeDrag = (index: number): AppDrag => ({
    index,
    isDragging: dragIndex === index,
    isDropTarget:
      overIndex === index && dragIndex !== null && dragIndex !== index,
    onDragStart: (i) => {
      setEditingApp(null);
      setDragIndex(i);
    },
    onDragOver: (i) => setOverIndex(i),
    onDragLeave: () => setOverIndex(null),
    onDragEnd: () => {
      setDragIndex(null);
      setOverIndex(null);
    },
    onDrop: handleDrop,
  });

  return (
    <div className="newtab-workspace">
      <main className="newtab-workspace__shell">
        <BraveSearchForm />
        <QuickLinks links={quickLinks} onChange={persistQuickLinks} />

        <header className="newtab-workspace__header">
          <span className="newtab-workspace__count">{apps.length} links</span>
        </header>

        <section className="newtab-app-groups" aria-label="Workspace apps">
          <div
            className="newtab-app-grid newtab-app-grid--top"
            aria-label="Primary apps"
          >
            {appGroups.top.map((app, i) => (
              <AppCard
                key={app.url}
                app={app}
                drag={makeDrag(i)}
                onEdit={setEditingApp}
                onRemove={removeApp}
              />
            ))}
          </div>
          <div
            className="newtab-app-grid newtab-app-grid--focus"
            aria-label="Daily apps"
          >
            {appGroups.focus.map((app, i) => (
              <AppCard
                key={app.url}
                app={app}
                drag={makeDrag(TOP_APP_COUNT + i)}
                onEdit={setEditingApp}
                onRemove={removeApp}
              />
            ))}
          </div>
          <div
            className="newtab-app-grid newtab-app-grid--compact"
            aria-label="Other apps"
          >
            {appGroups.compact.map((app, i) => (
              <AppCard
                key={app.url}
                app={app}
                size="small"
                drag={makeDrag(TOP_APP_COUNT + FOCUS_APP_COUNT + i)}
                onEdit={setEditingApp}
                onRemove={removeApp}
              />
            ))}
            <button
              type="button"
              className="workspace-app-card workspace-app-card--small workspace-app-card--add"
              onClick={addCustomApp}
              aria-label="Add new link"
            >
              <span className="workspace-app-card__mark" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  className="workspace-app-card__icon"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span className="workspace-app-card__body">
                <span className="workspace-app-card__name">Add link</span>
              </span>
            </button>
          </div>
        </section>

        <section className="newtab-panels" aria-label="Browser shortcuts">
          <BrowserPanel
            title="Open Tabs"
            emptyText="No open web tabs."
            items={tabs}
            onToggleKeepActive={toggleKeepActive}
          />
          <BrowserPanel
            title="History"
            emptyText="No history yet."
            items={history}
            scroll
            onClear={clearHistory}
            clearLabel="Clear all"
            clearConfirm="Delete all browser history? This cannot be undone."
          />
        </section>
      </main>
      {editingApp ? (
        <EditAppModal
          key={editingApp.url}
          app={editingApp}
          apps={apps}
          onClose={() => setEditingApp(null)}
          onSave={saveAppEdits}
        />
      ) : null}
    </div>
  );
}

export default NewTabWorkspace;
