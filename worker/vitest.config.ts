import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    server: {
      deps: {
        // node: built-ins must not be bundled by vite — let Node resolve them.
        external: [/^node:/]
      }
    }
  }
})
