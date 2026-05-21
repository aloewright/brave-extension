export type SectionId =
  | "terminal"
  | "inspector"
  | "extensions"
  | "tech"
  | "session"
  | "bookmarks"
  | "captures"
  | "cookies"
  | "recorder"
  | "eyedropper"
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
  { id: "bookmarks", label: "Bookmarks" },
  { id: "captures", label: "Page Captures" },
  { id: "cookies", label: "Cookies" },
  { id: "recorder", label: "Recorder" },
  { id: "eyedropper", label: "Eyedropper" },
  { id: "settings", label: "Settings" },
];
