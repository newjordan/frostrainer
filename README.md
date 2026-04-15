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
node cpu_coach_harness/coach_harness.mjs \
  --student my_bot=./path/to/agent.js \
  --opponents spar1=./opp_a.js,spar2=./opp_b.js \
  --coach ./path/to/coach.js \
  --out-dir ./cpu_coach_harness/out
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

## Sharing

The folder is intentionally self-contained:

- `coach_harness.mjs`
- `src/dojo_chess.mjs`
- `src/dojo_runtime.mjs`
- `package.json`

If you want to hand this to another competitor, they mostly need this folder plus a coach engine and any student/opponent engines that follow the same FEN/UCI single-shot contract.
