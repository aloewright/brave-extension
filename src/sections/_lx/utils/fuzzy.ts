export interface FuzzyResult<T> {
  item: T
  score: number
  matches: number[][]
}

/**
 * Simple fuzzy match: characters must appear in order but not consecutively.
 * Returns a score (lower = better) and match indices, or null if no match.
 */
export function fuzzyMatch(query: string, target: string): { score: number; matches: number[][] } | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()

  if (q.length === 0) return { score: 0, matches: [] }
  if (q.length > t.length) return null

  // Check if all characters exist in order
  let qi = 0
  let lastIdx = -1
  const matchIndices: number[] = []
  let score = 0

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      matchIndices.push(ti)
      // Bonus for consecutive matches
      const gap = lastIdx === -1 ? 0 : ti - lastIdx - 1
      score += gap
      // Bonus for matching at word boundaries
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-" || t[ti - 1] === "_") {
        score -= 2
      }
      lastIdx = ti
      qi++
    }
  }

  if (qi < q.length) return null

  // Group consecutive indices into ranges for highlighting
  const ranges: number[][] = []
  let start = matchIndices[0]
  let end = matchIndices[0]
  for (let i = 1; i < matchIndices.length; i++) {
    if (matchIndices[i] === end + 1) {
      end = matchIndices[i]
    } else {
      ranges.push([start, end])
      start = matchIndices[i]
      end = matchIndices[i]
    }
  }
  if (matchIndices.length > 0) ranges.push([start, end])

  // Prefer shorter targets and earlier matches
  score += matchIndices[0] * 0.5
  score += (t.length - q.length) * 0.1

  return { score, matches: ranges }
}

/**
 * Search a list of items with fuzzy matching, returning sorted results.
 */
export function fuzzySearch<T>(
  items: T[],
  query: string,
  keys: ((item: T) => string)[]
): FuzzyResult<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, score: 0, matches: [] }))

  const results: FuzzyResult<T>[] = []

  for (const item of items) {
    let bestScore = Infinity
    let bestMatches: number[][] = []

    for (const key of keys) {
      const value = key(item)
      const result = fuzzyMatch(query, value)
      if (result && result.score < bestScore) {
        bestScore = result.score
        bestMatches = result.matches
      }
    }

    if (bestScore < Infinity) {
      results.push({ item, score: bestScore, matches: bestMatches })
    }
  }

  return results.sort((a, b) => a.score - b.score)
}

/**
 * Generate autocomplete suggestions from fuzzy results.
 */
export function getSuggestions<T>(
  results: FuzzyResult<T>[],
  labelFn: (item: T) => string,
  limit = 6
): string[] {
  return results.slice(0, limit).map((r) => labelFn(r.item))
}
