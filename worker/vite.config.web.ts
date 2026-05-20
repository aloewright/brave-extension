import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  root: fileURLToPath(new URL("./web", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("./dist/web", import.meta.url)),
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022"
  },
  server: {
    port: 5173,
    proxy: {
      // For local SPA dev: forward API calls to a running `pnpm dev` Worker.
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: false
      }
    }
  }
})
