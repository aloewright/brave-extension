import { useState, useRef, useEffect } from "react"

interface Props {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  placeholder?: string
  className?: string
}

export function FuzzySearchInput({ value, onChange, suggestions, placeholder, className }: Props) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = value.trim()
    ? suggestions.filter((s) => s.toLowerCase() !== value.toLowerCase())
    : []

  useEffect(() => { setSelectedIdx(-1) }, [value])

  const accept = (suggestion: string) => {
    onChange(suggestion)
    setShowSuggestions(false)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filtered.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIdx((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIdx((prev) => Math.max(prev - 1, -1))
    } else if (e.key === "Enter" && selectedIdx >= 0) {
      e.preventDefault()
      accept(filtered[selectedIdx])
    } else if (e.key === "Escape") {
      setShowSuggestions(false)
    } else if (e.key === "Tab" && filtered.length > 0) {
      e.preventDefault()
      accept(filtered[selectedIdx >= 0 ? selectedIdx : 0])
    }
  }

  // Highlight matching characters in suggestion
  const highlight = (text: string, query: string) => {
    if (!query) return text
    const q = query.toLowerCase()
    const parts: { text: string; match: boolean }[] = []
    let qi = 0
    for (let i = 0; i < text.length; i++) {
      if (qi < q.length && text[i].toLowerCase() === q[qi]) {
        parts.push({ text: text[i], match: true })
        qi++
      } else {
        parts.push({ text: text[i], match: false })
      }
    }
    return (
      <>
        {parts.map((p, i) =>
          p.match ? <span key={i} className="text-chart-1 font-medium">{p.text}</span> : p.text
        )}
      </>
    )
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowSuggestions(true) }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
      />
      {showSuggestions && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 rounded-lg bg-card border border-border shadow-card overflow-hidden">
          {filtered.map((suggestion, i) => (
            <button
              key={suggestion}
              onMouseDown={(e) => { e.preventDefault(); accept(suggestion) }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                i === selectedIdx ? "bg-accent text-fg" : "text-fg/60 hover:bg-accent/50"
              }`}>
              {highlight(suggestion, value)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
