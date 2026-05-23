interface Props {
  title: string
  milestone: string
  blurb: string
}

export function ComingSoon({ title, milestone, blurb }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 gap-3">
      <div className="text-fg/30 text-lg font-medium">{title}</div>
      <div className="text-fg/40 text-xs uppercase tracking-wide">{milestone}</div>
      <div className="text-fg/30 text-xs max-w-xs leading-relaxed">{blurb}</div>
    </div>
  )
}
