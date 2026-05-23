import { useCallback, useEffect, useState } from "react"

/**
 * Sidepanel hook listening for `consent:request` runtime messages from
 * the background consent FSM (ALO-250). Maintains a queue of pending
 * requests and exposes a `respond(requestId, decision, remember)`
 * callback that posts back `consent:response` messages.
 */

export interface ConsentRequest {
  requestId: string
  toolName: string
  args: unknown
  toolClass: "write" | "always-prompt"
  receivedAt: number
}

export type ConsentDecision = "allow" | "deny"

export interface UseConsentRequestsResult {
  queue: ConsentRequest[]
  current: ConsentRequest | null
  respond: (requestId: string, decision: ConsentDecision, remember: boolean) => void
}

export function useConsentRequests(): UseConsentRequestsResult {
  const [queue, setQueue] = useState<ConsentRequest[]>([])

  useEffect(() => {
    const listener = (
      msg: any,
      _sender: chrome.runtime.MessageSender,
      _sendResponse: (resp?: unknown) => void
    ) => {
      if (msg?.type !== "consent:request") return
      const entry: ConsentRequest = {
        requestId: String(msg.requestId),
        toolName: String(msg.toolName),
        args: msg.args,
        toolClass:
          msg.toolClass === "always-prompt" ? "always-prompt" : "write",
        receivedAt: Date.now()
      }
      setQueue((q) => {
        if (q.some((r) => r.requestId === entry.requestId)) return q
        return [...q, entry]
      })
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const respond = useCallback(
    (requestId: string, decision: ConsentDecision, remember: boolean) => {
      setQueue((q) => q.filter((r) => r.requestId !== requestId))
      try {
        chrome.runtime
          .sendMessage({
            type: "consent:response",
            requestId,
            decision,
            remember
          })
          .catch(() => {})
      } catch {
        /* ignore */
      }
    },
    []
  )

  return {
    queue,
    current: queue[0] ?? null,
    respond
  }
}
