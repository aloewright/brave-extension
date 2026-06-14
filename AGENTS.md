## Learned User Preferences

- Use the `cursor/` branch name prefix for agent-created feature branches (e.g. `cursor/short-description`).
- Keep commits scoped to the work at hand; exclude unrelated files and put separate features on their own branches.
- On macOS, suppress Gatekeeper "Apple could not verify … is free of malware" dialogs for native binaries used by dev and terminal workflows (node-pty, esbuild, rollup, fsevents, swift-manifest, and similar).

## Learned Workspace Facts

- Brave Dev Extension (`brave-extension` in package.json) is a custom-built MV3 extension for Brave/Chromium; GitHub repo is `aloewright/brave-extension`.
- The active extension build path is `pnpm build` / `pnpm build:extension`, both backed by `node scripts/build-extension.mjs`. Do not reintroduce Plasmo or esbuild for extension builds.
- Layout: extension root (React + TypeScript UI), `native-host/` (Node native messaging, PTY, MCP), optional `worker/` (Cloudflare Workers backend).
- Extension pages use explicit HTML entrypoints (`sidepanel.html`, `newtab.html`, `popup.html`, `media-preview.html`, `tabs/offscreen.html`) and React/TypeScript entries under `src/entries/`.
- Content scripts are registered in `scripts/build-extension.mjs`, which emits stable `content/*.js` files and writes `build/manifest.json`.
- Storage uses the local `ExtensionStorage` wrapper in `src/lib/extension-storage.ts`; do not add `@plasmohq/storage`.
- Use pnpm from the repo root (`/Users/aloe/Development/ai-dev-sidebar`); scripts fail if run from `$HOME` without `--dir`.
- New tab quick links default in `src/newtab-quick-links.ts` and persist in `chrome.storage.local` under `newtab.quickLinks`.
- macOS native-addon quarantine is handled via `pnpm scrub-native`, postinstall scrub, `pnpm diagnose-host`, and `pnpm warm-pty` (see README ALO-472 section).
- Historical plans/specs under `docs/superpowers/` may mention the old Plasmo architecture. Treat those references as archival context only; current code and this file take precedence.
