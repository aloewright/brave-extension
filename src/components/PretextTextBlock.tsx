import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react"
import { estimateMessageHeight } from "../lib/pretext-layout"

export function PretextTextBlock({
  text,
  markdown = false,
  verticalPadding = 0,
  className = "",
  style,
  children
}: {
  text: string
  markdown?: boolean
  verticalPadding?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const predictedHeight = useMemo(
    () => estimateMessageHeight(text, width, { markdown, verticalPadding }),
    [markdown, text, verticalPadding, width]
  )

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setWidth(Math.round(node.clientWidth))
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      style={{ ...style, ...(predictedHeight ? { minHeight: `${predictedHeight}px` } : {}) }}
      className={className}
    >
      {children}
    </div>
  )
}
