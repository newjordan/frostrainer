#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_TOMITANK = '/home/frosty/dev/repos/aj47/vibe-code-cup-1-simulator/submissions/real-submissions/Deeper Blue/agent.js';
const FRONT_KEYS = ['time', 'pruning', 'bridge', 'ordering', 'layer'];

const defaults = {
  student: path.join(ROOT, 'engines/fireturd.cjs'),
  opponent: DEFAULT_TOMITANK,
  coach: DEFAULT_TOMITANK,
  outDir: './out',
  quickGames: 2,
  strictGames: 6,
  recheckGames: 12,
  missGames: 8,
  maxPlyQuick: 120,
  maxPlyStrict: 180,
  maxPlyMiss: 240,
};

const KNOB_ORDER = [
  'layerTemps',
  'timeBase',
  'timeVolatility',
  'timeConfidence',
  'timeEndgame',
  'timeBookDiscount',
  'timeFloor',
  'timeCap',
  'unEvalDivisor',
  'cavalryConfidenceScale',
  'cavalryEvDivisor',
  'counterScale',
  'layerVolatilityDivisor',
  'layerConfidenceDivisor',
  'aspirationBase',
  'aspirationStep',
  'razorStep',
  'futilityStep',
  'lmpDivisor',
  'lmrDivisor',
  'evalBridgePly',
  'unEvalWeight',
  'cavalryEvalWeight',
  'counterSafetyWeight',
  'counterActivityWeight',
  'layerEvalWeight',
  'evalBridgeDivisor',
  'centerHeat',
  'kingRingHeat',
  'bookHeat',
  'opportunityHeat',
  'basePieceHeat',
  'squareHeatWeight',
  'pieceHeatWeight',
  'rootStatDivisor',
  'tempMoveWeight',
  'captureWeight',
  'rootScoreDivisor',
  'rootDepthWeight',
];

const fronts = {
  time: {
    low: { timeBase: 900, timeVolatility: 6, timeConfidence: 6, timeEndgame: 90, timeBookDiscount: 180, timeFloor: 320, timeCap: 1100 },
    med: { timeBase: 1300, timeVolatility: 8, timeConfidence: 8, timeEndgame: 120, timeBookDiscount: 240, timeFloor: 480, timeCap: 1500 },
    high: { timeBase: 1800, timeVolatility: 10, timeConfidence: 10, timeEndgame: 160, timeBookDiscount: 320, timeFloor: 650, timeCap: 2100 },
    extreme: { timeBase: 2400, timeVolatility: 12, timeConfidence: 12, timeEndgame: 220, timeBookDiscount: 420, timeFloor: 850, timeCap: 2800 },
  },
  pruning: {
    aggressive: { aspirationBase: 44, aspirationStep: 8, razorStep: 22, futilityStep: 16, lmpDivisor: 6, lmrDivisor: 7 },
    neutral: { aspirationBase: 60, aspirationStep: 6, razorStep: 14, futilityStep: 10, lmpDivisor: 9, lmrDivisor: 10 },
    depruned: { aspirationBase: 78, aspirationStep: 4, razorStep: 8, futilityStep: 6, lmpDivisor: 13, lmrDivisor: 14 },
  },
  bridge: {
    off: { evalBridgePly: 0, unEvalWeight: 1, cavalryEvalWeight: 1, counterSafetyWeight: 1, counterActivityWeight: 1, layerEvalWeight: 1, evalBridgeDivisor: 20 },
    light: { evalBridgePly: 1, unEvalWeight: 1, cavalryEvalWeight: 1, counterSafetyWeight: 1, counterActivityWeight: 1, layerEvalWeight: 1, evalBridgeDivisor: 9 },
    strong: { evalBridgePly: 3, unEvalWeight: 2, cavalryEvalWeight: 2, counterSafetyWeight: 2, counterActivityWeight: 2, layerEvalWeight: 2, evalBridgeDivisor: 4 },
  },
  ordering: {
    off: { centerHeat: 2, kingRingHeat: 4, bookHeat: 3, opportunityHeat: 5, basePieceHeat: 1, squareHeatWeight: 0, pieceHeatWeight: 0, rootStatDivisor: 96, tempMoveWeight: 0, captureWeight: 0, rootScoreDivisor: 110, rootDepthWeight: 0 },
    mid: { centerHeat: 6, kingRingHeat: 10, bookHeat: 8, opportunityHeat: 12, basePieceHeat: 2, squareHeatWeight: 1, pieceHeatWeight: 1, rootStatDivisor: 64, tempMoveWeight: 1, captureWeight: 1, rootScoreDivisor: 80, rootDepthWeight: 1 },
    high: { centerHeat: 10, kingRingHeat: 16, bookHeat: 12, opportunityHeat: 20, basePieceHeat: 3, squareHeatWeight: 2, pieceHeatWeight: 2, rootStatDivisor: 40, tempMoveWeight: 2, captureWeight: 2, rootScoreDivisor: 52, rootDepthWeight: 2 },
  },
  layer: {
    flat: { layerTemps: [0, 1, 1, 2, 1], cavalryConfidenceScale: 8, cavalryEvDivisor: 76, counterScale: 5, layerVolatilityDivisor: 11, layerConfidenceDivisor: 12, unEvalDivisor: 18 },
    mid: { layerTemps: [1, 2, 3, 4, 3], cavalryConfidenceScale: 12, cavalryEvDivisor: 60, counterScale: 8, layerVolatilityDivisor: 8, layerConfidenceDivisor: 9, unEvalDivisor: 14 },
    hot: { layerTemps: [3, 4, 6, 7, 6], cavalryConfidenceScale: 18, cavalryEvDivisor: 44, counterScale: 12, layerVolatilityDivisor: 6, layerConfidenceDivisor: 6, unEvalDivisor: 10 },
  },
};

