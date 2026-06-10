export type SectionId =
  | "terminal"
  | "inspector"
  | "extensions"
  | "tech"
  | "session"
  | "email"
  | "quickInfo"
  | "tasks"
  | "passwords"
  | "bookmarks"
  | "captures"
  | "cookies"
  | "recorder"
  | "eyedropper"
  | "joplin"
  | "agentChat"
  | "github"
  | "settings";

export interface SectionDef {
  id: SectionId;
  label: string;
  shortcut?: string;
}

// ALO-470: rename Library → Session (snippets + links + paginated feeds).
// ALO-471: Tech/IP info moves to its own dedicated tab.
// ALO-468: Page Captures gets a dedicated tab (R2 + Vectorize).
export const SECTIONS: SectionDef[] = [
  { id: "terminal", label: "Terminal" },
  { id: "inspector", label: "Inspector" },
  { id: "extensions", label: "Extensions" },
  { id: "tech", label: "Tech" },
  { id: "session", label: "Session" },
  { id: "email", label: "Email" },
  { id: "quickInfo", label: "Contact Enrichment" },
  { id: "tasks", label: "Tasks" },
  { id: "passwords", label: "Passwords" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "captures", label: "Page Captures" },
  { id: "cookies", label: "Cookies" },
  // Recorder now lives inside Page Captures to free rail space.
  // { id: "recorder", label: "Recorder" },
  { id: "eyedropper", label: "Eyedropper" },
  // Temporarily hidden from the sidebar rail.
  // { id: "joplin", label: "Joplin" },
  { id: "agentChat", label: "Agent" },
  { id: "github", label: "GitHub" },
  { id: "settings", label: "Settings" },
];
