#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

const DEFAULT_OUT_DIR = path.join(ROOT, 'out', 'gladiator_ring');
const DEFAULT_RUNS_DIR = path.join(DEFAULT_OUT_DIR, 'runs');
const DEFAULT_MANIFEST = path.join(DEFAULT_OUT_DIR, 'presets', 'gladiator_presets_manifest.json');
const DEFAULT_LEADERBOARD_JSON = path.join(DEFAULT_OUT_DIR, 'leaderboard.json');
const DEFAULT_LEADERBOARD_MD = path.join(DEFAULT_OUT_DIR, 'leaderboard.md');
const DEFAULT_COACH = path.join(ROOT, 'engines', 'fireturd.cjs');
const DEFAULT_FIRETURD_LOCK = path.join(ROOT, 'out', 'fireturd_one_pass.lock');

const DEFAULTS = {
  manifest: DEFAULT_MANIFEST,
  outDir: DEFAULT_OUT_DIR,
  runsDir: DEFAULT_RUNS_DIR,
  leaderboardJson: DEFAULT_LEADERBOARD_JSON,
  leaderboardMd: DEFAULT_LEADERBOARD_MD,
  games: 4,
  maxPly: 140,
  timeoutMs: 700,
  coachTimeoutMs: 500,
  studentMode: 'auto',
  opponentMode: 'auto',
  coachMode: 'auto',
  prefix: 'gladiator',
  waitPollMs: 15000,
  waitTimeoutSec: 0,
  fireturdLock: DEFAULT_FIRETURD_LOCK,
  fighters: '',
  maxFighters: 0,
  coach: `coach=${DEFAULT_COACH}`,
  smoke: false,
};

function printHelp() {
  const lines = [
    'Gladiator Ring Round-Robin Runner',
    '',
    'Usage:',
    '  node scripts/gladiator_round_robin.mjs [options]',
    '',
    'Options:',
    `  --manifest <path>            Preset manifest path. Default: ${DEFAULTS.manifest}`,
    `  --out-dir <path>             Base output directory. Default: ${DEFAULTS.outDir}`,
    `  --runs-dir <path>            Per-match harness outputs. Default: ${DEFAULTS.runsDir}`,
    `  --leaderboard-json <path>    Leaderboard JSON path. Default: ${DEFAULTS.leaderboardJson}`,
    `  --leaderboard-md <path>      Leaderboard Markdown path. Default: ${DEFAULTS.leaderboardMd}`,
    `  --games <n>                  Games per matchup. Default: ${DEFAULTS.games}`,
    `  --max-ply <n>                Max ply per game. Default: ${DEFAULTS.maxPly}`,
    `  --timeout-ms <n>             Student/opponent move timeout. Default: ${DEFAULTS.timeoutMs}`,
    `  --coach-timeout-ms <n>       Coach move timeout. Default: ${DEFAULTS.coachTimeoutMs}`,
    `  --student-mode <mode>        student mode: auto|spawn|compiled. Default: ${DEFAULTS.studentMode}`,
    `  --opponent-mode <mode>       opponent mode: auto|spawn|compiled. Default: ${DEFAULTS.opponentMode}`,
    `  --coach-mode <mode>          coach mode: auto|spawn|compiled. Default: ${DEFAULTS.coachMode}`,
    `  --coach <spec>               Coach engine spec (name=path or path). Default: ${DEFAULTS.coach}`,
    '  --fighters <csv>             Subset by preset name/slug (example: anvil,rapier,oracle).',
    '  --max-fighters <n>           Limit fighter count after filtering. Default: all',
    `  --prefix <name>              Match prefix base. Default: ${DEFAULTS.prefix}`,
    `  --wait-poll-ms <n>           Poll interval while waiting for active runs. Default: ${DEFAULTS.waitPollMs}`,
    `  --wait-timeout-sec <n>       0 = wait forever; otherwise fail after timeout. Default: ${DEFAULTS.waitTimeoutSec}`,
    `  --fireturd-lock <path>       fireturd lock file path. Default: ${DEFAULTS.fireturdLock}`,
    '  --smoke                      Fast smoke mode (games=1, max-fighters=4, max-ply=80).',
    '  --help                       Show this help.',
    '',
    'Examples:',
    '  # Smoke',
    '  node scripts/gladiator_round_robin.mjs --smoke',
    '',
    '  # Full ring (all fighters)',
    '  node scripts/gladiator_round_robin.mjs --games 4 --max-ply 140',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function asPositiveInt(flag, raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid value for ${flag}: ${raw}`);
  }
  return value;
}

function asNonNegativeInt(flag, raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid value for ${flag}: ${raw}`);
  }
  return value;
}

