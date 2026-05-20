// Empty postcss config so Vite/vitest in this subproject doesn't walk up
// to the repo-root postcss.config.js (which loads tailwindcss — not a
// dependency of this Worker). Phase 4's SPA replaces this with a real
// Tailwind-enabled config when it lands.
export default {
  plugins: {}
}
