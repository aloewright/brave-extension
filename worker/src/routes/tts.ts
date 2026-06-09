import { Hono } from "hono"
import { synthesizeSpeech } from "../ai"
import { AI_GATEWAY_ID, TTS_MODEL, type Env } from "../env"

const MAX_TTS_CHARS = 5_000
const ALLOWED_SPEAKERS = new Set(["hyperion", "thalia", "andromeda", "helena", "apollo"])

interface TtsBody {
  text?: string
  speaker?: string
}

const tts = new Hono<{ Bindings: Env }>()

tts.post("/", async (c) => {
  const body = await c.req.json<TtsBody>().catch(() => null)
  const text = typeof body?.text === "string" ? body.text.trim() : ""
  const speaker = typeof body?.speaker === "string" ? body.speaker.trim() : undefined

  if (!text) {
    return c.json({ error: { code: "bad_request", message: "text required" } }, 400)
  }
  if (speaker && !ALLOWED_SPEAKERS.has(speaker)) {
    return c.json({ error: { code: "bad_request", message: "unsupported speaker" } }, 400)
  }
  if (text.length > MAX_TTS_CHARS) {
    return c.json(
      {
        error: {
          code: "text_too_long",
          message: `text must be ${MAX_TTS_CHARS} characters or fewer`,
          maxChars: MAX_TTS_CHARS,
        },
      },
      413,
    )
  }

  try {
    const audio = await synthesizeSpeech(c.env, { text, speaker })
    const headers = new Headers(audio.headers)
    headers.set("content-type", headers.get("content-type") || "audio/mpeg")
    headers.set("x-ai-model", TTS_MODEL)
    headers.set("x-ai-gateway", AI_GATEWAY_ID)
    return new Response(audio.body, { status: audio.status, headers })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json(
      {
        error: {
          code: "gateway_error",
          message: `AI gateway TTS call failed: ${msg}`,
        },
      },
      502,
    )
  }
})

export default tts
