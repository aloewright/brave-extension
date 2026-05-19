import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Playwright e2e specs live under tests/e2e and are driven by the
    // playwright runner — exclude them from vitest discovery.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // Floor is intentionally narrow: only the logic surfaces with real
      // unit suites today. Add files here as suites land (ALO-111 ratchet
      // plan, see ROADMAP).
      include: [
        "src/lib/text.ts",
        "src/lib/tool-classes.ts",
        "src/lib/recorder-chunks.ts",
        "src/lib/screenshot.ts",
        "src/lib/selector.ts"
      ],
      exclude: ["**/node_modules/**", "**/dist/**", "**/*.d.ts"],
      thresholds: {
        lines: 60,
        functions: 60,
        statements: 60,
        branches: 50
      }
    }
  }
})
