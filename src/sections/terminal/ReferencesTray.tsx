import { useState } from "react"
import type { Reference } from "../../types"
import { ReferenceChip } from "./ReferenceChip"

interface Props {
  references: Reference[]
  onRemove: (id: string) => void
  onClear: () => void
}

export function ReferencesTray({ references, onRemove, onClear }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const count = references.length

  return (
    <div className="border-t border-border bg-bg/60 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-fg/60 hover:text-fg"
          title={collapsed ? "Expand references" : "Collapse references"}>
          <span className="font-mono text-[10px]">{collapsed ? "▸" : "▾"}</span>
          <span>References</span>
          <span className="text-fg/40">({count})</span>
        </button>
        {count > 0 && !collapsed && (
          <button
            onClick={onClear}
            className="text-fg/40 hover:text-fg/80 text-[10px] uppercase tracking-wider"
            title="Remove all references">
            Clear all
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="px-3 pb-2">
          {count === 0 ? (
            <div className="text-fg/30 text-[11px]">
              No references yet. Use [+ Reference] above to capture an element from the active tab.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {references.map((r) => (
                <ReferenceChip key={r.id} reference={r} onRemove={onRemove} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
