import { AI_GATEWAY_ID, EMBED_MODEL, OCR_MODEL, TRANSCRIBE_MODEL, type Env } from "./env"

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

/**
 * Transcribe audio bytes via Whisper through AI Gateway "x".
 * Whisper's Workers-AI input shape is `{ audio: number[] }` (array of byte
 * values, not a typed array). Returns the text portion of the response,
 * trimmed; empty string if the model returns nothing.
 */
export async function transcribeAudio(env: Env, bytes: Uint8Array): Promise<string> {
  const audio = Array.from(bytes)
  const res = (await env.AI.run(
    TRANSCRIBE_MODEL,
    { audio },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as { text?: string }
  return (res?.text ?? "").trim()
}

/**
 * Ask the LLaVA vision model to extract text from an image (PNG/JPEG bytes).
 * Used as an OCR fallback when a PDF's text layer is empty.
 */
export async function ocrImage(env: Env, imageBytes: Uint8Array): Promise<string> {
  const image = Array.from(imageBytes)
  const res = (await env.AI.run(
    OCR_MODEL,
    {
      image,
      prompt: "Transcribe the visible text on this page exactly. Return only the text, no commentary.",
      max_tokens: 1024
    },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as { description?: string; response?: string }
  return ((res?.description ?? res?.response) ?? "").trim()
}
