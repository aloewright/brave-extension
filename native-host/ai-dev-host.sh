#!/bin/bash
# Wrapper script for native messaging host
# Chrome requires a direct executable — this ensures Node runs the .mjs with proper ESM support
# Set PATH so spawned CLI tools (claude, gemini, codex, gh) are discoverable
export PATH="/Users/aloe/.vite-plus/js_runtime/node/24.14.1/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec /Users/aloe/.vite-plus/js_runtime/node/24.14.1/bin/node "/Users/aloe/Development/ai-dev-sidebar/native-host/ai-dev-host.mjs" "$@"
