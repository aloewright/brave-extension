// src/lib/joplin-client.ts
//
// HTTP client for Joplin's localhost Web Clipper service. Pure functions
// over fetch — no chrome.* APIs, no DOM. Testable with a fetch stub.

export const JOPLIN_BASE_URL = "http://localhost:41184"

export class JoplinClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = "JoplinClientError"
  }
}

export interface CreateNoteInput {
  title: string
  body?: string
  bodyHtml?: string
  sourceUrl: string
}

/** POST /notes — returns the Joplin note ID on success, throws on failure. */
export async function createNote(
  input: CreateNoteInput,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (!token) {
    throw new JoplinClientError("No Joplin API token configured.", 0)
  }
  const url = `${JOPLIN_BASE_URL}/notes?token=${encodeURIComponent(token)}`
  const payload: Record<string, string> = {
    title: input.title,
    source_url: input.sourceUrl
  }
  if (input.body) payload.body = input.body
  if (input.bodyHtml) payload.body_html = input.bodyHtml

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
  } catch (_err) {
    throw new JoplinClientError(
      "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?",
      0
    )
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new JoplinClientError(
      `Joplin API error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    )
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string }
  if (!json.id) {
    throw new JoplinClientError("Joplin returned no note id.", res.status)
  }
  return json.id
}

/** Liveness check. GET /ping is unauthenticated. */
export async function ping(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${JOPLIN_BASE_URL}/ping`)
    if (!res.ok) return false
    const body = await res.text()
    return body.includes("JoplinClipperServer")
  } catch {
    return false
  }
}

/** Build the joplin:// deep link for a clipped note. */
export function joplinNoteUrl(noteId: string): string {
  return `joplin://x-callback-url/openNote?id=${noteId}`
}
