import type { ChatMessage as ChatMsg } from "../types"
import { BACKEND_INFO } from "../types"

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "")
}

function formatContent(content: string): string {
  // Basic markdown-like formatting for code blocks
  return stripAnsi(content)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-black/30 rounded p-2 my-1 overflow-x-auto text-xs"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-black/20 rounded px-1 text-xs">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>")
}

export function ChatMessageBubble({ message }: { message: ChatMsg }) {
  const isUser = message.role === "user"
  const isError = message.role === "error"
  const isSystem = message.role === "system"
  const isClear = message.role === "clear"
  const backendInfo = message.backend ? BACKEND_INFO[message.backend] : null

  // "Clear" markers render as a full-viewport spacer with a subtle divider
  if (isClear) {
    return (
      <div
        className="flex items-end justify-center"
        style={{ minHeight: "calc(100vh - 200px)" }}
      >
        <div className="w-full px-3 pb-2 flex items-center gap-2 opacity-30">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[9px] uppercase tracking-wider text-fg/40 font-mono">
            cleared {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      </div>
    )
  }

  return (
    <div className={`animate-slide-up px-3 py-1.5 ${isUser ? "flex justify-end" : ""}`}>
      {/* Backend indicator */}
      {!isUser && backendInfo && (
        <div className="flex items-center gap-1.5 mb-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: backendInfo.color }}
          />
          <span className="text-[10px] text-fg/40">{backendInfo.name}</span>
        </div>
      )}

      <div
        className={`rounded-lg px-3 py-2 text-xs leading-relaxed max-w-[95%] ${
          isUser
            ? "bg-primary/30 text-fg ml-6"
            : isError
            ? "bg-error/10 text-error border border-error/20"
            : isSystem
            ? "bg-info/10 text-info/80 border border-info/20 text-[11px]"
            : "bg-card text-fg/90"
        }`}
      >
        {message.isStreaming ? (
          <div className="terminal-output">
            <pre className="whitespace-pre-wrap break-words">{stripAnsi(message.content)}</pre>
            <span className="inline-block w-2 h-3 bg-fg/60 animate-pulse-dot ml-0.5" />
          </div>
        ) : (
          <div
            className="terminal-output"
            dangerouslySetInnerHTML={{ __html: formatContent(message.content) }}
          />
        )}
      </div>

      <div className={`text-[9px] text-fg/20 mt-0.5 ${isUser ? "text-right" : ""}`}>
        {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  )
}
