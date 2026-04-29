// Shared protocol between the PiP content script (pip.ts), the cross-frame
// coordinator (pip-coord.ts), and any caller (popup, background) that
// dispatches PiP messages. Centralizes the message-type strings, the
// sentinel reason that triggers iframe fallback, and the result shape so
// a typo in any one consumer can't silently break the contract.

export const PIP_TOGGLE_MESSAGE = "TOGGLE_PIP" as const
export const PIP_EXIT_MESSAGE = "EXIT_PIP" as const

// pip-coord.ts compares against this exact string to decide whether to
// fall back to iframe enumeration. Edit it here, in one place, only.
export const PIP_NO_VIDEO_REASON = "No video found on this page"

// Synthesized by the coordinator when chrome.tabs.sendMessage to a frame
// returns no response (frame missing the content script, privileged URL,
// etc.). The popup uses this to differentiate "no video anywhere" from
// "we couldn't reach any frame at all". Keep canonical here.
export const PIP_NO_CONTENT_SCRIPT_REASON = "No content script in frame"

// Returned by the content script's togglePiP/exitPiP handlers. The
// coordinator and any UI caller consume this shape. `frameId` is set
// only by the coordinator after it knows which frame answered.
export interface PiPResult {
  ok: boolean
  action: "entered" | "exited" | "none"
  reason?: string
  frameId?: number
}
