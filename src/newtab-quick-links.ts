import type { WorkspaceAppIcon } from "./newtab-apps";

export interface QuickLink {
  id: string;
  label: string;
  url: string;
  icon: WorkspaceAppIcon;
}

export const QUICK_LINKS_STORAGE_KEY = "newtab.quickLinks";

export const WORKSPACE_APP_ICON_NAMES = new Set<WorkspaceAppIcon>([
  "app-store",
  "article",
  "book",
  "calendar",
  "cloud",
  "directory",
  "github",
  "link",
  "linear",
  "mail",
  "palette",
  "pencil",
  "video",
  "phosphor:atom",
  "phosphor:briefcase",
  "phosphor:chat-circle",
  "phosphor:code",
  "phosphor:database",
  "phosphor:planet",
  "phosphor:rocket",
  "phosphor:terminal-window",
  "hero:academic-cap",
  "hero:bolt",
  "hero:bookmark-square",
  "hero:command-line",
  "hero:cube-transparent",
  "hero:globe-alt",
  "hero:paper-airplane",
  "hero:sparkles",
  "lucide:boxes",
  "lucide:building",
  "lucide:database",
  "lucide:monitor",
  "lucide:shield",
  "lucide:star",
  "lucide:zap",
]);

export const DEFAULT_QUICK_LINKS: QuickLink[] = [
  {
    id: "chat",
    label: "Chat",
    url: "https://alex.chat",
    icon: "phosphor:chat-circle",
  },
  {
    id: "email",
    label: "Email",
    url: "https://mail.fly.pm",
    icon: "mail",
  },
  {
    id: "calendar",
    label: "Calendar",
    url: "https://cal.fly.pm",
    icon: "calendar",
  },
  {
    id: "tasks",
    label: "Tasks",
    url: "https://alex.coffee",
    icon: "linear",
  },
  {
    id: "link-shortener",
    label: "Link Shortener",
    url: "https://fly.pm",
    icon: "link",
  },
];

function isWorkspaceAppIcon(input: unknown): input is WorkspaceAppIcon {
  return (
    typeof input === "string" &&
    WORKSPACE_APP_ICON_NAMES.has(input as WorkspaceAppIcon)
  );
}

function quickLinkId(label: string, url: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || url;
}

export function sanitizeQuickLinks(input: unknown): QuickLink[] {
  if (input === undefined) return DEFAULT_QUICK_LINKS.slice();
  if (!Array.isArray(input)) return DEFAULT_QUICK_LINKS.slice();
  const next: QuickLink[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const label = (entry as QuickLink).label;
    const url = (entry as QuickLink).url;
    if (typeof label !== "string" || typeof url !== "string") continue;
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (!trimmedLabel || !/^https?:\/\//i.test(trimmedUrl)) continue;
    const icon = isWorkspaceAppIcon((entry as QuickLink).icon)
      ? (entry as QuickLink).icon
      : "link";
    const id =
      typeof (entry as QuickLink).id === "string" &&
      (entry as QuickLink).id.trim()
        ? (entry as QuickLink).id.trim()
        : quickLinkId(trimmedLabel, trimmedUrl);
    next.push({
      id,
      label: trimmedLabel,
      url: trimmedUrl,
      icon,
    });
  }
  return next;
}

export function createQuickLinkId() {
  return `quick-${Date.now().toString(36)}`;
}
