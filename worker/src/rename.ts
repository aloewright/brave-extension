import { AGENT_PLAN_MODEL, AI_GATEWAY_ID, type Env } from "./env"

const MAX_TEXT = 2000

/** Lowercase, hyphenated, filesystem-safe base name (no extension/path). */
function sanitizeBase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "") // drop any extension the model added
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
}

function extensionOf(fallback: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(fallback)
  return m?.[1] ? `.${m[1].toLowerCase()}` : ""
}

/**
 * Generate a concise, descriptive filename from a capture's extracted text.
 * Best-effort: returns `fallback` on empty input, model error, or empty result.
 *
 * Worker-side gateway call uses env.AI.run("@cf/...", ..., { gateway: { id } }) —
 * the sanctioned pattern per ~/.claude/CLAUDE.md "Inside a Worker" (dynamic
 * routes are broken Worker-side). Swap to a dynamic route when fixed upstream.
 */
export async function suggestFilenameFromText(
  env: Env,
  input: { text: string; kind: "screenshot" | "pdf"; fallback: string; sourceTitle?: string | null }
): Promise<string> {
  const text = (input.text ?? "").trim()
  if (!text) return input.fallback
  const prompt =
    `You name files from their content. Given the extracted text of a ${input.kind}, ` +
    `reply with ONE short descriptive filename (3-8 words), lowercase words, no file extension, ` +
    `no quotes, no path. Title hint: ${input.sourceTitle ?? "none"}.\n\n` +
    `Content:\n${text.slice(0, MAX_TEXT)}`
  try {
    const res = (await env.AI.run(
      AGENT_PLAN_MODEL,
      { messages: [{ role: "user", content: prompt }], max_tokens: 32 },
      { gateway: { id: AI_GATEWAY_ID } }
    )) as { response?: string }
    const base = sanitizeBase(res?.response ?? "")
    if (!base) return input.fallback
    return base + extensionOf(input.fallback)
  } catch {
    return input.fallback
  }
}
