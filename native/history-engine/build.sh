#!/usr/bin/env bash
# Builds the server-side history engine and embeds it for Next.js.
#
#   With emsdk on PATH (em++):          bash native/history-engine/build.sh
#   Windows, emsdk at C:\emsdk:         bash native/history-engine/build.sh   (em++.exe is located automatically)
#   Without emsdk, through Docker:      bash native/history-engine/build.sh docker
#
# Output: native/history-engine/dist/history_engine.wasm, and
#         lib/monitoring/history/history-engine.wasm.generated.ts (the module as
#         base64, so the API route needs no filesystem access on Vercel).
# Commit both generated files: the production build does not run Emscripten.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT="$HERE/dist"
IMAGE="emscripten/emsdk:3.1.74"

if [ "${1:-}" = "docker" ]; then
  exec docker run --rm -v "$ROOT:/src" -w /src "$IMAGE" bash native/history-engine/build.sh
fi

EMXX="$(command -v em++ || true)"
[ -z "$EMXX" ] && [ -x "/c/emsdk/upstream/emscripten/em++.exe" ] && EMXX="/c/emsdk/upstream/emscripten/em++.exe"
[ -z "$EMXX" ] && { echo "em++ not found. Install emsdk or run: bash native/history-engine/build.sh docker" >&2; exit 1; }

mkdir -p "$OUT"
EXPORTS='["_he_version","_he_begin","_he_set_request","_he_add_event","_he_run","_he_req_status","_he_req_since","_he_req_flags","_he_status_count","_he_stage_stat","_he_counter","_he_hash_hi","_he_hash_lo"]'

"$EMXX" "$HERE/history_engine.cpp" \
  -std=c++20 -O3 -fno-exceptions -fno-rtti \
  --no-entry \
  -sSTANDALONE_WASM=1 \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 -sMAXIMUM_MEMORY=1073741824 -sSTACK_SIZE=262144 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -o "$OUT/history_engine.wasm"

node "$HERE/embed.mjs"
