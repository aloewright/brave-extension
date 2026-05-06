export type SectionId =
  | "terminal"
  | "inspector"
  | "extensions"
  | "library"
  | "cookies"
  | "recorder"
  | "settings"

export interface SectionDef {
  id: SectionId
  label: string
  shortcut?: string
}

export const SECTIONS: SectionDef[] = [
  { id: "terminal", label: "Terminal" },
  { id: "inspector", label: "Inspector" },
  { id: "extensions", label: "Extensions" },
  { id: "library", label: "Library" },
  { id: "cookies", label: "Cookies" },
  { id: "recorder", label: "Recorder" },
  { id: "settings", label: "Settings" }
]
