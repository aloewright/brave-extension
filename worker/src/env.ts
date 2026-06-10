// Bindings declared in wrangler.toml + the SIDEBAR_TOKEN secret.
export interface Env {
  DB: D1Database
  VECTORS: VectorizeIndex
  AI: Ai
  BLOBS: R2Bucket
  INGEST?: Workflow              // optional — code must work without it
  ASSETS?: Fetcher               // static SPA bundle; absent in plain-API tests
  SIDEBAR_TOKEN: string
  /** Cobalt download API (same-origin /api/ on cobalt-web). */
  COBALT_API_URL?: string
  /** Cloudflare Access service token for sidebar-api → cobalt. */
  COBALT_ACCESS_CLIENT_ID?: string
  COBALT_ACCESS_CLIENT_SECRET?: string
  /** Optional direct Cartesia token fallback for provider-native metadata endpoints. */
  CARTESIA_API_KEY?: string
}

// Workers AI model ids used by the Worker.
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5" as const
export const EMBED_DIMS = 768 as const
export const TRANSCRIBE_MODEL = "@cf/openai/whisper" as const
export const OCR_MODEL = "@cf/llava-hf/llava-1.5-7b-hf" as const
export const AGENT_PLAN_MODEL = "@cf/openai/gpt-oss-120b" as const
export const TTS_MODEL = "@cf/deepgram/aura-2-en" as const
export const TTS_DYNAMIC_MODEL = "dynamic/audio_gen" as const
export const CARTESIA_TTS_MODEL = "sonic-3.5" as const
export const CARTESIA_API_VERSION = "2026-03-01" as const
export const CARTESIA_TTS_VOICE_ID = "694f9389-aac1-45b6-b726-9d9369183238" as const
export type TtsModelMode = "frontier-aura" | "dynamic-audio-gen" | "cartesia-sonic"

// AI Gateway id from the account's existing config. Per CLAUDE.md, dynamic/*
// routes are broken inside a Worker; we route specific @cf/* models through
// gateway "x" instead. Swap to dynamic/* when upstream is fixed.
export const AI_GATEWAY_ID = "x" as const
