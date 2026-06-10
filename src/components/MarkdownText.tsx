import type { ReactNode } from "react"

type ListItem = {
  text: string
  depth: number
}

const INLINE_PATTERN = /(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<]+|`[^`]+`|\*\*[^*]+\*\*)/g

function toSafeHttpHref(rawUrl: string) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    return parsed.href
  } catch {
    return null
  }
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${match.index}-${token}`
    const markdownLink = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/)

    if (markdownLink) {
      const href = toSafeHttpHref(markdownLink[2])
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80">
            {markdownLink[1]}
          </a>
        ) : (
          token
        )
      )
    } else if (token.startsWith("http")) {
      const url = token.replace(/[),.;:!?]+$/, "")
      const suffix = token.slice(url.length)
      const href = toSafeHttpHref(url)
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80">
            {href}
          </a>
        ) : (
          url
        )
      )
      if (suffix) nodes.push(suffix)
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-bg/60 px-1 py-0.5 font-mono text-[0.9em]">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-fg">
          {token.slice(2, -2)}
        </strong>
      )
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

function renderList(items: ListItem[], key: string) {
  return (
    <ul key={key} className="my-1 list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li
          key={`${key}-${index}`}
          className={item.depth > 0 ? "ml-4" : undefined}>
          {renderInline(item.text)}
        </li>
      ))}
    </ul>
  )
}

function renderParagraph(lines: string[], key: string) {
  const text = lines.join(" ").trim()
  if (!text) return null
  return (
    <p key={key} className="my-1">
      {renderInline(text)}
    </p>
  )
}

export function MarkdownText({
  content,
  className = ""
}: {
  content: string
  className?: string
}) {
  const lines = content.replace(/\r\n/g, "\n").split("\n")
  const nodes: ReactNode[] = []
  let paragraph: string[] = []
  let list: ListItem[] = []
  let code: string[] | null = null

  const flushParagraph = () => {
    const node = renderParagraph(paragraph, `p-${nodes.length}`)
    if (node) nodes.push(node)
    paragraph = []
  }

  const flushList = () => {
    if (list.length > 0) nodes.push(renderList(list, `ul-${nodes.length}`))
    list = []
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (code) {
        nodes.push(
          <pre key={`code-${nodes.length}`} className="my-2 overflow-x-auto rounded bg-bg/70 p-2 text-xs">
            <code>{code.join("\n")}</code>
          </pre>
        )
        code = null
      } else {
        flushParagraph()
        flushList()
        code = []
      }
      continue
    }

    if (code) {
      code.push(line)
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      flushParagraph()
      flushList()
      const size = heading[1].length === 1 ? "text-base" : heading[1].length === 2 ? "text-sm" : "text-xs"
      nodes.push(
        <h3 key={`h-${nodes.length}`} className={`mb-1 mt-2 font-semibold text-fg ${size}`}>
          {renderInline(heading[2])}
        </h3>
      )
      continue
    }

    const listItem = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/)
    if (listItem) {
      flushParagraph()
      const indent = listItem[1].replace(/\t/g, "  ").length
      list.push({
        text: listItem[3],
        depth: Math.min(3, Math.floor(indent / 2))
      })
      continue
    }

    flushList()
    paragraph.push(trimmed)
  }

  if (code) {
    nodes.push(
      <pre key={`code-${nodes.length}`} className="my-2 overflow-x-auto rounded bg-bg/70 p-2 text-xs">
        <code>{code.join("\n")}</code>
      </pre>
    )
  }
  flushParagraph()
  flushList()

  return <div className={`leading-relaxed ${className}`}>{nodes}</div>
}
