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
