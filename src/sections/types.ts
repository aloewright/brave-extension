export type SectionId =
  | "terminal"
  | "inspector"
  | "extensions"
  | "tech"
  | "session"
  | "quickInfo"
  | "tasks"
  | "passwords"
  | "bookmarks"
  | "captures"
  | "cookies"
  | "recorder"
  | "eyedropper"
  | "joplin"
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
  { id: "quickInfo", label: "Contact Enrichment" },
  { id: "tasks", label: "Tasks" },
  { id: "passwords", label: "Passwords" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "captures", label: "Page Captures" },
  { id: "cookies", label: "Cookies" },
  { id: "recorder", label: "Recorder" },
  { id: "eyedropper", label: "Eyedropper" },
  // AI Chat is now stacked inside the Joplin section (clipper on top, chat
  // below) rather than carrying its own rail entry.
  { id: "joplin", label: "Joplin" },
  { id: "github", label: "GitHub" },
  { id: "settings", label: "Settings" },
];
