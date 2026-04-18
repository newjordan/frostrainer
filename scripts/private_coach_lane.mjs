#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = resolve(__dirname, '..', 'coach_harness.mjs');

function printUsage() {
  console.log(`Private Coach Lane

Usage:
  node scripts/private_coach_lane.mjs --student <engine> --opponent <engine> --coach <engine> [options]

Required:
  --student <engine>                Student engine spec.
  --opponent <engine>               Opponent engine spec.
  --coach <engine>                  Coach engine spec.

Options:
  --out-dir <dir>                   Output directory. Default: ./out
  --prefix <name>                   Lane prefix. Default: private-lane
  --quick-games <n>                 Quick games per iteration. Default: 2
  --strict-games <n>                Strict games per checkpoint. Default: 6
  --quick-max-ply <n>               Quick max ply. Default: 120
  --strict-max-ply <n>              Strict max ply. Default: 180
  --target-score <float>            Promotion target score. Default: 0.5
  --max-iterations <n>              Maximum iterations. Default: 18
  --strict-every <n>                Run strict every N iterations. Default: 3
  --timeout-ms <n>                  Student/opponent timeout. Default: 700
  --coach-timeout-ms <n>            Coach timeout. Default: 300
  --strict-student-mode <mode>      Strict student mode: auto|spawn|compiled. Default: spawn
  --help                            Show this message

Example:
  node scripts/private_coach_lane.mjs \\
    --student student=./engines/fireturd.cjs \\
    --opponent tomitank=./engines/tomitank.js \\
    --coach lozza=./trainers/lozza/agent.js \\
    --prefix lane-a --strict-student-mode spawn
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function asPositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`Invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function asScore(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail(`Invalid value for ${flag}: ${value}. Expected float in [0, 1]`);
  }
  return parsed;
}

function parseMode(value, flag) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'auto' || mode === 'spawn' || mode === 'compiled') return mode;
  fail(`Invalid value for ${flag}: ${value}. Expected one of: auto, spawn, compiled`);
}

function parseArgs(argv) {
  const options = {
    student: '',
    opponent: '',
    coach: '',
    outDir: resolve(process.cwd(), 'out'),
    prefix: 'private-lane',
    quickGames: 2,
    strictGames: 6,
    quickMaxPly: 120,
    strictMaxPly: 180,
    targetScore: 0.5,
    maxIterations: 18,
    strictEvery: 3,
    timeoutMs: 700,
    coachTimeoutMs: 300,
    strictStudentMode: 'spawn',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '--student') {
      options.student = argv[++i] || '';
    } else if (arg === '--opponent') {
      options.opponent = argv[++i] || '';
    } else if (arg === '--coach') {
      options.coach = argv[++i] || '';
    } else if (arg === '--out-dir') {
      options.outDir = resolve(process.cwd(), argv[++i] || '');
    } else if (arg === '--prefix') {
      options.prefix = String(argv[++i] || '').trim() || options.prefix;
    } else if (arg === '--quick-games') {
      options.quickGames = asPositiveInt(argv[++i], '--quick-games');
    } else if (arg === '--strict-games') {
      options.strictGames = asPositiveInt(argv[++i], '--strict-games');
    } else if (arg === '--quick-max-ply') {
      options.quickMaxPly = asPositiveInt(argv[++i], '--quick-max-ply');
    } else if (arg === '--strict-max-ply') {
      options.strictMaxPly = asPositiveInt(argv[++i], '--strict-max-ply');
    } else if (arg === '--target-score') {
      options.targetScore = asScore(argv[++i], '--target-score');
    } else if (arg === '--max-iterations') {
      options.maxIterations = asPositiveInt(argv[++i], '--max-iterations');
    } else if (arg === '--strict-every') {
      options.strictEvery = asPositiveInt(argv[++i], '--strict-every');
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = asPositiveInt(argv[++i], '--timeout-ms');
    } else if (arg === '--coach-timeout-ms') {
      options.coachTimeoutMs = asPositiveInt(argv[++i], '--coach-timeout-ms');
    } else if (arg === '--strict-student-mode') {
      options.strictStudentMode = parseMode(argv[++i], '--strict-student-mode');
    } else {
      fail(`Unknown flag: ${arg}`);
    }
  }

  if (!options.student) fail('Missing required flag: --student');
  if (!options.opponent) fail('Missing required flag: --opponent');
  if (!options.coach) fail('Missing required flag: --coach');

  return options;
}

