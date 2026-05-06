import { useCallback, useEffect, useRef, useState } from "react"
import { truncate } from "../lib/text"
import type { Reference } from "../types"

// chrome.storage.local key for the references tray. Per spec §4 namespacing:
// `terminal.references`. Tray is the source of truth; host mirrors it as
// MCP resources via `mcp.resource.upsert` / `mcp.resource.remove`.
export const REFERENCES_STORAGE_KEY = "terminal.references"

export interface ResourceSync {
  upsert: (uri: string, def: ResourceDef) => void
  remove: (uri: string) => void
}

export interface ResourceDef {
  name: string
  description?: string
  mimeType?: string
  payload?: unknown
}

export function referenceUri(id: string): string {
  return `ai-dev://reference/${id}`
}

export function referenceResourceDef(ref: Reference): ResourceDef {
  return {
    name: `Reference ${ref.id} — ${truncate(ref.title || ref.url || "", 40)}`,
    description: ref.url,
    mimeType: "application/json",
    payload: ref
  }
}

// Pure storage helpers — testable without React.
export async function loadReferences(): Promise<Reference[]> {
  try {
    const result = await chrome.storage.local.get(REFERENCES_STORAGE_KEY)
    const raw = result[REFERENCES_STORAGE_KEY]
    return Array.isArray(raw) ? (raw as Reference[]) : []
  } catch {
    return []
  }
}

export async function saveReferences(refs: Reference[]): Promise<void> {
  await chrome.storage.local.set({ [REFERENCES_STORAGE_KEY]: refs })
}

// Mutation primitives that combine persistence + host sync. Used directly by
// the test suite, and indirectly via `useReferences`.
export async function addReference(
  current: Reference[],
  ref: Reference,
  sync: ResourceSync
): Promise<Reference[]> {
  const next = [...current.filter((r) => r.id !== ref.id), ref]
  await saveReferences(next)
  sync.upsert(referenceUri(ref.id), referenceResourceDef(ref))
  return next
}

export async function removeReference(
  current: Reference[],
  id: string,
  sync: ResourceSync
): Promise<Reference[]> {
  const next = current.filter((r) => r.id !== id)
  await saveReferences(next)
  sync.remove(referenceUri(id))
  return next
}

export async function clearReferences(
  current: Reference[],
  sync: ResourceSync
): Promise<Reference[]> {
  for (const r of current) sync.remove(referenceUri(r.id))
  await saveReferences([])
  return []
}

export interface UseReferencesResult {
  references: Reference[]
  add: (ref: Reference) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
  ready: boolean
}

// React hook that owns the in-memory tray, persists to chrome.storage.local,
// and pushes upserts/removes to the native host via the supplied sync.
export function useReferences(sync: ResourceSync): UseReferencesResult {
  const [references, setReferences] = useState<Reference[]>([])
  const [ready, setReady] = useState(false)
  const syncRef = useRef(sync)
  syncRef.current = sync

  // Synchronous source of truth for the current refs list. Sidepanel JS is
  // single-threaded so reads/writes are atomic; using a ref instead of
  // re-loading from chrome.storage on every mutation avoids the TOCTOU race
  // where two concurrent add()/remove() calls each load the *same* baseline
  // and clobber each other on save.
  const refsRef = useRef<Reference[]>([])

  useEffect(() => {
    let cancelled = false
    loadReferences().then((refs) => {
      if (cancelled) return
      refsRef.current = refs
      setReferences(refs)
      setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const add = useCallback(async (ref: Reference) => {
    const next = await addReference(refsRef.current, ref, syncRef.current)
    refsRef.current = next
    setReferences(next)
  }, [])

  const remove = useCallback(async (id: string) => {
    const next = await removeReference(refsRef.current, id, syncRef.current)
    refsRef.current = next
    setReferences(next)
  }, [])

  const clear = useCallback(async () => {
    const next = await clearReferences(refsRef.current, syncRef.current)
    refsRef.current = next
    setReferences(next)
  }, [])

  return { references, add, remove, clear, ready }
}
