#!/usr/bin/env bash
# Builds public/wasm/timeline_engine.wasm from timeline_engine.cpp.
#
#   With a local Emscripten SDK (emcc on PATH):   bash native/timeline-engine/build.sh
#   Without one, through Docker (no install):     bash native/timeline-engine/build.sh docker
#
# The result is a standalone WASM module (no JavaScript glue); the browser loads
# it with WebAssembly.instantiate in components/monitoring/time-machine/engine.ts.
# Commit the generated .wasm: the production image does not run Emscripten.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="$ROOT/public/wasm"
IMAGE="emscripten/emsdk:3.1.74"

if [ "${1:-}" = "docker" ]; then
  exec docker run --rm -v "$ROOT:/src" -w /src "$IMAGE" bash native/timeline-engine/build.sh
fi

command -v em++ >/dev/null || { echo "em++ not found. Install emsdk or run: bash native/timeline-engine/build.sh docker" >&2; exit 1; }

mkdir -p "$OUT_DIR"
EXPORTS='["_tm_init","_tm_set_direction","_tm_set_speed","_tm_set_playing","_tm_set_position","_tm_set_idle","_tm_tick","_tm_value"]'

em++ "$HERE/timeline_engine.cpp" \
  -std=c++20 -O3 -fno-exceptions -fno-rtti \
  --no-entry \
  -sSTANDALONE_WASM=1 \
  -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=65536 \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -o "$OUT_DIR/timeline_engine.wasm"

ls -l "$OUT_DIR/timeline_engine.wasm"
