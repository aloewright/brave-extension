import type { BoxModel } from "../types"

interface Props {
  box: BoxModel
}

function fmt(n: number): string {
  if (n === 0) return "0"
  return Math.round(n) === n ? `${n}` : n.toFixed(1)
}

export function BoxModelView({ box }: Props) {
  return (
    <div className="font-mono text-[10px]">
      <div className="rounded bg-chart-3/10 border border-chart-3/30 p-1.5">
        <div className="text-chart-3/80 uppercase tracking-wider mb-1">margin</div>
        <Sides values={box.margin} />
        <div className="rounded bg-chart-4/10 border border-chart-4/30 p-1.5 mt-1.5">
          <div className="text-chart-4/80 uppercase tracking-wider mb-1">border</div>
          <Sides values={box.border} />
          <div className="rounded bg-chart-2/10 border border-chart-2/30 p-1.5 mt-1.5">
            <div className="text-chart-2/80 uppercase tracking-wider mb-1">padding</div>
            <Sides values={box.padding} />
            <div className="rounded bg-chart-1/10 border border-chart-1/30 p-2 mt-1.5 text-center">
              <div className="text-chart-1/80 uppercase tracking-wider mb-1">content</div>
              <div className="text-fg">
                {fmt(box.width)} × {fmt(box.height)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Sides({ values }: { values: { top: number; right: number; bottom: number; left: number } }) {
  return (
    <div className="grid grid-cols-3 gap-1 text-fg/70 text-center">
      <span />
      <span>{fmt(values.top)}</span>
      <span />
      <span>{fmt(values.left)}</span>
      <span />
      <span>{fmt(values.right)}</span>
      <span />
      <span>{fmt(values.bottom)}</span>
      <span />
    </div>
  )
}
