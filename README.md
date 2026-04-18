# CPU Coach Harness

Portable CPU coaching harness for chess engines that accept a FEN on `stdin` and print a UCI move on `stdout`.

This package is meant to be shareable. It is not tied to FrostD4D weight injection or GPU forge code. It runs games, reviews losses with a coach engine, and emits lesson reports in JSON and Markdown.

## What It Does

- Runs a student engine against one or more CPU opponents.
- Reviews only the student positions from lost games.
- Asks a stronger coach engine what it would have played.
- Records disagreements as coaching moments.
- Tags those moments with lightweight categories such as `material`, `king_safety`, `development`, `pawn_structure`, `tactics`, and `endgame`.

## Engine Contract

Your engine should:

- read exactly one FEN position from `stdin`
- print exactly one legal UCI move on `stdout`
- exit cleanly

The harness will try to compile JS engines in-process for speed. If that fails, it falls back to spawning the engine as a process.

## Usage

From the repo root:

```bash
npm run coach:harness -- \
  --student student=variants/razor_x.js \
  --opponent titan=trainers/titan/agent.js \
  --opponent colossus=trainers/colossus/agent.js \
  --coach lozza=trainers/lozza/agent.js \
  --games 4 \
  --cycles 2
```

Or call the harness directly:

```bash
node coach_harness.mjs \
  --student my_bot=./path/to/agent.js \
  --opponents spar1=./opp_a.js,spar2=./opp_b.js \
  --coach ./path/to/coach.js \
  --out-dir ./out
```

## Key Flags

- `--student <engine>`: required
- `--opponent <engine>`: required, repeatable
- `--opponents a,b,c`: comma-separated alternative to repeated `--opponent`
- `--coach <engine>`: coach engine; defaults to academy Lozza when available
- `--games <n>`: games per cycle
- `--cycles <n>`: number of cycles
- `--timeout-ms <ms>`: student/opponent timeout per move
- `--coach-timeout-ms <ms>`: coach timeout per move
- `--out-dir <dir>`: where reports are written
- `--prefix <name>`: output filename prefix
- `--student-mode <auto|spawn|compiled>`: student load mode
- `--opponent-mode <auto|spawn|compiled>`: opponent load mode
- `--coach-mode <auto|spawn|compiled>`: coach load mode

Mode behavior:

- `auto`: current behavior (attempt compile, fallback to spawn)
- `spawn`: never attempts compile path
- `compiled`: requires compile path and fails fast if unavailable

## Output

The harness writes two files:

- `<prefix>_coach_report.json`
- `<prefix>_coach_report.md`

The report includes:

- match record
- cycle summaries
- reviewed positions from losses
- lesson breakdown by category, phase, and opponent
- top coaching disagreements

## Private Coaching Lane

Use the lane supervisor for continuous quick loops plus strict deterministic checkpoints.

Run one lane:

```bash
node scripts/private_coach_lane.mjs \
  --student student=./engines/fireturd.cjs \
  --opponent tomitank=./engines/tomitank.js \
  --coach lozza=./trainers/lozza/agent.js \
  --prefix private-lane-a \
  --quick-games 2 \
  --strict-games 6 \
  --strict-every 3 \
  --target-score 0.55 \
  --strict-student-mode spawn
```

Aggregate lane summaries:

```bash
node scripts/lane_aggregate.mjs \
  --glob './out/*_lane_summary.json' \
  --out-md ./out/lane_aggregate.md \
  --out-json ./out/lane_aggregate.json
```

Lane outputs:

- `<prefix>_lane_progress.md`
- `<prefix>_lane_summary.json`
- `<prefix>_lane_final.md`

## Sharing

The folder is intentionally self-contained:

- `coach_harness.mjs`
- `src/dojo_chess.mjs`
- `src/dojo_runtime.mjs`
- `package.json`

If you want to hand this to another competitor, they mostly need this folder plus a coach engine and any student/opponent engines that follow the same FEN/UCI single-shot contract.
