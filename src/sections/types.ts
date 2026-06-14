export type SectionId =
  | "terminal"
  | "inspector"
  | "pageStudio"
  | "extensions"
  | "session"
  | "email"
  | "quickInfo"
  // Perplexity is temporarily hidden while the remote-tab experiment is refined.
  | "perplexity"
  | "tasks"
  | "bookmarks"
  | "captures"
  | "cookies"
  | "recorder"
  | "eyedropper"
  | "joplin"
  | "agentChat"
  | "github"
  | "lexicon"
  | "settings";

export interface SectionDef {
  id: SectionId;
  label: string;
  shortcut?: string;
}

// ALO-470: rename Library → Session (highlights + links + paginated feeds).
// Tech/IP info and Eyedropper now live inside Inspector instead of consuming rail space.
// ALO-468: Page Captures gets a dedicated tab (R2 + Vectorize).
export const SECTIONS: SectionDef[] = [
  { id: "terminal", label: "Terminal" },
  { id: "inspector", label: "Inspector" },
  { id: "pageStudio", label: "Page Studio" },
  { id: "extensions", label: "Extensions" },
  { id: "session", label: "Session" },
  { id: "email", label: "Email" },
  { id: "quickInfo", label: "Contact Enrichment" },
  // { id: "perplexity", label: "Perplexity" },
  { id: "tasks", label: "Tasks" },
  // Passwords/Nodewarden is hidden while Proton handles password management.
  { id: "bookmarks", label: "Bookmarks" },
  { id: "captures", label: "Page Captures" },
  { id: "cookies", label: "Cookies" },
  // Recorder now lives inside Page Captures to free rail space.
  // { id: "recorder", label: "Recorder" },
  // Eyedropper now lives inside Inspector to free rail space.
  // { id: "eyedropper", label: "Eyedropper" },
  // Temporarily hidden from the sidebar rail.
  // { id: "joplin", label: "Joplin" },
  { id: "agentChat", label: "Agent" },
  { id: "github", label: "GitHub" },
  { id: "lexicon", label: "Lexicon" },
  { id: "settings", label: "Settings" },
];
