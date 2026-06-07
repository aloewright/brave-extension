import type { Env } from "./env"

export type ModelKind = "workers-ai" | "advanced"

export interface ModelEntry {
  id: string            // the id passed to the gateway (Workers AI id, or explicit compat id)
  label: string         // display name for the picker
  kind: ModelKind
  experimental?: boolean // true for advanced/non-CF entries
}

// Reliable Workers AI models routed through gateway "x" via env.AI.run.
// VERIFY these ids are current before deploy (CLAUDE.md notes ids get removed).
const WORKERS_AI: ModelEntry[] = [
  { id: "@cf/openai/gpt-oss-120b", label: "GPT-OSS 120B (Workers AI)", kind: "workers-ai" },
  { id: "@cf/meta/llama-3.1-8b-instruct-fp8", label: "Llama 3.1 8B (Workers AI)", kind: "workers-ai" }
]

// Experimental explicit-model entries via gateway compat (may be unreliable
// Worker-side until upstream fix — see CLAUDE.md "Inside a Worker").
const ADVANCED: ModelEntry[] = [
  { id: "openai/gpt-4o-mini", label: "GPT-4o mini (experimental)", kind: "advanced", experimental: true },
  { id: "anthropic/claude-3-5-haiku", label: "Claude 3.5 Haiku (experimental)", kind: "advanced", experimental: true }
]

export const DEFAULT_MODEL_ID = "@cf/openai/gpt-oss-120b"
const CATALOG_KEY = "models:catalog:v1"

export async function getCatalog(env: Env): Promise<ModelEntry[]> {
  const cached = await env.AGENT_KV.get(CATALOG_KEY)
  if (cached) {
    try {
      return JSON.parse(cached) as ModelEntry[]
    } catch {
      /* fall through to rebuild */
    }
  }
  const catalog = [...WORKERS_AI, ...ADVANCED]
  await env.AGENT_KV.put(CATALOG_KEY, JSON.stringify(catalog))
  return catalog
}

export async function resolveModel(env: Env, id: string | null | undefined): Promise<ModelEntry> {
  const catalog = await getCatalog(env)
  return catalog.find((m) => m.id === id) ?? catalog.find((m) => m.id === DEFAULT_MODEL_ID)!
}
