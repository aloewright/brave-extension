// src/lib/github/token.ts
// GitHub PAT lives only in chrome.storage.session (cleared on browser close,
// never written to disk, never part of persisted Settings).
export const GH_TOKEN_KEY = "github.pat"

let memo: string | null = null

export async function getToken(): Promise<string> {
  if (memo !== null) return memo
  const res = await chrome.storage.session.get(GH_TOKEN_KEY)
  memo = typeof res[GH_TOKEN_KEY] === "string" ? (res[GH_TOKEN_KEY] as string) : ""
  return memo
}

export async function setToken(value: string): Promise<void> {
  memo = value
  await chrome.storage.session.set({ [GH_TOKEN_KEY]: value })
}

/** Test-only: clear the in-memory cache so the next getToken hits storage. */
export function _resetTokenCache(): void {
  memo = null
}
