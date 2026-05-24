import { useState, useEffect, useCallback, useRef } from "react"
import type { Highlight, Card, Grade } from "../review"
import {
  getHighlights,
  addHighlight,
  deleteHighlight,
  getCards,
  getDueCards,
  updateCard,
  generateCards,
  schedule,
  renderFront
} from "../review"

interface Props {
  onClose: () => void
}

type View = "review" | "list" | "add"

export function ReviewPanel({ onClose }: Props) {
  const [view, setView] = useState<View>("review")
  const [dueCards, setDueCards] = useState<Card[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [allCards, setAllCards] = useState<Card[]>([])
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const [newText, setNewText] = useState("")
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  const refresh = useCallback(async () => {
    const [hs, cs, due] = await Promise.all([getHighlights(), getCards(), getDueCards()])
    setHighlights(hs.sort((a, b) => b.createdAt - a.createdAt))
    setAllCards(cs)
    setDueCards(due)
  }, [])

  // Initial load
  useEffect(() => {
    refresh()
  }, [refresh])

  // Auto-refresh when storage changes (e.g. context-menu captures)
  useEffect(() => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes["ai-dev-highlights"] || changes["ai-dev-review-cards"]) {
        refresh()
      }
    }
    chrome.storage.onChanged.addListener(onChange)
    return () => chrome.storage.onChanged.removeListener(onChange)
  }, [refresh])

  const current = dueCards[index]

  const advance = useCallback(async () => {
    setRevealed(false)
    setDrag(null)
    // Pull fresh due list — card we just rated is no longer due
    const due = await getDueCards()
    setDueCards(due)
    setIndex(0)
  }, [])

  const rate = useCallback(
    async (grade: Grade) => {
      if (!current) return
      await updateCard(schedule(current, grade))
      await advance()
    },
    [current, advance]
  )

  // ─── Pointer gestures ───────────────────────────────────────────────
  // Click (no drag) → reveal. After reveal, swipe to grade:
  //   left=Again  right=Good  up=Easy  down=Hard
  // Threshold is 70px; anything smaller returns to rest.
  const onPointerDown = (e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerStart.current) return
    setDrag({
      dx: e.clientX - pointerStart.current.x,
      dy: e.clientY - pointerStart.current.y
    })
  }
  const onPointerUp = () => {
    if (!pointerStart.current) return
    const d = drag || { dx: 0, dy: 0 }
    pointerStart.current = null
    const absX = Math.abs(d.dx)
    const absY = Math.abs(d.dy)
    const isClick = absX < 6 && absY < 6

    if (isClick) {
      if (!revealed) setRevealed(true)
      setDrag(null)
      return
    }
    if (!revealed) {
      setDrag(null)
      return
    }
    const threshold = 70
    if (absX > absY && absX > threshold) {
      rate(d.dx > 0 ? "good" : "again")
    } else if (absY >= absX && absY > threshold) {
      rate(d.dy > 0 ? "hard" : "easy")
    } else {
      setDrag(null)
    }
  }

  // ─── Add highlight ─────────────────────────────────────────────────
  const saveHighlight = async () => {
    const text = newText.trim()
    if (text.length < 20) return
    await addHighlight({
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now()
    })
    setNewText("")
    setView("review")
  }

  const removeHighlight = async (id: string) => {
    await deleteHighlight(id)
  }

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <div className="w-full h-screen bg-bg text-fg font-sans flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-accent text-fg/40 hover:text-fg transition-colors"
          title="Back"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="text-xs font-medium flex-1">Review</div>
        <div className="text-[10px] text-fg/40 font-mono">
          {dueCards.length} due · {allCards.length} total
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 py-1.5 border-b border-border flex gap-1">
        {(["review", "list", "add"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => {
              setView(v)
              setIndex(0)
              setRevealed(false)
              setDrag(null)
            }}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${
              view === v ? "bg-accent text-fg" : "text-fg/50 hover:text-fg"
            }`}
          >
            {v === "review"
              ? "Review"
              : v === "list"
                ? `Highlights (${highlights.length})`
                : "Add"}
          </button>
        ))}
      </div>

      {view === "review" && (
        <div className="flex-1 flex flex-col items-center justify-between px-4 py-6 min-h-0 gap-4">
          {!current ? (
            <div className="flex-1 flex items-center justify-center text-center">
              <div>
                <div className="text-fg/30 text-sm mb-2">No cards due</div>
                <div className="text-fg/20 text-[11px] max-w-[260px]">
                  {highlights.length === 0
                    ? "Add a highlight in the Add tab, or right-click selected text on any page → Save snippet."
                    : "Nothing due right now. Come back later or add more highlights."}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Progress */}
              <div className="w-full flex items-center gap-2 text-[10px] text-fg/40 font-mono">
                <span>
                  {index + 1} / {dueCards.length}
                </span>
                <div className="flex-1 h-0.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/60 transition-all"
                    style={{ width: `${((index + 1) / dueCards.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Card (3D flip) */}
              <div
                className="w-full flex-1 flex items-center justify-center"
                style={{ perspective: "1200px", touchAction: "none" }}
              >
                <div
                  className="relative w-full max-w-md aspect-[3/4] cursor-grab active:cursor-grabbing select-none"
                  style={{
                    transformStyle: "preserve-3d",
                    transition: drag ? "none" : "transform 0.5s",
                    transform: buildCardTransform(drag, revealed),
                    opacity: drag
                      ? 1 - Math.min(0.35, Math.hypot(drag.dx, drag.dy) / 500)
                      : 1
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => {
                    pointerStart.current = null
                    setDrag(null)
                  }}
                >
                  {/* Front */}
                  <CardFace
                    labelClass="text-fg/30"
                    label="Fill in the blanks"
                    footer="Tap to reveal"
                  >
                    <span className="whitespace-pre-wrap">
                      {renderFront(current.front, current.answers, false)}
                    </span>
                  </CardFace>
                  {/* Back */}
                  <CardFace
                    labelClass="text-primary/60"
                    label="Answer"
                    footer="Swipe or pick how well you knew it"
                    back
                  >
                    <span className="whitespace-pre-wrap">
                      {renderRevealed(current.front, current.answers)}
                    </span>
                  </CardFace>
                </div>
              </div>

              {/* Swipe hint overlay */}
              {drag && revealed && <SwipeHint drag={drag} />}

              {/* Grade buttons */}
              <div className="w-full grid grid-cols-4 gap-1.5">
                <GradeButton
                  label="Again"
                  hint="←"
                  color="bg-error/20 text-error hover:bg-error/30"
                  disabled={!revealed}
                  onClick={() => rate("again")}
                />
                <GradeButton
                  label="Hard"
                  hint="↓"
                  color="bg-warning/20 text-warning hover:bg-warning/30"
                  disabled={!revealed}
                  onClick={() => rate("hard")}
                />
                <GradeButton
                  label="Good"
                  hint="→"
                  color="bg-success/20 text-success hover:bg-success/30"
                  disabled={!revealed}
                  onClick={() => rate("good")}
                />
                <GradeButton
                  label="Easy"
                  hint="↑"
                  color="bg-info/20 text-info hover:bg-info/30"
                  disabled={!revealed}
                  onClick={() => rate("easy")}
                />
              </div>
            </>
          )}
        </div>
      )}

      {view === "list" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {highlights.length === 0 ? (
            <div className="text-fg/30 text-xs text-center py-8 px-4">
              No highlights yet. Add one in the{" "}
              <span className="font-medium">Add</span> tab, or right-click
              selected text on any page and choose{" "}
              <span className="font-medium">Save snippet</span>.
            </div>
          ) : (
            highlights.map((h) => {
              const hCards = allCards.filter((c) => c.highlightId === h.id)
              return (
                <div key={h.id} className="rounded-lg border border-border bg-card p-3">
                  <div
                    className="text-[11px] text-fg leading-snug mb-2 whitespace-pre-wrap"
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden"
                    }}
                  >
                    {h.text}
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-fg/40 font-mono gap-2">
                    <div className="truncate flex-1">
                      {hCards.length} card{hCards.length === 1 ? "" : "s"}
                      {h.sourceTitle && ` · ${h.sourceTitle}`}
                    </div>
                    <button
                      onClick={() => removeHighlight(h.id)}
                      className="text-error/70 hover:text-error flex-shrink-0"
                    >
                      delete
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {view === "add" && (
        <div className="flex-1 flex flex-col p-3 gap-3 min-h-0">
          <div className="text-[11px] text-fg/40">
            Paste a highlight. Key words and proper-noun phrases are detected
            automatically and blanked out for review.
          </div>
          <textarea
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="Paste a passage, quote, or fact..."
            className="flex-1 text-xs p-3 rounded-lg bg-input border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 resize-none font-mono leading-relaxed min-h-[140px]"
          />
          {newText.trim().length >= 20 && <ClozePreview text={newText.trim()} />}
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-fg/30 font-mono">
              {newText.length} chars
            </div>
            <button
              onClick={saveHighlight}
              disabled={newText.trim().length < 20}
              className="text-[11px] px-3 py-1.5 rounded bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Save highlight
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers & subcomponents ────────────────────────────────────────

function buildCardTransform(
  drag: { dx: number; dy: number } | null,
  revealed: boolean
): string {
  const parts: string[] = []
  if (drag) {
    parts.push(`translate(${drag.dx}px, ${drag.dy}px)`)
    parts.push(`rotate(${drag.dx * 0.04}deg)`)
  }
  if (revealed) parts.push("rotateY(180deg)")
  return parts.length ? parts.join(" ") : "none"
}

function renderRevealed(front: string, answers: string[]): React.ReactNode {
  // Highlight the revealed answers so they pop visually on the back face
  const parts = front.split(/(\{\{\d+\}\})/g)
  return parts.map((p, i) => {
    const m = p.match(/^\{\{(\d+)\}\}$/)
    if (!m) return <span key={i}>{p}</span>
    const idx = parseInt(m[1], 10)
    return (
      <span
        key={i}
        className="font-semibold text-primary bg-primary/10 rounded px-0.5"
      >
        {answers[idx] ?? "____"}
      </span>
    )
  })
}

interface FaceProps {
  label: string
  footer: string
  labelClass: string
  back?: boolean
  children: React.ReactNode
}

function CardFace({ label, footer, labelClass, back, children }: FaceProps) {
  return (
    <div
      className={`absolute inset-0 rounded-xl border ${
        back ? "border-primary/30" : "border-border"
      } bg-card p-5 flex flex-col justify-center shadow-lg`}
      style={{
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : undefined
      } as React.CSSProperties}
    >
      <div className={`text-[10px] uppercase tracking-wider mb-3 ${labelClass}`}>
        {label}
      </div>
      <div className="text-sm text-fg leading-relaxed flex-1 overflow-y-auto">
        {children}
      </div>
      <div className="pt-4 text-[10px] text-fg/30 text-center">{footer}</div>
    </div>
  )
}

function SwipeHint({ drag }: { drag: { dx: number; dy: number } }) {
  const { dx, dy } = drag
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  let label = ""
  let color = "text-fg/30"
  if (absX < 40 && absY < 40) return null
  if (absX > absY) {
    label = dx > 0 ? "Good →" : "← Again"
    color = dx > 0 ? "text-success" : "text-error"
  } else {
    label = dy > 0 ? "↓ Hard" : "↑ Easy"
    color = dy > 0 ? "text-warning" : "text-info"
  }
  return (
    <div
      className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-sm font-semibold pointer-events-none ${color}`}
    >
      {label}
    </div>
  )
}

function GradeButton({
  label,
  hint,
  color,
  onClick,
  disabled
}: {
  label: string
  hint: string
  color: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md py-2 text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center ${color}`}
    >
      <div>{label}</div>
      <div className="text-[9px] opacity-60">{hint}</div>
    </button>
  )
}

function ClozePreview({ text }: { text: string }) {
  const [card] = generateCards({ id: "preview", text, createdAt: 0 })
  if (!card) {
    return (
      <div className="text-[10px] text-fg/30 italic">
        Not enough content to auto-generate a card yet.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3 text-[11px] text-fg/70 leading-relaxed">
      <div className="text-[9px] text-fg/30 uppercase tracking-wider mb-1.5">
        Preview ({card.answers.length} blank{card.answers.length === 1 ? "" : "s"})
      </div>
      {renderFront(card.front, card.answers, false)}
    </div>
  )
}
