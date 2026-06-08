// Worker-compatible shim for the `esbuild` package's `transform()`.
//
// @tanstack/ai-code-mode's stripTypeScript() does `import { transform } from
// "esbuild"` and calls it with `{ loader: "ts" }` purely to strip TypeScript
// type syntax from the model-generated code. The real esbuild Node API relies
// on `__filename` + a native binary and throws "__filename is not defined"
// inside the Cloudflare Workers runtime, so every execute_typescript call fails.
//
// `ts-blank-space` is a pure-JS, dependency-free type-eraser (it blanks type
// syntax to whitespace, preserving line/column positions). That's exactly what
// `transform({ loader: "ts" })` does here, and it runs anywhere. We alias the
// bare `esbuild` specifier to this module in wrangler.toml ([alias]).
//
// Only `transform` is implemented because that's the sole esbuild API the
// Worker bundle uses at runtime. If anything else imports from esbuild at
// runtime it will hit these throwing stubs and surface loudly rather than
// silently misbehaving.
import tsBlankSpaceDefault from "ts-blank-space"

// ts-blank-space ships as a default export; tolerate either interop shape.
const tsBlankSpace: (code: string) => string =
  (tsBlankSpaceDefault as unknown as { default?: (c: string) => string }).default ??
  (tsBlankSpaceDefault as unknown as (c: string) => string)

export interface TransformResult {
  code: string
  map: string
  warnings: never[]
}

/** Minimal stand-in for esbuild.transform — strips TS types only. */
export async function transform(input: string): Promise<TransformResult> {
  return { code: tsBlankSpace(input), map: "", warnings: [] }
}

export function build(): never {
  throw new Error("esbuild-shim: build() is not available in the Worker runtime")
}

export default { transform, build }
