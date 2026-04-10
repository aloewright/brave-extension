// Spaced-repetition review for highlights.
//
// The flow:
//   1. User captures a highlight (right-click selection on any page, or paste
//      in the Review panel's Add tab)
//   2. `generateCards` scans the text, picks the most "interesting" words or
//      proper-noun phrases, and emits a cloze card with those tokens blanked
//   3. `schedule` advances the card's due date based on a user's grade using
//      a small SM-2 derivative (Again/Hard/Good/Easy)
//
// Everything lives in chrome.storage.local so it survives extension reloads
// but stays per-install.

export interface Highlight {
  id: string
  text: string
  sourceUrl?: string
  sourceTitle?: string
  createdAt: number
}

export type Grade = "again" | "hard" | "good" | "easy"

export interface Card {
  id: string
  highlightId: string
  /** Text with `{{n}}` placeholders where answers[n] belongs. */
  front: string
  answers: string[]
  // SM-2 state
  ease: number
  interval: number // days
  reps: number
  lapses: number
  due: number // timestamp (ms)
  createdAt: number
}

// ─── Storage ──────────────────────────────────────────────────────────

const HIGHLIGHTS_KEY = "ai-dev-highlights"
const CARDS_KEY = "ai-dev-review-cards"

export async function getHighlights(): Promise<Highlight[]> {
  const r = await chrome.storage.local.get(HIGHLIGHTS_KEY)
  return (r[HIGHLIGHTS_KEY] as Highlight[]) || []
}

export async function getCards(): Promise<Card[]> {
  const r = await chrome.storage.local.get(CARDS_KEY)
  return (r[CARDS_KEY] as Card[]) || []
}

export async function addHighlight(h: Highlight): Promise<Card[]> {
  const [all, existingCards] = await Promise.all([getHighlights(), getCards()])
  all.push(h)
  const newCards = generateCards(h)
  await chrome.storage.local.set({
    [HIGHLIGHTS_KEY]: all,
    [CARDS_KEY]: [...existingCards, ...newCards]
  })
  return newCards
}

export async function deleteHighlight(id: string): Promise<void> {
  const [all, cards] = await Promise.all([getHighlights(), getCards()])
  await chrome.storage.local.set({
    [HIGHLIGHTS_KEY]: all.filter((h) => h.id !== id),
    [CARDS_KEY]: cards.filter((c) => c.highlightId !== id)
  })
}

export async function updateCard(card: Card): Promise<void> {
  const all = await getCards()
  const idx = all.findIndex((c) => c.id === card.id)
  if (idx === -1) return
  all[idx] = card
  await chrome.storage.local.set({ [CARDS_KEY]: all })
}

export async function getDueCards(): Promise<Card[]> {
  const now = Date.now()
  const all = await getCards()
  return all.filter((c) => c.due <= now).sort((a, b) => a.due - b.due)
}

// ─── Cloze generation ─────────────────────────────────────────────────
// Heuristic, dependency-free. Picks the 1–4 highest-scoring non-overlapping
// word spans and blanks them out. Proper-noun phrases (runs of consecutive
// capitalized tokens inside a sentence) are treated as single units so
// "Supreme Court" or "Ada Lovelace" get blanked together rather than piecewise.

const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","else","when","where","why","how",
  "what","who","whom","whose","which","is","are","was","were","be","been","being",
  "am","do","does","did","have","has","had","will","would","should","could","can",
  "may","might","must","shall","i","you","he","she","it","we","they","me","him",
  "her","us","them","my","your","his","its","our","their","this","that","these",
  "those","of","to","in","on","at","by","for","with","from","as","into","about",
  "over","under","again","further","once","here","there","all","any","both","each",
  "few","more","most","other","some","such","no","nor","not","only","own","same",
  "so","than","too","very","just","also","because","while","between","through",
  "during","before","after","above","below","up","down","out","off"
])

interface Span {
  start: number
  end: number
  text: string
  score: number
}

function tokenize(text: string): Span[] {
  const spans: Span[] = []
  const re = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], score: 0 })
  }
  return spans
}

function findSentenceStarts(text: string): Set<number> {
  const starts = new Set<number>([0])
  const re = /[.!?]\s+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    starts.add(m.index + m[0].length)
  }
  return starts
}

