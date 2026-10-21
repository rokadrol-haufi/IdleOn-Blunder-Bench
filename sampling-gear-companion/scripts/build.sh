#!/usr/bin/env bash
# Rebuilds the Sampling and Gear Companion bundle and index.html from IdleonToolbox source.
# Usage: scripts/build.sh [toolbox-commit]   (defaults to the commit below)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLBOX_COMMIT="${1:-3beed1aefd58cc0a992dbafa3729987af3e0614d}"
WORK="$ROOT/.build"
TB="$WORK/IdleonToolbox"

mkdir -p "$WORK"
if [ ! -d "$TB/.git" ]; then
  git clone https://github.com/Morta1/IdleonToolbox.git "$TB"
fi
git -C "$TB" fetch --depth 1 origin "$TOOLBOX_COMMIT" 2>/dev/null || git -C "$TB" fetch origin
git -C "$TB" checkout -q "$TOOLBOX_COMMIT"
(cd "$TB" && npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps)

# 1. Bundle IdleonToolbox's parser + the efficiency entry point for the browser.
rm -rf "$TB/kimgap" && cp -r "$ROOT/src/kimgap" "$TB/kimgap"
(cd "$TB" && npx esbuild kimgap/entry.js --bundle --format=iife --global-name=KimGap \
  --platform=browser --target=es2020 --minify --tsconfig=tsconfig.json \
  --alias:@website-data=./data/website-data/index.js --outfile="$WORK/bundle.js")

# 2. Optional: rebuild the best-in-slot boards and the icon set from the Toolbox images.
if [ "${REBUILD_IMAGES:-0}" = "1" ]; then
  TB="$TB" OUT="$ROOT/data" python3 "$ROOT/src/bis/build2.py"
  TB="$TB" OUT="$ROOT/data" python3 "$ROOT/src/icons.py"
  TB="$TB" OUT="$ROOT/data" python3 "$ROOT/src/act_icons.py"
fi

# 3. Assemble index.html (no save data is embedded).
python3 "$ROOT/scripts/assemble.py" "$ROOT"
echo "Built sampling-gear-companion/index.html from IdleonToolbox $TOOLBOX_COMMIT"
