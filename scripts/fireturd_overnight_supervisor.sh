#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_SCRIPT="$SCRIPT_DIR/fireturd_overnight_supervisor.mjs"

if [ ! -f "$NODE_SCRIPT" ]; then
  echo "[supervisor] missing node script: $NODE_SCRIPT" >&2
  exit 1
fi

node "$NODE_SCRIPT" "$@"
