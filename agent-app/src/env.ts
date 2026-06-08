// Bindings declared in wrangler.toml + secrets managed via Doppler.
export interface Env {
  DB: D1Database
  BLOBS: R2Bucket
  VECTORS: VectorizeIndex
  AI: Ai
  AGENT_KV: KVNamespace
  CHAT_AGENT: DurableObjectNamespace<import("./agents/chat-agent").ChatAgent>
  /** Static SPA assets binding (wrangler [assets]); SPA fallback to index.html. */
  ASSETS?: Fetcher

  // --- Cloudflare Access secrets (Doppler → wrangler secret put) ---
  /** Access service-token client id the extension must present. */
  ACCESS_CLIENT_ID?: string
  /** Access service-token client secret the extension must present. */
  ACCESS_CLIENT_SECRET?: string
  /** Access application audience (AUD) tag for SSO JWT verification. */
  ACCESS_AUD?: string
  /** Access team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string

  // --- AI Gateway (used in Plan 2) ---
  CF_ACCOUNT_ID?: string
  CF_AIG_TOKEN?: string

  // --- Hindsight remote MCP creds + code-exec shared secret ---
  HINDSIGHT_URL?: string
  HINDSIGHT_BEARER?: string
  HINDSIGHT_ACCESS_CLIENT_ID?: string
  HINDSIGHT_ACCESS_CLIENT_SECRET?: string
  CODE_EXEC_TOKEN?: string
}

// AI Gateway id per CLAUDE.md. Dynamic routes are broken inside a Worker;
// Plan 2 routes specific @cf/* models through gateway "x".
export const AI_GATEWAY_ID = "x" as const