function parseMode(flag, raw) {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'auto' || mode === 'spawn' || mode === 'compiled') return mode;
  throw new Error(`Invalid value for ${flag}: ${raw}. Expected auto|spawn|compiled`);
}

function resolveMaybeRelative(target) {
  if (!target) return target;
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function splitCsv(raw) {
  return String(raw || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || 'fighter')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fighter';
}

function parseEngineSpec(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty coach spec');
  const idx = text.indexOf('=');
  if (idx > 0) {
    const label = text.slice(0, idx).trim() || 'coach';
    const filePath = resolveMaybeRelative(text.slice(idx + 1).trim());
    return {
      label,
      filePath,
      spec: `${label}=${filePath}`,
    };
  }
  const filePath = resolveMaybeRelative(text);
  const label = slugify(path.basename(filePath, path.extname(filePath)) || 'coach');
  return {
    label,
    filePath,
    spec: `${label}=${filePath}`,
  };
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  let runsDirExplicit = false;
  let leaderboardJsonExplicit = false;
  let leaderboardMdExplicit = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--smoke') {
      opts.smoke = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const next = argv[i + 1];
    if (next === undefined) throw new Error(`Missing value for ${arg}`);

    switch (arg) {
      case '--manifest':
        opts.manifest = next;
        break;
      case '--out-dir':
        opts.outDir = next;
        if (!runsDirExplicit) opts.runsDir = path.join(next, 'runs');
        if (!leaderboardJsonExplicit) opts.leaderboardJson = path.join(next, 'leaderboard.json');
        if (!leaderboardMdExplicit) opts.leaderboardMd = path.join(next, 'leaderboard.md');
        break;
      case '--runs-dir':
        opts.runsDir = next;
        runsDirExplicit = true;
        break;
      case '--leaderboard-json':
        opts.leaderboardJson = next;
        leaderboardJsonExplicit = true;
        break;
      case '--leaderboard-md':
        opts.leaderboardMd = next;
        leaderboardMdExplicit = true;
        break;
      case '--games':
        opts.games = asPositiveInt(arg, next);
        break;
      case '--max-ply':
        opts.maxPly = asPositiveInt(arg, next);
        break;
      case '--timeout-ms':
        opts.timeoutMs = asPositiveInt(arg, next);
        break;
      case '--coach-timeout-ms':
        opts.coachTimeoutMs = asPositiveInt(arg, next);
        break;
      case '--student-mode':
        opts.studentMode = parseMode(arg, next);
        break;
      case '--opponent-mode':
        opts.opponentMode = parseMode(arg, next);
        break;
      case '--coach-mode':
        opts.coachMode = parseMode(arg, next);
        break;
      case '--coach':
        opts.coach = next;
        break;
      case '--fighters':
        opts.fighters = next;
        break;
      case '--max-fighters':
        opts.maxFighters = asPositiveInt(arg, next);
        break;
      case '--prefix':
        opts.prefix = next;
        break;
      case '--wait-poll-ms':
        opts.waitPollMs = asPositiveInt(arg, next);
        break;
      case '--wait-timeout-sec':
        opts.waitTimeoutSec = asNonNegativeInt(arg, next);
        break;
      case '--fireturd-lock':
        opts.fireturdLock = next;
        break;
      default:
        throw new Error(`Unknown flag: ${arg}`);
    }
    i += 1;
  }

  if (opts.smoke) {
    if (!argv.includes('--games')) opts.games = 1;
    if (!argv.includes('--max-fighters')) opts.maxFighters = 4;
    if (!argv.includes('--max-ply')) opts.maxPly = 80;
    if (!argv.includes('--timeout-ms')) opts.timeoutMs = 500;
    if (!argv.includes('--coach-timeout-ms')) opts.coachTimeoutMs = 300;
    if (!argv.includes('--prefix')) opts.prefix = 'gladiator-smoke';
  }

  opts.manifest = resolveMaybeRelative(opts.manifest);
  opts.outDir = resolveMaybeRelative(opts.outDir);
  opts.runsDir = resolveMaybeRelative(opts.runsDir);
  opts.leaderboardJson = resolveMaybeRelative(opts.leaderboardJson);
  opts.leaderboardMd = resolveMaybeRelative(opts.leaderboardMd);
  opts.fireturdLock = resolveMaybeRelative(opts.fireturdLock);

  return opts;
}

