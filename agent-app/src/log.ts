// Structured logging for the agent-app Worker. Emits single-line JSON so
// Cloudflare Workers Logs (enabled via [observability] in wrangler.toml) and
// `wrangler tail` can filter on fields. Covers both the app request flow and
// the AI calls (model id, latency, byte counts, success/error).

export type LogLevel = "info" | "warn" | "error"

export interface LogFields {
  [key: string]: unknown
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  const line = { level, event, ...fields }
  const payload = JSON.stringify(line)
  if (level === "error") console.error(payload)
  else if (level === "warn") console.warn(payload)
  else console.log(payload)
}

export const log = {
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields)
}

/** Monotonic-ish elapsed ms helper (Date.now is fine inside a Worker request). */
export function since(startMs: number): number {
  return Date.now() - startMs
}
