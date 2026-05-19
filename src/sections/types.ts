export type SectionId =
  | "terminal"
  | "inspector"
  | "extensions"
  | "library"
  | "cookies"
  | "recorder"
  | "eyedropper"
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
  { id: "eyedropper", label: "Eyedropper" },
  { id: "settings", label: "Settings" }
]
