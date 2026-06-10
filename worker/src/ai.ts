import {
  AI_GATEWAY_ID,
  CARTESIA_API_VERSION,
  CARTESIA_TTS_MODEL,
  CARTESIA_TTS_VOICE_ID,
  EMBED_MODEL,
  OCR_MODEL,
  TRANSCRIBE_MODEL,
  TTS_DYNAMIC_MODEL,
  TTS_MODEL,
  type Env,
  type TtsModelMode
} from "./env"

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

async function assertSuccessfulAudioResponse(response: Response, label: string): Promise<Response> {
  if (response.ok) return response
  const contentType = response.headers.get("content-type") || ""
  const body = contentType.includes("application/json")
    ? JSON.stringify(await response.clone().json().catch(() => null))
    : await response.clone().text().catch(() => "")
  throw new Error(`${label}: provider returned ${response.status}${body ? ` (${body.slice(0, 500)})` : ""}`)
}

function cartesiaHeaders(env: Env): Record<string, string> {
  return {
    "Cartesia-Version": CARTESIA_API_VERSION,
    ...(env.CARTESIA_API_KEY
      ? {
          "X-API-Key": env.CARTESIA_API_KEY,
          Authorization: `Bearer ${env.CARTESIA_API_KEY}`,
        }
      : {}),
  }
}

async function cartesiaGatewayUrl(env: Env, path: string): Promise<string> {
  const gateway = (env.AI as any).gateway(AI_GATEWAY_ID)
  const baseUrl = await gateway.getUrl("cartesia")
  return `${String(baseUrl).replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

/**
 * Synthesize speech with Deepgram Aura 2 through AI Gateway "x".
 * Worker-side dynamic routes are currently broken, so this intentionally uses
 * the sanctioned env.AI.run("@cf/...", ..., { gateway: { id: "x" } }) path.
 */
export async function synthesizeSpeech(
  env: Env,
  input: { text: string; speaker?: string; ttsModel?: TtsModelMode }
): Promise<Response> {
  const speaker = input.speaker || "hyperion"
  if (input.ttsModel === "cartesia-sonic") {
    // Provider-native Cartesia through AI Gateway. The gateway owns the
    // Cartesia key in production, so the Worker sends the current Cartesia
    // request shape through the gateway URL. If CARTESIA_API_KEY is configured
    // locally, include it as a fallback for metadata/local testing.
    const raw = await fetch(await cartesiaGatewayUrl(env, "tts/bytes"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...cartesiaHeaders(env),
      },
      body: JSON.stringify({
        transcript: input.text,
        model_id: CARTESIA_TTS_MODEL,
        voice: {
          id: input.speaker || CARTESIA_TTS_VOICE_ID,
        },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
      }),
    })

    return assertSuccessfulAudioResponse(raw, "tts cartesia")
  }

  if (input.ttsModel === "dynamic-audio-gen") {
    // Cloudflare AI Gateway currently rejects compat/audio/speech with code
    // 2019 ("audio/speech is not supported"). Keep the user-facing option
    // non-fatal by falling back to the sanctioned Worker-side Aura path below.
    // Swap this back to TTS_DYNAMIC_MODEL when Gateway supports audio/speech
    // or exposes dynamic/audio_gen through a supported Worker endpoint.
  }

  const raw = await (env.AI.run as any)(
    TTS_MODEL,
    {
      text: input.text,
      speaker,
      encoding: "mp3"
    },
    { gateway: { id: AI_GATEWAY_ID }, returnRawResponse: true }
  )

  if (raw instanceof Response) return assertSuccessfulAudioResponse(raw, "tts aura")
  if (raw instanceof ReadableStream) {
    return new Response(raw, { headers: { "content-type": "audio/mpeg" } })
  }
  throw new Error("tts: unexpected AI response shape")
}

export interface CartesiaVoiceOption {
  id: string
  name: string
  description?: string | null
}

function normalizeCartesiaVoices(raw: unknown): CartesiaVoiceOption[] {
  const root = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}
  const list = Array.isArray(root.voices)
    ? root.voices
    : Array.isArray(root.data)
      ? root.data
      : Array.isArray(raw)
        ? raw
        : []
  return list
    .map((item) => {
      const voice = item && typeof item === "object" ? item as Record<string, unknown> : {}
      const id = typeof voice.id === "string"
        ? voice.id
        : typeof voice.voice_id === "string"
          ? voice.voice_id
          : ""
      const name = typeof voice.name === "string" ? voice.name : id
      const description = typeof voice.description === "string" ? voice.description : null
      return id ? { id, name, description } : null
    })
    .filter((voice): voice is CartesiaVoiceOption => Boolean(voice))
}

async function assertSuccessfulJsonResponse(response: Response, label: string): Promise<unknown> {
  if (response.ok) return response.json()
  const contentType = response.headers.get("content-type") || ""
  const body = contentType.includes("application/json")
    ? JSON.stringify(await response.clone().json().catch(() => null))
    : await response.clone().text().catch(() => "")
  throw new Error(`${label}: provider returned ${response.status}${body ? ` (${body.slice(0, 500)})` : ""}`)
}

export async function listCartesiaVoices(env: Env): Promise<CartesiaVoiceOption[]> {
  const response = await fetch(await cartesiaGatewayUrl(env, "voices"), {
    headers: cartesiaHeaders(env),
  })
  const body = await assertSuccessfulJsonResponse(response, "cartesia voices")
  return normalizeCartesiaVoices(body)
}
