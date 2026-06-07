// src/lib/github/api.ts
// GitHub-only REST + GraphQL client. No other origins are ever contacted.
import { getToken } from "./token"

const REST = "https://api.github.com"
const GRAPHQL = "https://api.github.com/graphql"

export class GitHubApiError extends Error {
  constructor(public status: number, public body: string) {
    super(`GitHub API ${status}`)
    this.name = "GitHubApiError"
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken()
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function v3<T = unknown>(
  path: string,
  init: RequestInit & { responseFormat?: "json" | "text" } = {}
): Promise<T> {
  const { responseFormat = "json", headers, ...rest } = init
  const res = await fetch(`${REST}${path}`, {
    ...rest,
    // Caller headers are spread last, so a caller may intentionally override
    // Authorization (e.g. to make an unauthenticated request).
    headers: { ...(await authHeaders()), ...(headers as Record<string, string>) }
  })
  const text = await res.text()
  if (!res.ok) throw new GitHubApiError(res.status, text)
  return (responseFormat === "text" ? text : text ? JSON.parse(text) : undefined) as T
}

export async function v4<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables })
  })
  const text = await res.text()
  if (!res.ok) throw new GitHubApiError(res.status, text)
  const parsed = JSON.parse(text)
  if (parsed.errors) throw new GitHubApiError(res.status, JSON.stringify(parsed.errors))
  return parsed.data as T
}

export async function hasToken(): Promise<boolean> {
  return (await getToken()).length > 0
}
