import type { Env } from "../env"
import isolateWorker from "@tanstack/ai-isolate-cloudflare/worker" // default export { fetch(request, env, ctx) }
import { codeExecGuard } from "./code-exec-guard"

// Re-export so callers/tests can import the guard from here too.
export { codeExecGuard } from "./code-exec-guard"

/** POST /internal/code-exec — runs model-generated code in a loaded isolate.
 *  The isolate receives NO agent-app bindings; tool calls round-trip to the host
 *  via the driver callback protocol. Guarded by CODE_EXEC_TOKEN. */
export async function codeExecRoute(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!codeExecGuard(request.headers.get("authorization") ?? undefined, env.CODE_EXEC_TOKEN ?? "")) {
    return new Response("unauthorized", { status: 401 })
  }
  // The isolate handler only reads env.LOADER (see node_modules/.../worker/index.d.ts).
  return isolateWorker.fetch(request, env, ctx)
}
