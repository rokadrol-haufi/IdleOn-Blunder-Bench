#!/usr/bin/env bash
# Rebuilds engine.js and index.html from IdleonToolbox source.
# Usage: scripts/build.sh [toolbox-commit]   (defaults to the commit below)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLBOX_COMMIT="${1:-0979e7a97d4522608f0d86569f18231035866d53}"
WORK="$ROOT/.build"
TB="$WORK/IdleonToolbox"

mkdir -p "$WORK"
if [ ! -d "$TB/.git" ]; then
  git clone https://github.com/Morta1/IdleonToolbox.git "$TB"
fi
git -C "$TB" fetch --depth 1 origin "$TOOLBOX_COMMIT" 2>/dev/null || git -C "$TB" fetch origin
git -C "$TB" checkout -q "$TOOLBOX_COMMIT"

(cd "$TB" && npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps)

# 1. Bundle the stamp engine (IdleonToolbox parser + stamp maths) for the browser.
cp "$ROOT/src/engine-entry.js" "$TB/zz-engine.js"
(cd "$TB" && npx esbuild zz-engine.js --bundle --format=iife --global-name=StampEngine \
  --platform=browser --minify --target=es2020 --tsconfig=tsconfig.json --loader:.js=jsx \
  --define:process.env.NODE_ENV='"production"' --outfile="$ROOT/engine.js")
rm "$TB/zz-engine.js"

# 2. Assemble index.html with the stamp, material and coin icons inlined.
python3 "$ROOT/scripts/build_page.py" "$TB" "$ROOT"
echo "Built engine.js and index.html from IdleonToolbox $TOOLBOX_COMMIT"
