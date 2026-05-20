export function EmptyState({ message }: { message: string }) {
  return <div className="text-sm text-muted p-6 text-center">{message}</div>
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="text-sm text-red-400 p-6 text-center" role="alert">
      {message}
    </div>
  )
}

export function Loading() {
  return <div className="text-sm text-muted p-6 text-center">Loading…</div>
}
