export function RecordButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Open recorder"
      className="p-1.5 rounded transition-colors relative text-fg/60 hover:text-fg hover:bg-accent">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    </button>
  )
}
