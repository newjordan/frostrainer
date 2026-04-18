#!/usr/bin/env bash
set -euo pipefail

ROOT_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="${ROOT:-$ROOT_DEFAULT}"
END_LOCAL="${END_LOCAL:-09:00}"
TZ_LOCAL="${TZ_LOCAL:-America/Chicago}"
SLEEP_BETWEEN="${SLEEP_BETWEEN:-20}"
ONE_PASS_SCRIPT="scripts/fireturd_one_pass.mjs"
HARNESS_SCRIPT="coach_harness.mjs"

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
      printf '%s|fireturd_one_pass.lock\n' "$pid"
      return 0
    fi
    rm -f "$LOCK_FILE"
  fi

  while IFS=' ' read -r pid _comm cmd; do
    [ -z "$pid" ] && continue
    [ "$_comm" = "node" ] || [ "$_comm" = "nodejs" ] || continue

    if [[ "$cmd" == *"$ONE_PASS_SCRIPT"* ]]; then
      printf '%s|node:%s\n' "$pid" "$ONE_PASS_SCRIPT"
      return 0
    fi

    if [[ "$cmd" == *"$HARNESS_SCRIPT"* ]]; then
      printf '%s|node:%s\n' "$pid" "$HARNESS_SCRIPT"
      return 0
    fi
  done < <(ps -eo pid=,comm=,args=)

  return 1
}

END_EPOCH="$(compute_end_epoch)"
STARTED_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"startedUtc":"%s","targetEndLocal":"%s %s","endEpoch":%s,"sleepBetweenSeconds":%s,"root":"%s"}\n' \
  "$STARTED_UTC" "$END_LOCAL" "$TZ_LOCAL" "$END_EPOCH" "$SLEEP_BETWEEN" "$ROOT" > "$STATE_FILE"

echo "[supervisor] started at $STARTED_UTC, end epoch=$END_EPOCH ($END_LOCAL $TZ_LOCAL)"

while [ "$(date +%s)" -lt "$END_EPOCH" ]; do
  ACTIVE_INFO="$(active_pass_pid || true)"
  ACTIVE_PID=""
  ACTIVE_KIND=""
  if [ -n "$ACTIVE_INFO" ]; then
    ACTIVE_PID="${ACTIVE_INFO%%|*}"
    ACTIVE_KIND="${ACTIVE_INFO#*|}"
  fi

  if [ -n "$ACTIVE_PID" ]; then
    NOW_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"startedUtc":"%s","targetEndLocal":"%s %s","endEpoch":%s,"sleepBetweenSeconds":%s,"root":"%s","lastStatus":"waiting-active","activePid":%s,"activeProcessType":"%s","updatedUtc":"%s"}\n' \
      "$STARTED_UTC" "$END_LOCAL" "$TZ_LOCAL" "$END_EPOCH" "$SLEEP_BETWEEN" "$ROOT" "$ACTIVE_PID" "$ACTIVE_KIND" "$NOW_UTC" > "$STATE_FILE"
    echo "[supervisor] active run detected: pid=$ACTIVE_PID process=$ACTIVE_KIND, sleeping $SLEEP_BETWEEN s"
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
