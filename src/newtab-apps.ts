export interface WorkspaceApp {
  name: string
  domain: string
  url: string
  initials: string
  accent: string
}

export const WORKSPACE_APPS: WorkspaceApp[] = [
  {
    name: "Blog",
    domain: "aloewright.com",
    url: "https://aloewright.com",
    initials: "BL",
    accent: "#61d394"
  },
  {
    name: "Blog Editor",
    domain: "dev.aloewright.com",
    url: "https://dev.aloewright.com",
    initials: "BE",
    accent: "#f2c14e"
  },
  {
    name: "Book Editor",
    domain: "book-cook.com",
    url: "https://book-cook.com",
    initials: "BK",
    accent: "#f78154"
  },
  {
    name: "Link Shortener",
    domain: "fly.pm",
    url: "https://fly.pm",
    initials: "FL",
    accent: "#4cc9f0"
  },
  {
    name: "Chat",
    domain: "alex.chat",
    url: "https://alex.chat",
    initials: "CH",
    accent: "#b8f2e6"
  },
  {
    name: "Daily Planner",
    domain: "alex.coffee",
    url: "https://alex.coffee",
    initials: "DP",
    accent: "#d6a75d"
  },
  {
    name: "Design System Generator",
    domain: "so.makethe.app",
    url: "https://so.makethe.app",
    initials: "DS",
    accent: "#c77dff"
  },
  {
    name: "Directory",
    domain: "makethe.app",
    url: "https://makethe.app",
    initials: "DR",
    accent: "#90be6d"
  },
  {
    name: "Video Manager",
    domain: "spooool.com",
    url: "https://spooool.com",
    initials: "VM",
    accent: "#ff6b6b"
  }
]
