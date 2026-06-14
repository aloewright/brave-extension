export interface WorkspaceApp {
  name: string;
  domain: string;
  url: string;
  icon: WorkspaceAppIcon;
  accent: string;
  quickLinks?: WorkspaceAppQuickLink[];
}

export interface WorkspaceAppQuickLink {
  label: string;
  url: string;
}

export type WorkspaceAppIcon =
  | "app-store"
  | "article"
  | "book"
  | "calendar"
  | "cloud"
  | "directory"
  | "github"
  | "link"
  | "linear"
  | "mail"
  | "palette"
  | "pencil"
  | "video"
  | "phosphor:atom"
  | "phosphor:briefcase"
  | "phosphor:chat-circle"
  | "phosphor:code"
  | "phosphor:database"
  | "phosphor:planet"
  | "phosphor:rocket"
  | "phosphor:terminal-window"
  | "hero:academic-cap"
  | "hero:bolt"
  | "hero:bookmark-square"
  | "hero:command-line"
  | "hero:cube-transparent"
  | "hero:globe-alt"
  | "hero:paper-airplane"
  | "hero:sparkles"
  | "lucide:boxes"
  | "lucide:building"
  | "lucide:database"
  | "lucide:monitor"
  | "lucide:shield"
  | "lucide:star"
  | "lucide:zap";

export const WORKSPACE_APPS: WorkspaceApp[] = [
  {
    name: "Cloudflare",
    domain: "dash.cloudflare.com",
    url: "https://dash.cloudflare.com",
    icon: "cloud",
    accent: "#f38020",
    quickLinks: [
      {
        label: "Domains",
        url: "https://dash.cloudflare.com/85d376fc54617bcb57185547f08e528b/domains/overview",
      },
      {
        label: "Workers",
        url: "https://dash.cloudflare.com/85d376fc54617bcb57185547f08e528b/workers-and-pages",
      },
      {
        label: "AI",
        url: "https://dash.cloudflare.com/85d376fc54617bcb57185547f08e528b/ai/ai-gateway/gateways",
      },
      {
        label: "Images",
        url: "https://dash.cloudflare.com/85d376fc54617bcb57185547f08e528b/images/hosted?stamp=1780813063881",
      },
      {
        label: "Videos",
        url: "https://dash.cloudflare.com/85d376fc54617bcb57185547f08e528b/stream/videos",
      },
    ],
  },
  {
    name: "Google Cloud",
    domain: "console.cloud.google.com",
    url: "https://console.cloud.google.com",
    icon: "cloud",
    accent: "#4285f4",
  },
  {
    name: "App Store Connect",
    domain: "appstoreconnect.apple.com",
    url: "https://appstoreconnect.apple.com",
    icon: "app-store",
    accent: "#0a84ff",
  },
  {
    name: "GitHub",
    domain: "github.com",
    url: "https://github.com",
    icon: "github",
    accent: "#c9d1d9",
    quickLinks: [
      { label: "Pull Requests", url: "https://github.com/pulls" },
      {
        label: "Repositories",
        url: "https://github.com/aloewright?tab=repositories",
      },
      { label: "Feed", url: "https://github.com/dashboard-feed" },
    ],
  },
  {
    name: "Linear",
    domain: "linear.app",
    url: "https://linear.app/aloey",
    icon: "linear",
    accent: "#5e6ad2",
  },
  {
    name: "Blog Editor",
    domain: "dev.aloewright.com",
    url: "https://dev.aloewright.com",
    icon: "pencil",
    accent: "#f2c14e",
  },
  {
    name: "Blog",
    domain: "aloewright.com",
    url: "https://aloewright.com",
    icon: "article",
    accent: "#61d394",
  },
  {
    name: "Book Editor",
    domain: "book-cook.com",
    url: "https://book-cook.com",
    icon: "book",
    accent: "#f78154",
  },
  {
    name: "Design System Generator",
    domain: "so.makethe.app",
    url: "https://so.makethe.app",
    icon: "palette",
    accent: "#c77dff",
  },
  {
    name: "Directory",
    domain: "makethe.app",
    url: "https://makethe.app",
    icon: "directory",
    accent: "#90be6d",
  },
  {
    name: "Video Manager",
    domain: "spooool.com",
    url: "https://spooool.com",
    icon: "video",
    accent: "#ff6b6b",
  },
];

/**
 * Restore built-in quick links onto apps that share a built-in's URL but lack
 * them. Apps edited in older builds (before the edit dialog preserved
 * `quickLinks`) were persisted as custom entries without quick links while the
 * built-in that owns them was hidden — so the custom entry permanently shadowed
 * the built-in and its quick links disappeared. Backfilling by URL self-heals
 * that state. An app that already has its own quick links is left untouched.
 *
 * Matching is done on a normalized URL (lowercased host, no trailing slash, no
 * search/hash on a bare-host URL) so a stored entry that drifted from the
 * built-in by something cosmetic — e.g. a trailing slash from an older
 * normalizer — still recovers its quick links.
 */
function quickLinkMatchKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path && !parsed.search && !parsed.hash) {
      return `${parsed.protocol}//${host}`;
    }
    return `${parsed.protocol}//${host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

export function backfillBuiltinQuickLinks(apps: WorkspaceApp[]): WorkspaceApp[] {
  const builtinLinks = new Map<string, WorkspaceAppQuickLink[]>(
    WORKSPACE_APPS.filter((app) => app.quickLinks?.length).map((app) => [
      quickLinkMatchKey(app.url),
      app.quickLinks!,
    ]),
  );
  if (builtinLinks.size === 0) return apps;
  return apps.map((app) => {
    if (app.quickLinks?.length) return app;
    const links = builtinLinks.get(quickLinkMatchKey(app.url));
    return links ? { ...app, quickLinks: links } : app;
  });
}
