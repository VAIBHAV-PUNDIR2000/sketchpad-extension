#!/usr/bin/env bash
# Build the Chrome Web Store upload zip.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="dist/scratchpad-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"
python3 tools/make_icons.py icons >/dev/null

zip -q -r "$OUT" manifest.json src icons \
  -x '*.DS_Store' -x '__MACOSX/*'

echo "$OUT  ($(du -h "$OUT" | cut -f1 | tr -d ' '))"
unzip -Z1 "$OUT" | sort
