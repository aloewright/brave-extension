import {
  AI_GATEWAY_ID,
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
    // Cartesia key, so the Worker sends the Cartesia request shape but does
    // not carry a provider secret of its own.
    const raw = await (env.AI as any).gateway(AI_GATEWAY_ID).run({
      provider: "cartesia",
      endpoint: "tts/bytes",
      headers: {
        "Cartesia-Version": "2024-06-10",
      },
      query: {
        transcript: input.text,
        model_id: CARTESIA_TTS_MODEL,
        voice: {
          mode: "id",
          id: input.speaker || CARTESIA_TTS_VOICE_ID,
        },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
      },
    })

    if (raw instanceof Response) return assertSuccessfulAudioResponse(raw, "tts cartesia")
    if (raw instanceof ReadableStream) {
      return new Response(raw, { headers: { "content-type": "audio/mpeg" } })
    }
    if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) {
      return new Response(raw, { headers: { "content-type": "audio/mpeg" } })
    }
    throw new Error("tts cartesia: unexpected AI response shape")
  }

  if (input.ttsModel === "dynamic-audio-gen") {
    // User-selectable dynamic route. AGENTS.md notes Worker-side dynamic/*
    // routing has been flaky in this account; keep it isolated so the direct
    // Aura path remains the default and this can be swapped when upstream fixes.
    const raw = await (env.AI as any).gateway(AI_GATEWAY_ID).run({
      provider: "compat",
      endpoint: "audio/speech",
      headers: {},
      query: {
        model: TTS_DYNAMIC_MODEL,
        input: input.text,
        voice: speaker,
        response_format: "mp3"
      },
    })

    if (raw instanceof Response) return assertSuccessfulAudioResponse(raw, "tts dynamic route")
    if (raw instanceof ReadableStream) {
      return new Response(raw, { headers: { "content-type": "audio/mpeg" } })
    }
    if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) {
      return new Response(raw, { headers: { "content-type": "audio/mpeg" } })
    }
    throw new Error("tts dynamic route: unexpected AI response shape")
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
  const gateway = (env.AI as any).gateway(AI_GATEWAY_ID)
  const headers = {
    "Cartesia-Version": "2024-06-10",
    ...(env.CARTESIA_API_KEY ? { "X-API-Key": env.CARTESIA_API_KEY } : {}),
  }

  try {
    const raw = await gateway.run({
      provider: "cartesia",
      endpoint: "voices",
      method: "GET",
      headers,
      query: {},
    })
    const body = raw instanceof Response
      ? await assertSuccessfulJsonResponse(raw, "cartesia voices")
      : raw
    return normalizeCartesiaVoices(body)
  } catch (err) {
    if (!env.CARTESIA_API_KEY) throw err
    const baseUrl = await gateway.getUrl("cartesia")
    const response = await fetch(`${String(baseUrl).replace(/\/+$/, "")}/voices`, {
      headers,
    })
    const body = await assertSuccessfulJsonResponse(response, "cartesia voices")
    return normalizeCartesiaVoices(body)
  }
}
