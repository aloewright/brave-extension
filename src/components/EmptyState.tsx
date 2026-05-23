interface Props {
  title: string
  hint?: string
}

export function EmptyState({ title, hint }: Props) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-fg/60">{title}</p>
      {hint && <p className="text-xs text-fg/30 mt-1">{hint}</p>}
    </div>
  )
}
