import { useEffect, useMemo, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { prepare, layout } from "@chenglou/pretext"
import type { ChatMessage, CLIBackend } from "../types"
import { ChatMessageBubble } from "./ChatMessage"
import { LoadingDots } from "./LoadingDots"

/**
 * Virtualized chat list — renders only visible messages so the chat stays
 * performant regardless of history size.
 *
 * Height strategy:
 *   1. Pretext gives a fast initial estimate from raw text + font + width.
 *      That estimate seeds the virtualizer so the first render isn't janky.
 *   2. After mount, the virtualizer measures each row's actual DOM height
 *      (handles padding, borders, code blocks, markdown — everything Pretext
 *      can't see) and replaces the estimate.
 *
 * The "clear" message role is special-cased to use the full container height,
 * pushing previous content above the viewport.
 */

const FONT_SPEC = "12px Inter, system-ui, sans-serif"
const LINE_HEIGHT = 18 // matches text-xs leading-relaxed

// Fixed overhead per message bubble: padding (16px) + backend label (16px) +
// timestamp (12px) + outer margin (12px). Tweak if styling changes.
const BUBBLE_OVERHEAD = 56

// Minimum height for any non-clear message (avoids zero-height collapse)
const MIN_BUBBLE_HEIGHT = 36

// Cache height estimates by message id so we don't re-measure on every render
const heightCache = new Map<string, number>()

export function stripFormatting(content: string): string {
  // Strip ANSI escape codes, code-fence markers, and inline-code backticks
  // so Pretext measures something close to the rendered text.
  return content
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/```\w*\n?/g, "")
    .replace(/`/g, "")
    .replace(/\*\*/g, "")
}

/**
 * Compute the extra vertical space added by fenced code blocks in a message.
 *
 * Exposed for unit tests (PDX-124) so the regression around
 * `String.prototype.match` returning `null` — which previously poisoned
 * `Array.prototype.reduce`'s accumulator type as `never` when paired with
 * the `|| []` fallback — stays locked in. We use `?? []` with an explicit
 * `string[]` annotation so reduce infers the accumulator as `number`.
 */
export function codeBlockOverhead(content: string): number {
  const codeBlocks: string[] = content.match(/```[\s\S]*?```/g) ?? []
  return codeBlocks.reduce<number>((sum, block) => {
    const lines = block.split("\n").length
    return sum + lines * 16 + 16 // ~16px per line + 16px padding
  }, 0)
}

function estimateHeight(message: ChatMessage, width: number): number {
  if (message.role === "clear") {
    // Spacer — sized at render time from the scroll container's clientHeight
    return Math.max(window.innerHeight - 200, 400)
  }

  const cached = heightCache.get(message.id)
  if (cached) return cached

  if (!message.content) return MIN_BUBBLE_HEIGHT + BUBBLE_OVERHEAD

  // Bubble takes ~95% of width minus 24px horizontal padding
  const textWidth = Math.max(width * 0.95 - 24, 100)

  let textHeight = 0
  try {
    const prepared = prepare(stripFormatting(message.content), FONT_SPEC)
    const result = layout(prepared, textWidth, LINE_HEIGHT)
    textHeight = result.height
  } catch {
    // Fallback: rough estimate from char count
    const charsPerLine = Math.max(textWidth / 7, 20)
    const lines = Math.ceil(message.content.length / charsPerLine)
    textHeight = lines * LINE_HEIGHT
  }

  // Code blocks add vertical space (padding + monospace line height)
  const codeOverhead = codeBlockOverhead(message.content)

  const total = Math.max(textHeight + codeOverhead + BUBBLE_OVERHEAD, MIN_BUBBLE_HEIGHT + BUBBLE_OVERHEAD)
  heightCache.set(message.id, total)
  return total
}

interface VirtualizedChatProps {
  messages: ChatMessage[]
  streamBuffer?: string
  streamBackend?: ChatMessage["backend"]
  isLoading?: boolean
  loadingBackend?: CLIBackend
  emptyState?: React.ReactNode
}

const LOADING_ITEM_ID = "__loading__"

export function VirtualizedChat({
  messages,
  streamBuffer,
  streamBackend,
  isLoading,
  loadingBackend,
  emptyState
}: VirtualizedChatProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const containerWidth = useRef<number>(360)

  // Construct the rendered list — messages plus optional streaming bubble or loading dots
  const items = useMemo(() => {
    const out: ChatMessage[] = [...messages]
    if (streamBuffer) {
      out.push({
        id: "__streaming__",
        role: "assistant",
        content: streamBuffer,
        timestamp: Date.now(),
        backend: streamBackend,
        isStreaming: true
      })
    } else if (isLoading) {
      // Synthetic loading marker — rendered specially below as <LoadingDots>
      out.push({
        id: LOADING_ITEM_ID,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
        backend: loadingBackend
      })
    }
    return out
  }, [messages, streamBuffer, streamBackend, isLoading, loadingBackend])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => estimateHeight(items[index], containerWidth.current),
    overscan: 8,
    getItemKey: (index) => items[index].id,
    measureElement: (el) => el.getBoundingClientRect().height
  })

  // Track container width so estimates stay accurate on resize
  useEffect(() => {
    if (!parentRef.current) return
    const observer = new ResizeObserver((entries) => {
      const newWidth = entries[0].contentRect.width
      if (Math.abs(newWidth - containerWidth.current) > 4) {
        containerWidth.current = newWidth
        // Width changed — flush cached heights and remeasure
        heightCache.clear()
        virtualizer.measure()
      }
    })
    observer.observe(parentRef.current)
    return () => observer.disconnect()
  }, [virtualizer])

  // Auto-scroll to bottom when items change (new message or streaming update)
  useEffect(() => {
    if (items.length === 0) return
    // Use rAF so the virtualizer has measured the new row first
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(items.length - 1, { align: "end" })
    })
  }, [items.length, streamBuffer, virtualizer])

  if (items.length === 0) {
    return (
      <div ref={parentRef} className="flex-1 overflow-y-auto py-2">
        {emptyState}
      </div>
    )
  }

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto py-2 contain-strict">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative"
        }}
      >
        {virtualItems.map((vi) => {
          const message = items[vi.index]
          const isLoadingItem = message.id === LOADING_ITEM_ID
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vi.start}px)`
              }}
            >
              {isLoadingItem ? (
                <LoadingDots backend={message.backend} />
              ) : (
                <ChatMessageBubble message={message} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
