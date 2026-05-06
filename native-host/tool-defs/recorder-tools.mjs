/**
 * MCP tool definitions for the recorder (ALO-249, M6).
 *
 * Two tools bridge to the extension background worker (start/stop) since
 * they need chrome.tabCapture + the offscreen document. The other two
 * (list/get) are host-side: they read the recordings list directly off the
 * `ai-dev://recordings` resource the extension publishes, and `recorder_get`
 * enriches with a `file://` URI to the mirror copy under
 * ~/.config/ai-dev-sidebar/recordings/{id}.mp4.
 */

import { homedir } from "os"
import { join } from "path"

export const RECORDER_BRIDGED_TOOL_DEFS = [
  {
    name: "recorder_start",
    description:
      "Start recording the current tab, the whole screen, or the camera. " +
      "Returns once recording has actually begun. For source='tab' with no " +
      "tabId, the active tab is used.",
    inputSchema: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["tab", "screen", "camera"],
          description: "What to record. Default 'tab'."
        },
        tabId: {
          type: "number",
          description: "Target tab id when source='tab'. Defaults to the active tab."
        }
      }
    }
  },
  {
    name: "recorder_stop",
    description:
      "Stop the active recording. Returns the finalized RecordingMetadata.",
    inputSchema: { type: "object", properties: {} }
  }
]

const RECORDINGS_URI = "ai-dev://recordings"

export function recordingsHostFilePath(id) {
  return join(homedir(), ".config", "ai-dev-sidebar", "recordings", `${id}.mp4`)
}

export function recordingsHostFileUri(id) {
  return `file://${recordingsHostFilePath(id)}`
}

function getRecordingsList(server) {
  const r = server.resources.get(RECORDINGS_URI)
  if (!r) return []
  const p = r.payload
  if (Array.isArray(p)) return p
  if (p && Array.isArray(p.recordings)) return p.recordings
  return []
}

/**
 * Host-side tools — operate on the published `ai-dev://recordings` resource.
 */
export function buildRecorderHostTools(server) {
  return [
    {
      name: "recorder_list",
      description:
        "List recorded clip metadata, most recent first. Reads from the " +
        "ai-dev://recordings resource published by the extension.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum entries to return (default 50)."
          }
        }
      },
      handler: async ({ limit } = {}) => {
        const list = getRecordingsList(server)
        const n = Number.isFinite(limit) && limit > 0 ? Number(limit) : 50
        const out = list.slice(0, n)
        return {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          isError: false
        }
      }
    },
    {
      name: "recorder_get",
      description:
        "Fetch a single recording by id. Returns the metadata plus a " +
        "file:// URI to the mirror copy under ~/.config/ai-dev-sidebar/recordings/.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"]
      },
      handler: async ({ id } = {}) => {
        if (!id || typeof id !== "string") {
          return { isError: true, content: [{ type: "text", text: "id required" }] }
        }
        // Validate id format strictly before any lookup or filesystem-path
        // construction. Reject path traversal / shell metachar attempts up
        // front so we don't even leak existence via the "no recording"
        // branch. ULIDs (Crockford alphabet) are the canonical format from
        // src/background/recorder.ts; we also accept short safe ids
        // (letters, digits, `_`, `-`) for prefixed test fixtures like
        // `rec_<ulid>`.
        const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
        const SAFE_RE = /^[A-Za-z0-9_-]{1,64}$/
        if (!ULID_RE.test(id) && !SAFE_RE.test(id)) {
          return { isError: true, content: [{ type: "text", text: "invalid id" }] }
        }
        const list = getRecordingsList(server)
        const meta = list.find((r) => r && r.id === id)
        if (!meta) {
          return { isError: true, content: [{ type: "text", text: `no recording ${id}` }] }
        }
        const fileUri = recordingsHostFileUri(id)
        return {
          content: [
            { type: "text", text: JSON.stringify({ metadata: meta, fileUri }, null, 2) }
          ],
          isError: false
        }
      }
    }
  ]
}