function scoreWord(word: string, isFirstInSentence: boolean): number {
  const lower = word.toLowerCase()
  if (STOPWORDS.has(lower)) return 0
  if (word.length < 4) return 0
  let score = 0
  if (word.length >= 5) score += 1
  if (word.length >= 7) score += 1
  if (word.length >= 10) score += 1
  if (/\d/.test(word)) score += 3
  if (!isFirstInSentence && /^[A-Z]/.test(word)) score += 3
  if (word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word)) score += 2
  return score
}

function mergeProperNounPhrases(spans: Span[], text: string): Span[] {
  const sentenceStarts = findSentenceStarts(text)
  const result: Span[] = []
  let i = 0
  while (i < spans.length) {
    const s = spans[i]
    const isFirst = sentenceStarts.has(s.start)
    const isCap = /^[A-Z]/.test(s.text)
    if (isCap && !isFirst) {
      // Walk forward greedily while the next token is also capitalized and
      // separated only by whitespace/hyphen.
      let j = i + 1
      while (j < spans.length) {
        const next = spans[j]
        const between = text.slice(spans[j - 1].end, next.start)
        if (/^[A-Z]/.test(next.text) && /^[\s-]+$/.test(between)) j++
        else break
      }
      if (j > i + 1) {
        const merged: Span = {
          start: s.start,
          end: spans[j - 1].end,
          text: text.slice(s.start, spans[j - 1].end),
          score: 2 // phrase bonus
        }
        for (let k = i; k < j; k++) merged.score += scoreWord(spans[k].text, false)
        result.push(merged)
        i = j
        continue
      }
    }
    result.push({ ...s, score: scoreWord(s.text, isFirst) })
    i++
  }
  return result
}

function pickBlanks(scored: Span[], wordCount: number): Span[] {
  const target = Math.max(1, Math.min(4, Math.round(wordCount / 12)))
  const sorted = [...scored].filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  const picked: Span[] = []
  for (const span of sorted) {
    if (picked.length >= target) break
    const overlaps = picked.some((p) => !(span.end <= p.start || span.start >= p.end))
    if (!overlaps) picked.push(span)
  }
  picked.sort((a, b) => a.start - b.start)
  return picked
}

/**
 * Emit cards for a highlight. Returns [] if the text is too short or no
 * blank-worthy tokens were found (e.g. all stopwords).
 */
export function generateCards(highlight: Highlight): Card[] {
  const text = highlight.text.trim()
  if (text.length < 20) return []
  const spans = tokenize(text)
  if (spans.length < 4) return []
  const scored = mergeProperNounPhrases(spans, text)
  const blanks = pickBlanks(scored, spans.length)
  if (blanks.length === 0) return []

  let front = ""
  let cursor = 0
  const answers: string[] = []
  blanks.forEach((b, i) => {
    front += text.slice(cursor, b.start) + `{{${i}}}`
    answers.push(b.text)
    cursor = b.end
  })
  front += text.slice(cursor)

  const now = Date.now()
  return [
    {
      id: crypto.randomUUID(),
      highlightId: highlight.id,
      front,
      answers,
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      due: now,
      createdAt: now
    }
  ]
}

// ─── Scheduler ────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000

export function schedule(card: Card, grade: Grade): Card {
  const next: Card = { ...card }
  if (grade === "again") {
    next.reps = 0
    next.lapses += 1
    next.interval = 0
    next.ease = Math.max(1.3, card.ease - 0.2)
    next.due = Date.now() + 10 * 60 * 1000 // 10 minutes
    return next
  }
  const delta = grade === "hard" ? -0.15 : grade === "good" ? 0 : 0.15
  next.ease = Math.max(1.3, card.ease + delta)
  next.reps = card.reps + 1
  if (next.reps === 1) {
    next.interval = grade === "easy" ? 3 : 1
  } else if (next.reps === 2) {
    next.interval = grade === "easy" ? 7 : grade === "hard" ? 3 : 6
  } else {
    const mult = grade === "hard" ? 1.2 : next.ease
    next.interval = Math.max(1, Math.round(card.interval * mult))
  }
  next.due = Date.now() + next.interval * DAY
  return next
}

// ─── Rendering ────────────────────────────────────────────────────────

/** Replace `{{n}}` with either a length-matched blank or the answer. */
export function renderFront(front: string, answers: string[], reveal: boolean): string {
  return front.replace(/\{\{(\d+)\}\}/g, (_, i) => {
    const idx = parseInt(i, 10)
    if (reveal) return answers[idx] ?? "____"
    const len = Math.max(3, Math.min(14, answers[idx]?.length ?? 5))
    return "▁".repeat(len)
  })
}
