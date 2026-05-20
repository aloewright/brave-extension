const COLOURS: Record<string, string> = {
  pending: "bg-muted/20 text-muted",
  transcribing: "bg-blue-500/20 text-blue-300",
  extracting: "bg-blue-500/20 text-blue-300",
  embedding: "bg-purple-500/20 text-purple-300",
  ready: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-red-500/20 text-red-300"
}

export function StatusBadge({ status }: { status: string }) {
  const cls = COLOURS[status] ?? "bg-muted/20 text-muted"
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-mono uppercase ${cls}`}>
      {status}
    </span>
  )
}
