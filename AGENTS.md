## Learned User Preferences

- Use the `cursor/` branch name prefix for agent-created feature branches (e.g. `cursor/short-description`).
- Keep commits scoped to the work at hand; exclude unrelated files and put separate features on their own branches.
- On macOS, suppress Gatekeeper "Apple could not verify … is free of malware" dialogs for native binaries used by dev and terminal workflows (node-pty, esbuild, rollup, fsevents, swift-manifest, and similar).

## Learned Workspace Facts

- Brave Dev Extension (`brave-extension` in package.json) is a Plasmo MV3 extension for Brave/Chromium; GitHub repo is `aloewright/brave-extension`.
- Layout: extension root (React + TypeScript UI), `native-host/` (Node native messaging, PTY, MCP), optional `worker/` (Cloudflare Workers backend).
- Use pnpm from the repo root (`/Users/aloe/Development/ai-dev-sidebar`); scripts fail if run from `$HOME` without `--dir`.
- New tab quick links default in `src/newtab-quick-links.ts` and persist in `chrome.storage.local` under `newtab.quickLinks`.
- macOS native-addon quarantine is handled via `pnpm scrub-native`, postinstall scrub, `pnpm diagnose-host`, and `pnpm warm-pty` (see README ALO-472 section).