const levelOrder = {
  time: ['low', 'med', 'high', 'extreme'],
  pruning: ['aggressive', 'neutral', 'depruned'],
  bridge: ['off', 'light', 'strong'],
  ordering: ['off', 'mid', 'high'],
  layer: ['flat', 'mid', 'hot'],
};

function printHelp() {
  const lines = [
    'Usage: node scripts/fireturd_one_pass.mjs [options]',
    '',
    'Runs one Fireturd self-improvement pass (force-past-winner + miss-check + compression + recheck).',
    '',
    'Options:',
    `  --student <path|name=path>      Student engine (default: ${defaults.student})`,
    `  --opponent <path|name=path>     Opponent engine (default: ${defaults.opponent})`,
    `  --coach <path|name=path>        Coach engine (default: ${defaults.coach})`,
    `  --out-dir <dir>                 Output directory (default: ${defaults.outDir})`,
    `  --quick-games <n>               Quick games per candidate (default: ${defaults.quickGames})`,
    `  --strict-games <n>              Strict games per strict run (default: ${defaults.strictGames})`,
    `  --recheck-games <n>             Games for final recheck (default: ${defaults.recheckGames})`,
    `  --miss-games <n>                Games for miss stability check (default: ${defaults.missGames})`,
    `  --max-ply-quick <n>             Max ply for quick runs (default: ${defaults.maxPlyQuick})`,
    `  --max-ply-strict <n>            Max ply for strict/recheck runs (default: ${defaults.maxPlyStrict})`,
    `  --max-ply-miss <n>              Max ply for miss check run (default: ${defaults.maxPlyMiss})`,
    '  --help                          Show this help message',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function parsePositiveInt(name, raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${name}: ${raw}`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {
    ...defaults,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help') {
      opts.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    if (next === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (arg) {
      case '--student':
        opts.student = next;
        i += 1;
        break;
      case '--opponent':
        opts.opponent = next;
        i += 1;
        break;
      case '--coach':
        opts.coach = next;
        i += 1;
        break;
      case '--out-dir':
        opts.outDir = next;
        i += 1;
        break;
      case '--quick-games':
        opts.quickGames = parsePositiveInt(arg, next);
        i += 1;
        break;
      case '--strict-games':
        opts.strictGames = parsePositiveInt(arg, next);
        i += 1;
        break;
      case '--recheck-games':
        opts.recheckGames = parsePositiveInt(arg, next);
        i += 1;
        break;
      case '--miss-games':
        opts.missGames = parsePositiveInt(arg, next);
        i += 1;
        break;
      case '--max-ply-quick':
        opts.maxPlyQuick = parsePositiveInt(arg, next);
        i += 1;
        break;
      case '--max-ply-strict':
        opts.maxPlyStrict = parsePositiveInt(arg, next);
        i += 1;
        break;
      case '--max-ply-miss':
        opts.maxPlyMiss = parsePositiveInt(arg, next);
        i += 1;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return opts;
}

function resolvePathMaybeRelative(target) {
  if (!target) return target;
  return path.isAbsolute(target) ? target : path.resolve(ROOT, target);
}

function parseEngineArg(input, fallbackName) {
  if (!input || typeof input !== 'string') {
    throw new Error(`Missing engine value for ${fallbackName}`);
  }
  const idx = input.indexOf('=');
  if (idx >= 0) {
    const nameRaw = input.slice(0, idx).trim();
    const rawPath = input.slice(idx + 1).trim();
    if (!rawPath) throw new Error(`Invalid engine spec for ${fallbackName}: ${input}`);
    const name = nameRaw || fallbackName;
    const enginePath = resolvePathMaybeRelative(rawPath);
    return {
      name,
      path: enginePath,
      spec: `${name}=${enginePath}`,
    };
  }

  const enginePath = resolvePathMaybeRelative(input.trim());
  return {
    name: fallbackName,
    path: enginePath,
    spec: `${fallbackName}=${enginePath}`,
  };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

function isoNow() {
  return new Date().toISOString();
}

function isPidRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (isPidRunning(Number(lock.pid))) {
        throw new Error(`Another fireturd one-pass run is already active (pid=${lock.pid}).`);
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) {
        throw err;
      }
    }
    fs.unlinkSync(lockPath);
  }

  const lock = {
    pid: process.pid,
    startedAt: isoNow(),
    script: 'scripts/fireturd_one_pass.mjs',
  };
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

function releaseLock(lockPath) {
  if (!fs.existsSync(lockPath)) return;
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (Number(lock.pid) !== process.pid) return;
  } catch {
    return;
  }
  fs.unlinkSync(lockPath);
}

function readEngineText(enginePath) {
  return fs.readFileSync(enginePath, 'utf8');
}

function parseCurrentKnobs(engineText) {
  const m = engineText.match(/const RAZOR_X_5S_KNOBS = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('RAZOR_X_5S_KNOBS block not found');
  const src = `({${m[1]}\n})`;
  return Function(`"use strict"; return ${src};`)();
}

function formatKnobsObject(knobs) {
  const keys = [...KNOB_ORDER, ...Object.keys(knobs).filter((k) => !KNOB_ORDER.includes(k)).sort()];
  const lines = [];
  for (const key of keys) {
    const value = knobs[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`  ${key}: [${value.join(', ')}],`);
    } else if (value && typeof value === 'object') {
      lines.push(`  ${key}: ${JSON.stringify(value)},`);
    } else {
      lines.push(`  ${key}: ${value},`);
    }
  }
  return `const RAZOR_X_5S_KNOBS = {\n${lines.join('\n')}\n};`;
}

function writeKnobs(enginePath, knobs) {
  const src = readEngineText(enginePath);
  const replaced = src.replace(/const RAZOR_X_5S_KNOBS = \{[\s\S]*?\n\};/, formatKnobsObject(knobs));
  if (replaced === src) throw new Error('Failed to replace knob block');
  fs.writeFileSync(enginePath, replaced, 'utf8');
}

function scoreFromWdl(w, d, games) {
  return (w + 0.5 * d) / games;
}

function runHarness(tag, games, maxPly, ctx) {
  const stamp = nowStamp();
  const prefix = `overnight-${tag}-${stamp}`;
  const args = [
    './coach_harness.mjs',
    '--student', ctx.student.spec,
    '--opponent', ctx.opponent.spec,
    '--coach', ctx.coach.spec,
    '--games', String(games),
    '--cycles', '1',
    '--timeout-ms', '700',
    '--coach-timeout-ms', '300',
    '--max-ply', String(maxPly),
    '--student-mode', 'compiled',
    '--opponent-mode', 'spawn',
    '--coach-mode', 'spawn',
    '--out-dir', ctx.outDir,
    '--prefix', prefix,
  ];

  process.stdout.write(`RUN ${tag} games=${games} ply=${maxPly}\n`);
  const res = spawnSync('node', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const combined = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`;
  const logPath = path.join(ctx.outDir, `${prefix}.log`);
  fs.writeFileSync(logPath, combined, 'utf8');

  if (res.status !== 0) {
    throw new Error(`Harness failed for ${tag} (exit=${res.status})\n${combined.slice(-2000)}`);
  }

  const reportPath = path.join(ctx.outDir, `${prefix}_coach_report.json`);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const w = Number(report.summary.wins || 0);
  const d = Number(report.summary.draws || 0);
  const l = Number(report.summary.losses || 0);
  const score = scoreFromWdl(w, d, games);
  const invalid = /invalid_move/.test(combined);

  process.stdout.write(`DONE ${tag} WDL=${w}/${d}/${l} score=${score.toFixed(3)} invalid=${invalid ? 'yes' : 'no'}\n`);

  return {
    tag,
    games,
    maxPly,
    prefix,
    w,
    d,
    l,
    score,
    invalid,
    logPath,
    reportPath,
  };
}

function strictMean(cand) {
  if (!cand.strictRuns.length) return -1;
  return cand.strictRuns.reduce((a, r) => a + r.score, 0) / cand.strictRuns.length;
}

function strictInvalid(cand) {
  return cand.strictRuns.some((r) => r.invalid);
}

function shift(front, current, delta) {
  const arr = levelOrder[front];
  const i = arr.indexOf(current);
  const j = Math.max(0, Math.min(arr.length - 1, i + delta));
  return arr[j];
}

function buildKnobs(base, spec) {
  return {
    ...base,
    ...fronts.time[spec.time],
    ...fronts.pruning[spec.pruning],
    ...fronts.bridge[spec.bridge],
    ...fronts.ordering[spec.ordering],
    ...fronts.layer[spec.layer],
  };
}

function gainLossByFront(cands) {
  const data = {};
  for (const front of FRONT_KEYS) {
    const buckets = new Map();
    for (const c of cands) {
      if (!c.strictRuns.length) continue;
      const lv = c[front];
      if (!buckets.has(lv)) buckets.set(lv, []);
      buckets.get(lv).push(strictMean(c));
    }
    const stats = [...buckets.entries()]
      .map(([level, vals]) => ({ level, n: vals.length, mean: vals.reduce((a, b) => a + b, 0) / vals.length }))
      .sort((a, b) => b.mean - a.mean);
    data[front] = stats;
  }
  return data;
}

function topByStrict(cands, n) {
  return [...cands]
    .filter((c) => c.strictRuns.length)
    .sort((a, b) => strictMean(b) - strictMean(a))
    .slice(0, n);
}

function chooseEliteAnchor(stableCands) {
  const elite = { time: 'med', pruning: 'neutral', bridge: 'light', ordering: 'mid', layer: 'mid' };
  for (const front of FRONT_KEYS) {
    const m = new Map();
    for (const c of stableCands) {
      const s = strictMean(c);
      m.set(c[front], (m.get(c[front]) || 0) + s);
    }
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length) elite[front] = ranked[0][0];
  }
  return elite;
}

function writePassReport(passTs, payload, paths) {
  const {
    baseline,
    radical,
    strictQualified,
    banditTop3,
    miss,
    missDrop,
    missUnstable,
    elite,
    compressed,
    top2,
    promoted,
    promotedCandidate,
    bestStrict,
    bestRecheck,
    gainLoss,
  } = payload;

  if (!fs.existsSync(paths.passMd)) {
    fs.writeFileSync(paths.passMd, '# Fireturd Overnight Pressure Passes\n', 'utf8');
  }

  const lines = [];
  lines.push(`\n## Pass ${passTs} (Fireturd vs Tomitank)`);
  lines.push(`Generated: ${isoNow()}`);
  lines.push('');
  lines.push('### Baseline strict');
  lines.push(`- Prefix: ${baseline.prefix}`);
  lines.push(`- W/D/L: ${baseline.w}/${baseline.d}/${baseline.l}`);
  lines.push(`- Score: ${baseline.score.toFixed(3)}`);
  lines.push(`- Invalid move: ${baseline.invalid ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('### Force-Past-Winner exploration (12 candidates)');
  lines.push('| ID | Pair | Time | Pruning | Bridge | Ordering | Layer | Quick | Strict Mean | Strict Runs | Strict Invalid |');
  lines.push('|---|---|---|---|---|---|---|---:|---:|---:|---|');
  for (const c of radical) {
    lines.push(`| ${c.id} | ${c.pair ? `${c.pair}${c.dir}` : '-'} | ${c.time} | ${c.pruning} | ${c.bridge} | ${c.ordering} | ${c.layer} | ${c.quick ? c.quick.score.toFixed(3) : 'n/a'} | ${strictMean(c) >= 0 ? strictMean(c).toFixed(3) : 'n/a'} | ${c.strictRuns.length} | ${strictInvalid(c) ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push('### Bandit reallocation (extra strict on top 3)');
  lines.push(`- Strict-qualified candidates: ${strictQualified.length}`);
  for (const c of banditTop3) {
    lines.push(`- ${c.id}: strict mean=${strictMean(c).toFixed(3)} over ${c.strictRuns.length} strict runs`);
  }
  lines.push('');
  lines.push('### Catch-the-miss stability check');
  lines.push(`- Candidate: ${miss.id}`);
  lines.push(`- Strict score: ${miss.strictScore.toFixed(3)}`);
  lines.push(`- Miss score (${miss.missRun.games}g/${miss.missRun.maxPly}): ${miss.missRun.score.toFixed(3)}`);
  lines.push(`- Drop: ${missDrop.toFixed(3)}`);
  lines.push(`- Invalid move: ${miss.missRun.invalid ? 'yes' : 'no'}`);
  lines.push(`- Unstable: ${missUnstable ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('### CEM-style elite compression (6 strict candidates)');
  lines.push(`- Elite anchor fronts: time=${elite.time}, pruning=${elite.pruning}, bridge=${elite.bridge}, ordering=${elite.ordering}, layer=${elite.layer}`);
  lines.push('| ID | Label | Strict | Invalid |');
  lines.push('|---|---|---:|---|');
  for (const c of compressed) {
    lines.push(`| ${c.id} | ${c.label} | ${strictMean(c).toFixed(3)} | ${strictInvalid(c) ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push('### Recheck promotion gate');
  for (const c of top2) {
    lines.push(`- ${c.id}: strict=${strictMean(c).toFixed(3)}, recheck=${c.recheck.score.toFixed(3)}, invalid=${c.recheck.invalid ? 'yes' : 'no'}`);
  }
  lines.push(`- Promoted: ${promoted ? 'yes' : 'no'}`);
  lines.push(`- Promoted candidate: ${promotedCandidate ? promotedCandidate.id : 'none (baseline restored)'}`);
  lines.push('');
  lines.push('### Front-level gains/losses');
  for (const front of FRONT_KEYS) {
    const arr = gainLoss[front] || [];
    if (!arr.length) {
      lines.push(`- ${front}: insufficient strict data`);
      continue;
    }
    const gain = arr[0];
    const loss = arr[arr.length - 1];
    lines.push(`- ${front}: gain=${gain.level} (${gain.mean.toFixed(3)}, n=${gain.n}) | loss=${loss.level} (${loss.mean.toFixed(3)}, n=${loss.n})`);
  }
  lines.push('');
  lines.push('### Key scores');
  lines.push(`- baselineStrict=${baseline.score.toFixed(3)}`);
  lines.push(`- bestStrict=${bestStrict.toFixed(3)}`);
  lines.push(`- bestRecheck=${bestRecheck >= 0 ? bestRecheck.toFixed(3) : 'n/a'}`);

  fs.appendFileSync(paths.passMd, `${lines.join('\n')}\n`, 'utf8');
}

function validatePaths(ctx) {
  if (!fs.existsSync(ctx.student.path)) {
    throw new Error(`Student engine not found: ${ctx.student.path}`);
  }
  if (!fs.existsSync(ctx.opponent.path)) {
    throw new Error(`Opponent engine not found: ${ctx.opponent.path}`);
  }
  if (!fs.existsSync(ctx.coach.path)) {
    throw new Error(`Coach engine not found: ${ctx.coach.path}`);
  }
  const harnessPath = path.join(ROOT, 'coach_harness.mjs');
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`Harness not found: ${harnessPath}`);
  }
}

function runOnePass(opts) {
  const outDir = resolvePathMaybeRelative(opts.outDir);
  const passMd = path.join(outDir, 'fireturd_overnight_passes.md');
  const bestJson = path.join(outDir, 'fireturd_overnight_best_knobs.json');
  const snapshotPath = path.join(outDir, 'fireturd-pass-baseline.cjs');
  const lockPath = path.join(outDir, 'fireturd_one_pass.lock');

  const ctx = {
    outDir,
    student: parseEngineArg(opts.student, 'fireturd'),
    opponent: parseEngineArg(opts.opponent, 'tomitank'),
    coach: parseEngineArg(opts.coach, 'tomitank'),
  };

  validatePaths(ctx);
  fs.mkdirSync(outDir, { recursive: true });
  acquireLock(lockPath);

  let snapshotReady = false;

  try {
    const engineBefore = readEngineText(ctx.student.path);
    const baselineKnobs = parseCurrentKnobs(engineBefore);
    fs.copyFileSync(ctx.student.path, snapshotPath);
    snapshotReady = true;

    const passTs = nowStamp();
    const baseline = runHarness('baseline-strict', opts.strictGames, opts.maxPlyStrict, ctx);

    const radical = [
      { id: 'a1p', pair: 'a1', dir: '+', time: 'high', pruning: 'aggressive', bridge: 'strong', ordering: 'high', layer: 'hot' },
      { id: 'a1m', pair: 'a1', dir: '-', time: 'low', pruning: 'depruned', bridge: 'off', ordering: 'off', layer: 'flat' },
      { id: 'a2p', pair: 'a2', dir: '+', time: 'extreme', pruning: 'neutral', bridge: 'strong', ordering: 'high', layer: 'hot' },
      { id: 'a2m', pair: 'a2', dir: '-', time: 'low', pruning: 'neutral', bridge: 'off', ordering: 'off', layer: 'flat' },
      { id: 'a3p', pair: 'a3', dir: '+', time: 'high', pruning: 'depruned', bridge: 'light', ordering: 'high', layer: 'hot' },
      { id: 'a3m', pair: 'a3', dir: '-', time: 'med', pruning: 'aggressive', bridge: 'light', ordering: 'off', layer: 'flat' },
      { id: 'a4p', pair: 'a4', dir: '+', time: 'extreme', pruning: 'aggressive', bridge: 'light', ordering: 'high', layer: 'mid' },
      { id: 'a4m', pair: 'a4', dir: '-', time: 'med', pruning: 'depruned', bridge: 'strong', ordering: 'off', layer: 'hot' },
      { id: 'b1', time: 'med', pruning: 'neutral', bridge: 'strong', ordering: 'mid', layer: 'hot' },
      { id: 'b2', time: 'high', pruning: 'neutral', bridge: 'off', ordering: 'high', layer: 'mid' },
      { id: 'b3', time: 'med', pruning: 'depruned', bridge: 'light', ordering: 'mid', layer: 'flat' },
      { id: 'b4', time: 'low', pruning: 'aggressive', bridge: 'strong', ordering: 'mid', layer: 'mid' },
    ].map((c) => ({ ...c, knobs: null, quick: null, strictRuns: [], missRun: null, recheck: null }));

    for (const c of radical) {
      c.knobs = buildKnobs(baselineKnobs, c);
      writeKnobs(ctx.student.path, c.knobs);
      c.quick = runHarness(`rad-${c.id}-quick`, opts.quickGames, opts.maxPlyQuick, ctx);
      if (c.quick.score >= 0.25) {
        c.strictRuns.push(runHarness(`rad-${c.id}-strict`, opts.strictGames, opts.maxPlyStrict, ctx));
      }
    }

    const strictQualified = topByStrict(radical, radical.length);
    const banditTop3 = strictQualified.slice(0, 3);
    for (const c of banditTop3) {
      writeKnobs(ctx.student.path, c.knobs);
      c.strictRuns.push(runHarness(`bandit-${c.id}-strict`, opts.strictGames, opts.maxPlyStrict, ctx));
    }

    const strictAfterBandit = topByStrict(radical, radical.length);
    if (!strictAfterBandit.length) {
      throw new Error('No candidate passed quick gate into strict; cannot continue protocol.');
    }

    const bestStrictCand = strictAfterBandit[0];
    const bestStrictScorePreMiss = strictMean(bestStrictCand);
    writeKnobs(ctx.student.path, bestStrictCand.knobs);
    const missRun = runHarness(`miss-${bestStrictCand.id}`, opts.missGames, opts.maxPlyMiss, ctx);
    bestStrictCand.missRun = missRun;
    const missDrop = bestStrictScorePreMiss - missRun.score;
    const missUnstable = missDrop >= 0.12 || missRun.invalid;

    const stableRadical = strictAfterBandit
      .filter((c) => !strictInvalid(c))
      .filter((c) => !(c.id === bestStrictCand.id && missUnstable));

    const eliteSeed = (stableRadical.length ? stableRadical : strictAfterBandit).slice(0, 4);
    const elite = chooseEliteAnchor(eliteSeed);

    const compressed = [
      {
        id: 'c1',
        label: 'forward pressure medium-radius',
        time: shift('time', elite.time, 1),
        pruning: shift('pruning', elite.pruning, -1),
        bridge: shift('bridge', elite.bridge, 1),
        ordering: shift('ordering', elite.ordering, 1),
        layer: shift('layer', elite.layer, 1),
      },
      {
        id: 'c2',
        label: 'calm de-pruned rollback band',
        time: shift('time', elite.time, -1),
        pruning: shift('pruning', elite.pruning, 1),
        bridge: shift('bridge', elite.bridge, -1),
        ordering: shift('ordering', elite.ordering, -1),
        layer: shift('layer', elite.layer, -1),
      },
      {
        id: 'c3',
        label: 'time-jump with bridge damp',
        time: shift('time', elite.time, 2),
        pruning: shift('pruning', elite.pruning, 1),
        bridge: shift('bridge', elite.bridge, -1),
        ordering: shift('ordering', elite.ordering, 1),
        layer: shift('layer', elite.layer, 0),
      },
      {
        id: 'c4',
        label: 'time-cut tactical compaction',
        time: shift('time', elite.time, -2),
        pruning: shift('pruning', elite.pruning, -1),
        bridge: shift('bridge', elite.bridge, 1),
        ordering: shift('ordering', elite.ordering, 1),
        layer: shift('layer', elite.layer, -1),
      },
      {
        id: 'c5',
        label: 'ordering-focused hybrid band',
        time: shift('time', elite.time, 1),
        pruning: shift('pruning', elite.pruning, 0),
        bridge: shift('bridge', elite.bridge, 1),
        ordering: shift('ordering', elite.ordering, 1),
        layer: shift('layer', elite.layer, -1),
      },
      {
        id: 'c6',
        label: 'counter-hot mixed compression',
        time: shift('time', elite.time, -1),
        pruning: shift('pruning', elite.pruning, -1),
        bridge: shift('bridge', elite.bridge, -1),
        ordering: shift('ordering', elite.ordering, -1),
        layer: shift('layer', elite.layer, 1),
      },
    ].map((c) => ({ ...c, knobs: null, strictRuns: [], recheck: null }));

    for (const c of compressed) {
      c.knobs = buildKnobs(baselineKnobs, c);
      writeKnobs(ctx.student.path, c.knobs);
      c.strictRuns.push(runHarness(`cmp-${c.id}-strict`, opts.strictGames, opts.maxPlyStrict, ctx));
    }

    const allStrictCands = [...radical, ...compressed].filter((c) => c.strictRuns.length);
    const stablePool = allStrictCands
      .filter((c) => !strictInvalid(c))
      .filter((c) => !(c.id === bestStrictCand.id && missUnstable))
      .sort((a, b) => strictMean(b) - strictMean(a));

    const top2 = stablePool.slice(0, 2);
    if (top2.length < 2) {
      const fallback = allStrictCands
        .filter((c) => !top2.find((x) => x.id === c.id))
        .sort((a, b) => strictMean(b) - strictMean(a));
      while (top2.length < 2 && fallback.length) top2.push(fallback.shift());
    }

    for (const c of top2) {
      writeKnobs(ctx.student.path, c.knobs);
      c.recheck = runHarness(`final-${c.id}-recheck`, opts.recheckGames, opts.maxPlyStrict, ctx);
    }

    const validRechecks = top2
      .filter((c) => c.recheck && !c.recheck.invalid)
      .sort((a, b) => b.recheck.score - a.recheck.score);

    const promotedCandidate = validRechecks[0] || null;
    const bestRecheck = promotedCandidate ? promotedCandidate.recheck.score : -1;
    const bestStrict = Math.max(...allStrictCands.map((c) => strictMean(c)));

    const promoted = Boolean(
      promotedCandidate &&
      promotedCandidate.recheck &&
      !promotedCandidate.recheck.invalid &&
      promotedCandidate.recheck.score > baseline.score
    );

    if (promoted) {
      writeKnobs(ctx.student.path, promotedCandidate.knobs);
    } else {
      fs.copyFileSync(snapshotPath, ctx.student.path);
    }

    const finalKnobs = parseCurrentKnobs(readEngineText(ctx.student.path));
    const gainLoss = gainLossByFront([...radical, ...compressed]);

    writePassReport(passTs, {
      baseline,
      radical,
      strictQualified,
      banditTop3,
      miss: { id: bestStrictCand.id, strictScore: bestStrictScorePreMiss, missRun },
      missDrop,
      missUnstable,
      elite,
      compressed,
      top2,
      promoted,
      promotedCandidate,
      bestStrict,
      bestRecheck,
      gainLoss,
    }, {
      passMd,
    });

    const bestPayload = {
      updatedAt: isoNow(),
      baselineStrictScore: baseline.score,
      bestStrictScore: bestStrict,
      bestRecheckScore: bestRecheck,
      promoted,
      promotedCandidate: promotedCandidate ? promotedCandidate.id : null,
      fronts: promoted && promotedCandidate ? {
        time: promotedCandidate.time,
        pruning: promotedCandidate.pruning,
        bridge: promotedCandidate.bridge,
        ordering: promotedCandidate.ordering,
        layer: promotedCandidate.layer,
      } : null,
      knobs: promoted && promotedCandidate ? promotedCandidate.knobs : finalKnobs,
    };
    fs.writeFileSync(bestJson, `${JSON.stringify(bestPayload, null, 2)}\n`, 'utf8');

    process.stdout.write(`PASS_DONE baseline=${baseline.score.toFixed(3)} bestStrict=${bestStrict.toFixed(3)} recheck=${bestRecheck >= 0 ? bestRecheck.toFixed(3) : 'n/a'} promoted=${promoted ? 'yes' : 'no'}\n`);
  } catch (err) {
    if (snapshotReady) {
      try {
        fs.copyFileSync(snapshotPath, ctx.student.path);
      } catch {
        // Best effort restore on failure.
      }
    }
    throw err;
  } finally {
    releaseLock(lockPath);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  runOnePass(opts);
}

try {
  main();
} catch (err) {
  process.stderr.write(`[fireturd_one_pass] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
