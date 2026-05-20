import { AI_GATEWAY_ID, EMBED_MODEL, type Env } from "./env"

/**
 * Embed one or many strings via Workers AI through AI Gateway "x".
 * Returns a 2-D array: [text][dim]. Single-string input returns [1][dim].
 */
export async function embed(env: Env, input: string | string[]): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input]
  if (texts.length === 0) return []

  const res = (await env.AI.run(
    EMBED_MODEL,
    { text: texts },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as { data: number[][] }

  if (!res?.data || !Array.isArray(res.data)) {
    throw new Error(`embed: unexpected AI response shape (got ${JSON.stringify(res).slice(0, 80)})`)
  }
  return res.data
}