function readJson(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function loadManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Preset manifest not found: ${manifestPath}`);
  }

  const raw = readJson(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const presets = Array.isArray(raw.presets) ? raw.presets : [];
  if (!presets.length) {
    throw new Error(`Manifest has no presets: ${manifestPath}`);
  }

  return presets.map((preset, index) => {
    const name = String(preset.name || '').trim() || `fighter-${index + 1}`;
    const slug = slugify(preset.slug || name);
    const rawEnginePath = String(preset.enginePath || '').trim();
    if (!rawEnginePath) {
      throw new Error(`Preset ${name} missing enginePath in manifest`);
    }
    const enginePath = path.isAbsolute(rawEnginePath)
      ? rawEnginePath
      : path.resolve(manifestDir, rawEnginePath);
    if (!fs.existsSync(enginePath)) {
      throw new Error(`Preset engine not found for ${name}: ${enginePath}`);
    }
    return {
      name,
      slug,
      style: String(preset.style || '').trim(),
      enginePath,
      profile: preset.profile || {},
    };
  });
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function selectFighters(allPresets, fighterFilter, maxFighters) {
  let selected = allPresets;

  const requested = splitCsv(fighterFilter);
  if (requested.length) {
    const byNameOrSlug = new Map();
    for (const preset of allPresets) {
      byNameOrSlug.set(normalizeKey(preset.slug), preset);
      byNameOrSlug.set(normalizeKey(preset.name), preset);
    }

    const picked = [];
    const seen = new Set();
    for (const token of requested) {
      const preset = byNameOrSlug.get(normalizeKey(token));
      if (!preset) {
        const available = allPresets.map((item) => item.slug).join(', ');
        throw new Error(`Unknown fighter "${token}". Available: ${available}`);
      }
      if (!seen.has(preset.slug)) {
        seen.add(preset.slug);
        picked.push(preset);
      }
    }
    selected = picked;
  }

  if (maxFighters > 0) {
    selected = selected.slice(0, maxFighters);
  }

  if (selected.length < 2) {
    throw new Error(`Need at least 2 fighters for round robin, got ${selected.length}`);
  }

  return selected;
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

function readLockPid(lockPath) {
  if (!fs.existsSync(lockPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const pid = Number(parsed.pid);
    if (isPidRunning(pid)) {
      return {
        pid,
        kind: 'fireturd_one_pass.lock',
        cmd: `lock:${lockPath}`,
      };
    }
    fs.unlinkSync(lockPath);
    return null;
  } catch {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const pidMatch = raw.match(/"pid"\s*:\s*(\d+)/);
    if (!pidMatch) return null;
    const pid = Number(pidMatch[1]);
    if (!isPidRunning(pid)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // best effort cleanup for stale lock
      }
      return null;
    }
    return {
      pid,
      kind: 'fireturd_one_pass.lock',
      cmd: `lock:${lockPath}`,
    };
  }
}

function listTrackedProcesses() {
  const res = spawnSync('ps', ['-eo', 'pid=,args='], {
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`Failed to inspect active processes: ${res.stderr || res.stdout || 'ps failed'}`);
  }

  const rows = String(res.stdout || '').split('\n');
  const active = [];

  for (const row of rows) {
    const line = row.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(.+)$/);
    if (!m) continue;

    const pid = Number(m[1]);
    const cmd = m[2];
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;

    const parts = cmd.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const execName = path.basename(parts[0]).toLowerCase();
    if (execName !== 'node' && execName !== 'nodejs') continue;

    const argvText = parts.slice(1).join(' ');
    if (argvText.includes('fireturd_one_pass.mjs')) {
      active.push({ pid, kind: 'fireturd_one_pass', cmd });
      continue;
    }
    if (argvText.includes('coach_harness.mjs')) {
      active.push({ pid, kind: 'coach_harness', cmd });
    }
  }

  return active;
}

function detectActiveRuns(opts) {
  const active = [];
  const lock = readLockPid(opts.fireturdLock);
  if (lock) active.push(lock);
  active.push(...listTrackedProcesses());

  const dedup = new Map();
  for (const item of active) {
    const key = `${item.kind}:${item.pid}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  return [...dedup.values()];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForIdle(opts, stage) {
  const started = Date.now();
  let lastSig = '';

  while (true) {
    const active = detectActiveRuns(opts);
    if (active.length === 0) return;

    const sig = active
      .map((item) => `${item.kind}:${item.pid}`)
      .sort()
      .join(',');

    if (sig !== lastSig) {
      process.stdout.write(`[wait] ${stage}: active coach_harness/fireturd run detected, waiting...\n`);
      for (const item of active) {
        process.stdout.write(`  - ${item.kind} pid=${item.pid}\n`);
      }
      lastSig = sig;
    }

    if (opts.waitTimeoutSec > 0 && Date.now() - started >= opts.waitTimeoutSec * 1000) {
      throw new Error(`Timed out waiting for active runs to finish after ${opts.waitTimeoutSec}s`);
    }

    await sleep(opts.waitPollMs);
  }
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function asScore(wins, draws, games) {
  return (wins + 0.5 * draws) / games;
}

function runMatch(opts, coach, matchup, matchIndex, totalMatches) {
  const matchId = String(matchIndex + 1).padStart(3, '0');
  const prefix = `${opts.prefix}-${matchId}-${matchup.a.slug}-vs-${matchup.b.slug}`;

  const args = [
    'coach_harness.mjs',
    '--student', `${matchup.a.slug}=${matchup.a.enginePath}`,
    '--opponent', `${matchup.b.slug}=${matchup.b.enginePath}`,
    '--coach', coach.spec,
    '--games', String(opts.games),
    '--cycles', '1',
    '--timeout-ms', String(opts.timeoutMs),
    '--coach-timeout-ms', String(opts.coachTimeoutMs),
    '--max-ply', String(opts.maxPly),
    '--student-mode', opts.studentMode,
    '--opponent-mode', opts.opponentMode,
    '--coach-mode', opts.coachMode,
    '--out-dir', opts.runsDir,
    '--prefix', prefix,
  ];

  process.stdout.write(`RUN ${matchId}/${String(totalMatches).padStart(3, '0')} ${matchup.a.slug} vs ${matchup.b.slug} (games=${opts.games})\n`);

  const res = spawnSync('node', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });

  const combined = `${res.stdout || ''}${res.stderr ? `\n[stderr]\n${res.stderr}` : ''}`;
  const logPath = path.join(opts.runsDir, `${prefix}.log`);
  fs.writeFileSync(logPath, combined, 'utf8');

  if (res.status !== 0) {
    throw new Error(`coach_harness failed for ${prefix} (exit=${res.status})\n${combined.slice(-2000)}`);
  }

  const reportJson = path.join(opts.runsDir, `${prefix}_coach_report.json`);
  const reportMd = path.join(opts.runsDir, `${prefix}_coach_report.md`);
  if (!fs.existsSync(reportJson)) {
    throw new Error(`Expected report not found: ${reportJson}`);
  }

  const report = readJson(reportJson);
  const wins = Number(report.summary?.wins || 0);
  const draws = Number(report.summary?.draws || 0);
  const losses = Number(report.summary?.losses || 0);
  const score = asScore(wins, draws, opts.games);

  process.stdout.write(`DONE ${matchId}/${String(totalMatches).padStart(3, '0')} ${matchup.a.slug} vs ${matchup.b.slug} -> ${wins}/${draws}/${losses} score=${score.toFixed(3)}\n`);

  return {
    id: prefix,
    matchId,
    student: matchup.a.slug,
    opponent: matchup.b.slug,
    studentWins: wins,
    draws,
    studentLosses: losses,
    studentScore: score,
    reportJson,
    reportMd,
    logPath,
  };
}

function buildMarkdown(payload) {
  const lines = [];
  lines.push('# Gladiator Ring Leaderboard');
  lines.push('');
  lines.push(`- Generated: ${payload.generatedAt}`);
  lines.push(`- Manifest: ${payload.config.manifest}`);
  lines.push(`- Fighters: ${payload.config.fighterCount}`);
  lines.push(`- Matchups: ${payload.config.matchCount}`);
  lines.push(`- Games per matchup: ${payload.config.gamesPerMatch}`);
  lines.push(`- Coach: ${payload.config.coach}`);
  lines.push('');
  lines.push('## Standings');
  lines.push('');
  lines.push('| Rank | Fighter | Score | W | D | L | Points | Games |');
  lines.push('|---:|---|---:|---:|---:|---:|---:|---:|');
  for (const row of payload.leaderboard) {
    lines.push(`| ${row.rank} | ${row.name} (${row.slug}) | ${row.score.toFixed(3)} | ${row.wins} | ${row.draws} | ${row.losses} | ${row.points.toFixed(1)} | ${row.games} |`);
  }
  lines.push('');
  lines.push('## Match Results');
  lines.push('');
  lines.push('| Match | Student vs Opponent | Student W/D/L | Student Score | Report JSON |');
  lines.push('|---|---|---:|---:|---|');
  for (const match of payload.matches) {
    lines.push(`| ${match.matchId} | ${match.student} vs ${match.opponent} | ${match.studentWins}/${match.draws}/${match.studentLosses} | ${match.studentScore.toFixed(3)} | ${match.reportJson} |`);
  }
  lines.push('');
  lines.push('## Notes');
  lines.push('');
  lines.push('- Score = (wins + 0.5 * draws) / games.');
  lines.push('- Each unordered pair is run once with the first fighter as student; opponent totals are mirrored from the same result.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const coach = parseEngineSpec(opts.coach);
  if (!fs.existsSync(coach.filePath)) {
    throw new Error(`Coach engine not found: ${coach.filePath}`);
  }

  const presets = loadManifest(opts.manifest);
  const fighters = selectFighters(presets, opts.fighters, opts.maxFighters);

  fs.mkdirSync(opts.outDir, { recursive: true });
  fs.mkdirSync(opts.runsDir, { recursive: true });
  fs.mkdirSync(path.dirname(opts.leaderboardJson), { recursive: true });
  fs.mkdirSync(path.dirname(opts.leaderboardMd), { recursive: true });

  const matchups = [];
  for (let i = 0; i < fighters.length; i += 1) {
    for (let j = i + 1; j < fighters.length; j += 1) {
      matchups.push({ a: fighters[i], b: fighters[j] });
    }
  }

  process.stdout.write(`Gladiator ring start: fighters=${fighters.length} matches=${matchups.length} gamesPerMatch=${opts.games}\n`);
  process.stdout.write(`Coach spec: ${coach.spec}\n`);

  const standings = new Map();
  for (const fighter of fighters) {
    standings.set(fighter.slug, {
      name: fighter.name,
      slug: fighter.slug,
      enginePath: fighter.enginePath,
      matches: 0,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
    });
  }

  const matches = [];
  for (let i = 0; i < matchups.length; i += 1) {
    const matchup = matchups[i];
    await waitForIdle(opts, `before ${matchup.a.slug} vs ${matchup.b.slug}`);

    const result = runMatch(opts, coach, matchup, i, matchups.length);
    matches.push(result);

    const a = standings.get(matchup.a.slug);
    const b = standings.get(matchup.b.slug);
    if (!a || !b) {
      throw new Error(`Internal standings error for matchup ${matchup.a.slug} vs ${matchup.b.slug}`);
    }

    a.matches += 1;
    a.games += opts.games;
    a.wins += result.studentWins;
    a.draws += result.draws;
    a.losses += result.studentLosses;
    a.points += result.studentWins + 0.5 * result.draws;

    b.matches += 1;
    b.games += opts.games;
    b.wins += result.studentLosses;
    b.draws += result.draws;
    b.losses += result.studentWins;
    b.points += result.studentLosses + 0.5 * result.draws;
  }

  const leaderboard = [...standings.values()]
    .map((row) => ({
      ...row,
      score: row.games ? row.points / row.games : 0,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));

  const payload = {
    generatedAt: new Date().toISOString(),
    script: 'scripts/gladiator_round_robin.mjs',
    config: {
      manifest: opts.manifest,
      outDir: opts.outDir,
      runsDir: opts.runsDir,
      coach: coach.spec,
      fighterCount: fighters.length,
      matchCount: matchups.length,
      gamesPerMatch: opts.games,
      maxPly: opts.maxPly,
      timeoutMs: opts.timeoutMs,
      coachTimeoutMs: opts.coachTimeoutMs,
      modes: {
        student: opts.studentMode,
        opponent: opts.opponentMode,
        coach: opts.coachMode,
      },
      wait: {
        pollMs: opts.waitPollMs,
        timeoutSec: opts.waitTimeoutSec,
        fireturdLock: opts.fireturdLock,
      },
      smoke: opts.smoke,
    },
    leaderboard,
    matches,
  };

  fs.writeFileSync(opts.leaderboardJson, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(opts.leaderboardMd, buildMarkdown(payload), 'utf8');

  process.stdout.write('Gladiator ring complete\n');
  process.stdout.write(`  leaderboard json: ${opts.leaderboardJson}\n`);
  process.stdout.write(`  leaderboard md:   ${opts.leaderboardMd}\n`);
  process.stdout.write(`  runs dir:         ${opts.runsDir}\n`);
  process.stdout.write(`  winner:           ${leaderboard[0]?.name || 'n/a'}\n`);
}

main().catch((error) => {
  process.stderr.write(`ERROR: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
