// src/lib/joplin/client.ts
//
// Shared fetch core for the Joplin library. All entity files call into
// the typed helpers here. Stateless — no module-level mutable state.

import type { PagedResponse, PagedResult } from "./types"

export const JOPLIN_BASE_URL = "http://localhost:41184"

export class JoplinClientError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = "JoplinClientError"
  }
}

export interface RequestOptions {
  query?: Record<string, string | undefined>
  body?: unknown
  fetchImpl?: typeof fetch
}

function buildUrl(
  path: string,
  token: string,
  query: Record<string, string | undefined> = {}
): string {
  const p = path.startsWith("/") ? path : `/${path}`
  const params = new URLSearchParams()
  params.set("token", token)
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, v)
  }
  return `${JOPLIN_BASE_URL}${p}?${params.toString()}`
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  token: string,
  opts: RequestOptions = {}
): Promise<T> {
  if (!token) {
    throw new JoplinClientError("No Joplin API token configured.", 0)
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const url = buildUrl(path, token, opts.query)
  const init: RequestInit = { method }
  if (opts.body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body = JSON.stringify(opts.body)
  }
  let res: Response
  try {
    res = await fetchImpl(url, init)
  } catch {
    throw new JoplinClientError(
      "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?",
      0
    )
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "")
    const detail = raw.replaceAll(token, "<redacted>")
    throw new JoplinClientError(
      `Joplin API error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    )
  }
  if (method === "DELETE") {
    return undefined as unknown as T
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new JoplinClientError(
      "Couldn't parse Joplin response as JSON.",
      res.status
    )
  }
}

export async function get<T>(
  path: string,
  token: string,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>("GET", path, token, opts)
}

export async function post<T>(
  path: string,
  token: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>("POST", path, token, { ...opts, body })
}

export async function put<T>(
  path: string,
  token: string,
  body: unknown,
  opts: RequestOptions = {}
): Promise<T> {
  return request<T>("PUT", path, token, { ...opts, body })
}

export async function del(
  path: string,
  token: string,
  opts: RequestOptions = {}
): Promise<void> {
  await request<void>("DELETE", path, token, opts)
}

export async function postMultipart<T>(
  path: string,
  token: string,
  file: Blob,
  props: Record<string, unknown>,
  opts: { fetchImpl?: typeof fetch } = {}
): Promise<T> {
  if (!token) {
    throw new JoplinClientError("No Joplin API token configured.", 0)
  }
  const fetchImpl = opts.fetchImpl ?? fetch
  const form = new FormData()
  form.append("data", file)
  form.append("props", JSON.stringify(props))
  const url = buildUrl(path, token)
  let res: Response
  try {
    res = await fetchImpl(url, { method: "POST", body: form })
  } catch {
    throw new JoplinClientError(
      "Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?",
      0
    )
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "")
    const detail = raw.replaceAll(token, "<redacted>")
    throw new JoplinClientError(
      `Joplin API error ${res.status}: ${detail.slice(0, 200)}`,
      res.status
    )
  }
  return (await res.json()) as T
}

/** When the caller's cap is below Joplin's per-page maximum of 100, ask
 *  Joplin for exactly that many items instead of overshooting. Returns
 *  the limit query-param value as a string. */
export function limitForCap(cap: number | undefined): string {
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

/** Auto-paginate by calling `pagedFn(page)` repeatedly until has_more=false
 *  or the cap is reached. Default cap = 1000; pass 0 for unbounded. */
export async function paginate<T>(
  pagedFn: (page: number) => Promise<PagedResponse<T>>,
  cap: number = 1000
): Promise<PagedResult<T>> {
  const items: T[] = []
  let page = 1
  while (true) {
    const resp = await pagedFn(page)
    const respItems = (resp?.items ?? []) as T[]
    const respHasMore = resp?.has_more ?? false
    items.push(...respItems)
    if (cap > 0 && items.length >= cap) {
      const truncated = items.length > cap || respHasMore
      return { items: items.slice(0, cap), truncated }
    }
    if (!respHasMore) return { items, truncated: false }
    page++
    if (page > 1_000_000) {
      return { items, truncated: true }
    }
  }
}