function scoreFromSummary(summary) {
  const wins = Number(summary?.wins || 0);
  const draws = Number(summary?.draws || 0);
  const games = Number(summary?.games || 0);
  if (!Number.isFinite(games) || games <= 0) return 0;
  return (wins + 0.5 * draws) / games;
}

function wilson95(score, games) {
  const n = Number(games || 0);
  if (!Number.isFinite(n) || n <= 0) return { low: 0, high: 0 };
  const z = 1.96;
  const z2 = z * z;
  const p = Math.max(0, Math.min(1, Number(score || 0)));
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

function fmt(value, digits = 3) {
  return Number(value || 0).toFixed(digits);
}

function loadHarnessReport(outDir, runPrefix) {
  const jsonPath = join(outDir, `${runPrefix}_coach_report.json`);
  if (!existsSync(jsonPath)) {
    fail(`Expected harness report not found: ${jsonPath}`);
  }
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  return {
    jsonPath,
    mdPath: join(outDir, `${runPrefix}_coach_report.md`),
    report,
    score: scoreFromSummary(report.summary),
  };
}

function runHarness(options) {
  const args = [HARNESS_PATH, ...options];
  const result = { stdout: '', stderr: '' };
  try {
    result.stdout = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
    return result;
  } catch (error) {
    const stdout = String(error?.stdout || '');
    const stderr = String(error?.stderr || '');
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    fail(`Harness run failed.\n${detail || String(error?.message || error)}`);
  }
}

function buildProgressMarkdown(state) {
  const lines = [];
  lines.push('# Private Coach Lane Progress');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Lane: ${state.prefix}`);
  lines.push('');
  lines.push('## Config');
  lines.push('');
  lines.push(`- Student: ${state.student}`);
  lines.push(`- Opponent: ${state.opponent}`);
  lines.push(`- Coach: ${state.coach}`);
  lines.push(`- Quick games/max ply: ${state.quickGames}/${state.quickMaxPly}`);
  lines.push(`- Strict games/max ply: ${state.strictGames}/${state.strictMaxPly}`);
  lines.push(`- Strict every: ${state.strictEvery}`);
  lines.push(`- Target score: ${fmt(state.targetScore)}`);
  lines.push(`- Strict student mode: ${state.strictStudentMode}`);
  lines.push('');
  lines.push('## Iterations');
  lines.push('');
  lines.push('| Iteration | Quick Score | Quick Delta vs Best | Strict Score | Strict CI95 |');
  lines.push('|---|---:|---:|---:|---|');
  for (const row of state.rows) {
    lines.push(`| ${row.iteration} | ${fmt(row.quickScore)} | ${fmt(row.quickDelta)} | ${row.strictScoreText} | ${row.strictCiText} |`);
  }
  lines.push('');
  lines.push('## Scoreboard');
  lines.push('');
  if (state.bestQuick) {
    lines.push(`- Best quick: ${fmt(state.bestQuick.score)} at iteration ${state.bestQuick.iteration}`);
  }
  if (state.bestStrict) {
    lines.push(`- Best strict: ${fmt(state.bestStrict.score)} at iteration ${state.bestStrict.iteration} (CI95 ${fmt(state.bestStrict.wilson95.low)}..${fmt(state.bestStrict.wilson95.high)})`);
  } else {
    lines.push('- Best strict: not run yet');
  }
  return `${lines.join('\n')}\n`;
}

function buildFinalMarkdown(summary) {
  const lines = [];
  lines.push('# Private Coach Lane Final');
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Lane: ${summary.laneId}`);
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push(`- Target score: ${fmt(summary.targetScore)}`);
  lines.push(`- Best strict score: ${fmt(summary.bestStrict?.score || 0)}`);
  if (summary.bestStrict?.wilson95) {
    lines.push(`- Strict CI95: ${fmt(summary.bestStrict.wilson95.low)}..${fmt(summary.bestStrict.wilson95.high)}`);
  }
  lines.push(`- Promotion: ${summary.promotion.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## Best Runs');
  lines.push('');
  if (summary.bestQuick) {
    lines.push(`- Best quick iteration ${summary.bestQuick.iteration}: ${fmt(summary.bestQuick.score)} (${summary.bestQuick.summary.wins}/${summary.bestQuick.summary.draws}/${summary.bestQuick.summary.losses})`);
  }
  if (summary.bestStrict) {
    lines.push(`- Best strict iteration ${summary.bestStrict.iteration}: ${fmt(summary.bestStrict.score)} (${summary.bestStrict.summary.wins}/${summary.bestStrict.summary.draws}/${summary.bestStrict.summary.losses})`);
  }
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Progress: ${summary.files.progressMd}`);
  lines.push(`- Summary JSON: ${summary.files.summaryJson}`);
  lines.push(`- Final: ${summary.files.finalMd}`);
  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  mkdirSync(options.outDir, { recursive: true });

  const progressPath = join(options.outDir, `${options.prefix}_lane_progress.md`);
  const summaryPath = join(options.outDir, `${options.prefix}_lane_summary.json`);
  const finalPath = join(options.outDir, `${options.prefix}_lane_final.md`);

  const quickRuns = [];
  const strictRuns = [];
  const rows = [];
  let bestQuick = null;
  let bestStrict = null;

  console.log('Private Coach Lane');
  console.log(`  lane: ${options.prefix}`);
  console.log(`  iterations: ${options.maxIterations}`);
  console.log(`  strict every: ${options.strictEvery}`);

  for (let iteration = 1; iteration <= options.maxIterations; iteration++) {
    const quickPrefix = `${options.prefix}_quick_iter${String(iteration).padStart(2, '0')}`;
    process.stdout.write(`Iteration ${iteration}/${options.maxIterations} quick... `);
    runHarness([
      '--student', options.student,
      '--opponent', options.opponent,
      '--coach', options.coach,
      '--games', String(options.quickGames),
      '--cycles', '1',
      '--max-ply', String(options.quickMaxPly),
      '--timeout-ms', String(options.timeoutMs),
      '--coach-timeout-ms', String(options.coachTimeoutMs),
      '--out-dir', options.outDir,
      '--prefix', quickPrefix,
      '--student-mode', 'auto',
      '--opponent-mode', 'auto',
      '--coach-mode', 'auto',
    ]);
    const quick = loadHarnessReport(options.outDir, quickPrefix);
    const quickEntry = {
      type: 'quick',
      iteration,
      prefix: quickPrefix,
      score: quick.score,
      summary: quick.report.summary,
      report: {
        json: quick.jsonPath,
        md: quick.mdPath,
      },
      modes: quick.report?.config?.modes || null,
      generatedAt: quick.report.generatedAt,
    };
    quickRuns.push(quickEntry);

    const previousBestQuickScore = bestQuick ? bestQuick.score : quickEntry.score;
    if (!bestQuick || quickEntry.score > bestQuick.score) {
      bestQuick = quickEntry;
    }
    const quickDelta = quickEntry.score - previousBestQuickScore;
    console.log(`score=${fmt(quickEntry.score)}`);

    let strictScoreText = '-';
    let strictCiText = '-';

    if (iteration % options.strictEvery === 0) {
      const strictPrefix = `${options.prefix}_strict_iter${String(iteration).padStart(2, '0')}`;
      process.stdout.write(`Iteration ${iteration}/${options.maxIterations} strict... `);
      runHarness([
        '--student', options.student,
        '--opponent', options.opponent,
        '--coach', options.coach,
        '--games', String(options.strictGames),
        '--cycles', '1',
        '--max-ply', String(options.strictMaxPly),
        '--timeout-ms', String(options.timeoutMs),
        '--coach-timeout-ms', String(options.coachTimeoutMs),
        '--out-dir', options.outDir,
        '--prefix', strictPrefix,
        '--student-mode', options.strictStudentMode,
        '--opponent-mode', 'spawn',
        '--coach-mode', 'spawn',
      ]);
      const strict = loadHarnessReport(options.outDir, strictPrefix);
      const strictWilson = wilson95(strict.score, strict.report?.summary?.games || options.strictGames);
      const strictEntry = {
        type: 'strict',
        iteration,
        prefix: strictPrefix,
        score: strict.score,
        wilson95: strictWilson,
        summary: strict.report.summary,
        report: {
          json: strict.jsonPath,
          md: strict.mdPath,
        },
        modes: strict.report?.config?.modes || null,
        generatedAt: strict.report.generatedAt,
      };
      strictRuns.push(strictEntry);

      if (!bestStrict || strictEntry.score > bestStrict.score) {
        bestStrict = strictEntry;
      }
      strictScoreText = fmt(strictEntry.score);
      strictCiText = `${fmt(strictEntry.wilson95.low)}..${fmt(strictEntry.wilson95.high)}`;
      console.log(`score=${strictScoreText} ci95=${strictCiText}`);
    }

    rows.push({
      iteration,
      quickScore: quickEntry.score,
      quickDelta,
      strictScoreText,
      strictCiText,
    });

    const progressState = {
      ...options,
      rows,
      bestQuick,
      bestStrict,
    };
    writeFileSync(progressPath, buildProgressMarkdown(progressState));
  }

  const bestStrictScore = bestStrict ? bestStrict.score : 0;
  const promotionPassed = bestStrictScore >= options.targetScore;

  const summary = {
    generatedAt: new Date().toISOString(),
    laneId: options.prefix,
    targetScore: options.targetScore,
    config: {
      student: options.student,
      opponent: options.opponent,
      coach: options.coach,
      outDir: options.outDir,
      quickGames: options.quickGames,
      strictGames: options.strictGames,
      quickMaxPly: options.quickMaxPly,
      strictMaxPly: options.strictMaxPly,
      maxIterations: options.maxIterations,
      strictEvery: options.strictEvery,
      timeoutMs: options.timeoutMs,
      coachTimeoutMs: options.coachTimeoutMs,
      strictStudentMode: options.strictStudentMode,
    },
    runs: {
      quick: quickRuns,
      strict: strictRuns,
    },
    bestQuick,
    bestStrict,
    strictWilson95: bestStrict?.wilson95 || { low: 0, high: 0 },
    promotion: {
      passed: promotionPassed,
      reason: promotionPassed
        ? `best strict score ${fmt(bestStrictScore)} >= target ${fmt(options.targetScore)}`
        : `best strict score ${fmt(bestStrictScore)} < target ${fmt(options.targetScore)}`,
    },
    files: {
      progressMd: progressPath,
      summaryJson: summaryPath,
      finalMd: finalPath,
    },
  };

  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(finalPath, buildFinalMarkdown(summary));

  console.log('Final');
  console.log(`  best quick: ${fmt(bestQuick?.score || 0)}`);
  console.log(`  best strict: ${fmt(bestStrictScore)}`);
  if (bestStrict) {
    console.log(`  strict ci95: ${fmt(bestStrict.wilson95.low)}..${fmt(bestStrict.wilson95.high)}`);
  }
  console.log(`  promotion: ${promotionPassed ? 'PASS' : 'FAIL'}`);
  console.log(`  progress: ${progressPath}`);
  console.log(`  summary: ${summaryPath}`);
  console.log(`  final: ${finalPath}`);
}

main();
