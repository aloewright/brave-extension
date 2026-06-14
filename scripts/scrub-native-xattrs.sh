#!/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shopt -s nullglob

roots=(
  "$ROOT/node_modules"
  "$ROOT/native-host/node_modules"
  "$ROOT/worker/node_modules"
)

paths=()
for root in "${roots[@]}"; do
  [ -d "$root" ] || continue
  while IFS= read -r f; do
    paths+=("$f")
  done < <(
    find "$root" -type f \( \
      -name '*.node' \
      -o -name 'spawn-helper' \
      -o -name 'esbuild' \
      -o -name 'swift-manifest' \
    \) -print 2>/dev/null
  )
done

count=0
remaining=0
for f in "${paths[@]}"; do
  [ -e "$f" ] || continue
  /usr/bin/xattr -d com.apple.quarantine "$f" 2>/dev/null || true
  /usr/bin/xattr -d com.apple.provenance "$f" 2>/dev/null || true
  /usr/bin/xattr -d com.apple.macl "$f" 2>/dev/null || true
  attrs="$(/usr/bin/xattr "$f" 2>/dev/null || true)"
  if printf '%s\n' "$attrs" | grep -Eq 'com\.apple\.(quarantine|provenance|macl)'; then
    remaining=$((remaining + 1))
  fi
  count=$((count + 1))
done

if [ "$remaining" -gt 0 ]; then
  echo "⚠ Gatekeeper xattrs remain on $remaining/$count native artifact(s)."
elif [ "$count" -gt 0 ]; then
  echo "✓ Shell-scrubbed Gatekeeper xattrs on $count native artifact(s)."
fi
