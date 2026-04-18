#!/usr/bin/env bash
set -euo pipefail

ROOT_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${ROOT:-$ROOT_DEFAULT}"
END_LOCAL="${END_LOCAL:-09:00}"
TZ_LOCAL="${TZ_LOCAL:-America/Chicago}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-20}"

if ! [[ "$SLEEP_BETWEEN" =~ ^[0-9]+$ ]] || [ "$SLEEP_BETWEEN" -le 0 ]; then
  echo "[supervisor] SLEEP_BETWEEN must be a positive integer, got: $SLEEP_BETWEEN" >&2
  exit 1
fi

OUT_DIR="$ROOT/out"
STATE_FILE="$OUT_DIR/fireturd_overnight_supervisor_state.json"
LOCK_FILE="$OUT_DIR/fireturd_one_pass.lock"
mkdir -p "$OUT_DIR"

compute_end_epoch() {
  local end_epoch now_epoch
  end_epoch=$(TZ="$TZ_LOCAL" date -d "today $END_LOCAL" +%s)
  now_epoch=$(date +%s)
  if [ "$now_epoch" -ge "$end_epoch" ]; then
    end_epoch=$(TZ="$TZ_LOCAL" date -d "tomorrow $END_LOCAL" +%s)
  fi
  printf '%s\n' "$end_epoch"
}

active_pass_pid() {
  if [ -f "$LOCK_FILE" ]; then
    local pid
    pid=$(grep -Eo '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$LOCK_FILE" | head -n1 | grep -Eo '[0-9]+' || true)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      printf '%s\n' "$pid"
      return 0
    fi
    rm -f "$LOCK_FILE"
  fi

  pgrep -f "node .*scripts/fireturd_one_pass\\.mjs" | head -n1 || true
}

END_EPOCH="$(compute_end_epoch)"
STARTED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"startedUtc":"%s","targetEndLocal":"%s %s","endEpoch":%s,"sleepBetweenSeconds":%s,"root":"%s"}\n' \
  "$STARTED_UTC" "$END_LOCAL" "$TZ_LOCAL" "$END_EPOCH" "$SLEEP_BETWEEN" "$ROOT" > "$STATE_FILE"

echo "[supervisor] started at $STARTED_UTC, end epoch=$END_EPOCH ($END_LOCAL $TZ_LOCAL)"

while [ "$(date +%s)" -lt "$END_EPOCH" ]; do
  ACTIVE_PID="$(active_pass_pid)"
  if [ -n "$ACTIVE_PID" ]; then
    NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"startedUtc":"%s","targetEndLocal":"%s %s","endEpoch":%s,"sleepBetweenSeconds":%s,"root":"%s","lastStatus":"waiting-active","activePid":%s,"updatedUtc":"%s"}\n' \
      "$STARTED_UTC" "$END_LOCAL" "$TZ_LOCAL" "$END_EPOCH" "$SLEEP_BETWEEN" "$ROOT" "$ACTIVE_PID" "$NOW_UTC" > "$STATE_FILE"
    echo "[supervisor] active run detected (pid=$ACTIVE_PID), sleeping $SLEEP_BETWEEN s"
    sleep "$SLEEP_BETWEEN"
    continue
  fi

  TS="$(date +%Y%m%d-%H%M%S)"
  LOG_FILE="$OUT_DIR/fireturd_overnight_supervisor_${TS}.log"
  echo "[supervisor] launching one-pass at $TS" | tee -a "$LOG_FILE"

  set +e
  (
    cd "$ROOT"
    node scripts/fireturd_one_pass.mjs
  ) >> "$LOG_FILE" 2>&1
  RC=$?
  set -e

  FINISHED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[supervisor] one-pass finished rc=$RC at $FINISHED_UTC" | tee -a "$LOG_FILE"

  printf '{"startedUtc":"%s","targetEndLocal":"%s %s","endEpoch":%s,"sleepBetweenSeconds":%s,"root":"%s","lastStatus":"run-finished","lastRunLog":"%s","lastRunRc":%s,"updatedUtc":"%s"}\n' \
    "$STARTED_UTC" "$END_LOCAL" "$TZ_LOCAL" "$END_EPOCH" "$SLEEP_BETWEEN" "$ROOT" "$LOG_FILE" "$RC" "$FINISHED_UTC" > "$STATE_FILE"

  sleep "$SLEEP_BETWEEN"
done

echo "[supervisor] window complete at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
