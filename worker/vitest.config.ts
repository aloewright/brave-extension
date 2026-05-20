import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `cloudflare:workers` only exists inside workerd. Tests map it to a
      // tiny stub so the WorkflowEntrypoint import in src/ doesn't crash.
      "cloudflare:workers": fileURLToPath(
        new URL("./tests/cloudflare-workers-stub.ts", import.meta.url)
      )
    }
  },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./tests/web/setup.ts"],
    server: {
      deps: {
        // node: built-ins must not be bundled by vite — let Node resolve them.
        external: [/^node:/]
      }
    }
  }
})
