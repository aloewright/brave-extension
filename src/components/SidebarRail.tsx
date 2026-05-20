import type { SectionId } from "../sections/types";
import { SECTIONS } from "../sections/types";
import { LeoIcon, type LeoIconName } from "./leo";

interface Props {
  active: SectionId;
  onChange: (id: SectionId) => void;
}

const ICONS: Record<SectionId, LeoIconName> = {
  terminal: "terminal",
  inspector: "search",
  extensions: "puzzle-piece",
  library: "inbox",
  bookmarks: "product-bookmarks",
  cookies: "cookie",
  recorder: "radio-checked",
  eyedropper: "paint-brush",
  settings: "settings",
};

export function SidebarRail({ active, onChange }: Props) {
  return (
    <nav className="flex flex-col items-center gap-1 px-1.5 py-2 border-r border-border bg-bg/50">
      {SECTIONS.map((s) => {
        const isActive = s.id === active;
        return (
          <button
            key={s.id}
            onClick={() => onChange(s.id)}
            title={s.label}
            aria-label={s.label}
            aria-pressed={isActive}
            className={`p-2 rounded transition-colors ${
              isActive
                ? "bg-accent text-fg"
                : "text-fg/40 hover:bg-accent/50 hover:text-fg"
            }`}
          >
            <LeoIcon name={ICONS[s.id]} size={16} />
          </button>
        );
      })}
    </nav>
  );
}
