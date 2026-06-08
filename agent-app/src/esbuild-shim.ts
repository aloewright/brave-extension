// Worker-compatible shim for the `esbuild` package's `transform()`.
//
// @tanstack/ai-code-mode's stripTypeScript() does `import { transform } from
// "esbuild"` and calls it with `{ loader: "ts" }` purely to strip TypeScript
// type syntax from the model-generated code. The real esbuild Node API relies
// on `__filename` + a native binary and throws "__filename is not defined"
// inside the Cloudflare Workers runtime, so every execute_typescript call fails.
//
// `sucrase` is a pure-JS transpiler (no esbuild/typescript/native deps, no
// __filename) designed to run in browsers and edge runtimes. With
// `transforms: ["typescript"]` it strips TS type syntax to plain JS — exactly
// what `transform({ loader: "ts" })` does here. We alias the bare `esbuild`
// specifier to this module in wrangler.toml ([alias]).
//
// Only `transform` is implemented because that's the sole esbuild API the
// Worker bundle uses at runtime. If anything else imports from esbuild at
// runtime it will hit these throwing stubs and surface loudly rather than
// silently misbehaving.
import { transform as sucraseTransform } from "sucrase"

export interface TransformResult {
  code: string
  map: string
  warnings: never[]
}

/** Minimal stand-in for esbuild.transform — strips TS types via sucrase. */
export async function transform(input: string): Promise<TransformResult> {
  const { code } = sucraseTransform(input, {
    transforms: ["typescript"],
    // The model code may use top-level constructs inside the wrapper function;
    // preserve dynamic import + keep output as-is otherwise.
    preserveDynamicImport: true
  })
  return { code, map: "", warnings: [] }
}

export function build(): never {
  throw new Error("esbuild-shim: build() is not available in the Worker runtime")
}

export default { transform, build }
