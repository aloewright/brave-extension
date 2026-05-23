/**
 * Client helper for POST /api/bookmarks/categorize (ALO-469).
 *
 * Sends only the minimal fields required to categorize. The Worker
 * forwards through Cloudflare AI Gateway — never to a direct provider —
 * and returns JSON-shaped proposals.
 */

export interface CategorizeRequestItem {
  id: string
  title: string
  url: string
  folder?: string
  tags?: string[]
}

export interface ProposedCategory {
  id: string
  category: string
  confidence: "low" | "medium" | "high"
}

export interface CategorizeResponse {
  proposals: ProposedCategory[]
  model: string
  gateway: string
}

export class CategorizeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message)
    this.name = "CategorizeError"
  }
}

export const MAX_BATCH = 50

/**
 * POST a batch of bookmarks for AI categorization. Throws CategorizeError
 * on non-2xx so the UI can render a meaningful error and keep proposed
 * categories local until the user accepts them.
 */
export async function categorizeBookmarks(
  args: {
    apiUrl: string
    apiToken: string
    items: CategorizeRequestItem[]
  },
  fetchImpl: typeof fetch = fetch
): Promise<CategorizeResponse> {
  if (args.items.length === 0) {
    return { proposals: [], model: "", gateway: "" }
  }
  if (args.items.length > MAX_BATCH) {
    throw new CategorizeError(
      `too many bookmarks: pass ≤ ${MAX_BATCH} per call`,
      413,
      "too_many_items"
    )
  }
  const minimal = args.items.map((i) => ({
    id: i.id,
    title: i.title,
    url: i.url,
    folder: i.folder,
    tags: i.tags
  }))
  const base = args.apiUrl.replace(/\/+$/, "")
  const res = await fetchImpl(`${base}/api/bookmarks/categorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Sidebar-Token": args.apiToken
    },
    body: JSON.stringify({ items: minimal })
  })
  if (!res.ok) {
    let code: string | undefined
    let message = `categorize failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code
      if (body.error?.message) message = body.error.message
    } catch {
      // fall through with default message
    }
    throw new CategorizeError(message, res.status, code)
  }
  return (await res.json()) as CategorizeResponse
}
