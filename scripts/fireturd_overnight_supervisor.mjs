#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = path.resolve(process.env.ROOT || DEFAULT_ROOT);
const OUT_DIR = path.join(ROOT, 'out');
const LOCK_FILE = path.join(OUT_DIR, 'fireturd_one_pass.lock');
const STATE_FILE = path.join(OUT_DIR, 'fireturd_overnight_supervisor_state.json');
const STATE_FILE_COMPAT = path.join(OUT_DIR, 'fireturd_overnight_revolver_state.json');
const LOG_FILE_PREFIX = path.join(OUT_DIR, 'fireturd_overnight_revolver');
const ONE_PASS_SCRIPT = path.join(ROOT, 'scripts', 'fireturd_one_pass.mjs');

const DEFAULT_TOMITANK = '/home/frosty/dev/repos/aj47/vibe-code-'
  + 'cup-1-simulator/submissions/real-submissions/Deeper Blue/agent.js';

const BUILD_IN_FIGHTERS = [
  'anvil',
  'rapier',
  'sentinel',
  'marauder',
  'oracle',
  'furnace',
  'avalanche',
  'overclock',
];

const GLADIATOR_PRESET_MANIFESTS = [
  path.join(OUT_DIR, 'gladiator', 'presets', 'gladiator_presets_manifest.json'),
  path.join(OUT_DIR, 'gladiator_ring', 'presets', 'gladiator_presets_manifest.json'),
];

const ENV = {
  endLocal: process.env.END_LOCAL || '09:00',
  tzLocal: process.env.TZ_LOCAL || 'America/Chicago',
  sleepBetween: readPositiveInt(process.env.SLEEP_BETWEEN || '20', 20),
  maxCycles: process.env.MAX_CYCLES ? Number.parseInt(process.env.MAX_CYCLES, 10) : 0,
  opponentPoolSearchLimit: readPositiveInt(process.env.FIRETURD_SUPERVISOR_OPPONENT_SEARCH_LIMIT || '16', 16),
  tomitank: process.env.FIRETURD_SUPERVISOR_TOMITANK || DEFAULT_TOMITANK,
  coachPath: process.env.FIRETURD_SUPERVISOR_COACH || process.env.FIRETURD_SUPERVISOR_TOMITANK || DEFAULT_TOMITANK,
};

function readPositiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function appendLogLine(file, line) {
  const payload = `${line}\n`;
  fs.appendFileSync(file, payload, 'utf8');
  process.stdout.write(`${line}\n`);
}

function loadJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function runDateWithTz(args, tz) {
  const res = spawnSync('date', args, {
    encoding: 'utf8',
    env: { ...process.env, TZ: tz },
  });

  if (res.status !== 0) return null;
  const value = Number.parseInt(String(res.stdout || '').trim(), 10);
  return Number.isFinite(value) ? value : null;
}

function computeEndEpoch() {
  const today = runDateWithTz(['-d', `today ${ENV.endLocal}`, '+%s'], ENV.tzLocal);
  if (today === null) return null;
  const now = Math.floor(Date.now() / 1000);
  if (now < today) return today;

  const tomorrow = runDateWithTz(['-d', `tomorrow ${ENV.endLocal}`, '+%s'], ENV.tzLocal);
  return tomorrow ?? today;
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

function readPidFromLock(lockPath) {
  if (!fs.existsSync(lockPath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const pid = Number(parsed.pid);
    if (!isPidRunning(pid)) {
      fs.unlinkSync(lockPath);
      return null;
    }
    return {
      pid,
      kind: 'fireturd_one_pass.lock',
      cmd: `lock:${lockPath}`,
      source: 'lock',
    };
  } catch {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const match = raw.match(/"pid"\s*:\s*(\d+)/);
    if (!match) return null;
    const pid = Number(match[1]);
    if (!isPidRunning(pid)) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // ignore
      }
      return null;
    }
    return {
      pid,
      kind: 'fireturd_one_pass.lock',
      cmd: `lock:${lockPath}`,
      source: 'lock',
    };
  }
}

function listTrackedProcesses() {
  const res = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' });
  if (res.status !== 0) return [];

  const tracked = [];
  for (const line of String(res.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match) continue;

    const pid = Number(match[1]);
    const cmd = match[2] || '';
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;

    const argv = cmd.toLowerCase();
    if (!argv.includes('node')) continue;
    if (argv.includes('fireturd_one_pass.mjs') || argv.includes('coach_harness.mjs')) {
      tracked.push({
        pid,
        kind: argv.includes('fireturd_one_pass.mjs') ? 'fireturd_one_pass' : 'coach_harness',
        cmd,
        source: 'ps',
      });
    }
  }

  return tracked;
}

function detectActiveRuns() {
  const active = [];
  const lock = readPidFromLock(LOCK_FILE);
  if (lock) active.push(lock);
  active.push(...listTrackedProcesses());

  const seen = new Map();
  for (const item of active) {
    const key = `${item.pid}:${item.kind}`;
    if (!seen.has(key)) seen.set(key, item);
  }

  return [...seen.values()];
}

function readManifestMap(manifestPath) {
  if (!fs.existsSync(manifestPath)) return {};
  const raw = loadJson(manifestPath, null);
  if (!raw || !Array.isArray(raw.presets)) return {};

  const out = {};
  for (const preset of raw.presets) {
    const name = String(preset.name || '').trim().toLowerCase();
    const slug = String(preset.slug || '').trim().toLowerCase();
    const key = slug || name;
    if (!key) continue;

    const rawPath = String(preset.enginePath || '').trim();
    if (!rawPath) continue;

    const manifestDir = path.dirname(manifestPath);
    const enginePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(manifestDir, rawPath);
    out[key] = enginePath;
  }

  return out;
}

function existsOrNull(p) {
  return p && fs.existsSync(p) ? p : null;
}

function resolveBuiltinRoster() {
  const manifestMap = {};
  for (const manifest of GLADIATOR_PRESET_MANIFESTS) {
    Object.assign(manifestMap, readManifestMap(manifest));
  }

  const roster = [];

  roster.push({
    slot: 0,
    name: 'slot0',
    label: 'base',
    source: 'engines/fireturd.cjs',
    path: path.join(ROOT, 'engines', 'fireturd.cjs'),
  });

  let nextSlot = 1;
  for (const name of BUILD_IN_FIGHTERS) {
    const slug = name.toLowerCase();
    const manifestPath = manifestMap[slug];
    const candidates = [
      manifestPath,
      path.join(OUT_DIR, 'gladiator_ring', 'presets', `fireturd_${slug}.cjs`),
      path.join(OUT_DIR, 'gladiator', 'presets', `fireturd_${slug}.cjs`),
    ];

    const resolved = candidates.map(existsOrNull).find(Boolean);
    if (!resolved) {
      roster.push({
        slot: nextSlot,
        name: slug,
        label: `missing-${slug}`,
        source: 'missing',
        path: path.join(ROOT, 'engines', 'fireturd.cjs'),
      });
      nextSlot += 1;
      continue;
    }

    roster.push({
      slot: nextSlot,
      name: slug,
      label: slug,
      source: manifestPath ? 'manifest' : 'preset',
      path: resolved,
    });
    nextSlot += 1;
  }

  return roster;
}

function resolvePathLabel(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/^fireturd_/, '').trim() || 'candidate';
}

function collectOpponentArtifacts() {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (label, filePath, source) => {
    const resolved = filePath ? path.resolve(filePath) : '';
    if (!resolved || !fs.existsSync(resolved)) return;
    if (resolved === path.resolve(ROOT, 'engines', 'fireturd.cjs')) return;
    const key = resolved.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      label: label,
      path: resolved,
      source,
    });
  };

  for (const manifest of GLADIATOR_PRESET_MANIFESTS) {
    const raw = readJsonSafe(manifest);
    const manifestDir = path.dirname(manifest);
    if (!raw || !Array.isArray(raw.presets)) continue;

    for (const preset of raw.presets) {
      const rawPath = String(preset.enginePath || '').trim();
      if (!rawPath) continue;
      const resolved = path.isAbsolute(rawPath) ? rawPath : path.resolve(manifestDir, rawPath);
      const name = String(preset.name || '').trim() || resolvePathLabel(resolved);
      addCandidate(name, resolved, path.basename(manifest));
    }
  }

  for (const presetDir of [
    path.join(OUT_DIR, 'gladiator', 'presets'),
    path.join(OUT_DIR, 'gladiator_ring', 'presets'),
  ]) {
    if (!fs.existsSync(presetDir)) continue;
    for (const entry of fs.readdirSync(presetDir)) {
      if (!entry.endsWith('.cjs')) continue;
      if (!entry.startsWith('fireturd_')) continue;
      const p = path.join(presetDir, entry);
      addCandidate(resolvePathLabel(entry.replace('.cjs', '')), p, path.basename(presetDir));
    }
  }

  addCandidate('fireturd-pass-baseline', path.join(OUT_DIR, 'fireturd-pass-baseline.cjs'), 'baseline-snapshot');

  const evolveGlob = path.join(OUT_DIR, 'evolve');
  if (fs.existsSync(evolveGlob)) {
    for (const entry of fs.readdirSync(evolveGlob)) {
      if (entry.endsWith('.cjs')) {
        addCandidate(entry.replace(/\.cjs$/i, ''), path.join(evolveGlob, entry), 'evolve-artifact');
      }
    }
  }

  return candidates
    .filter((entry) => entry.path.toLowerCase().includes('evolve') || entry.path.includes('gladiator'))
    .concat(candidates.filter((entry) => !entry.path.toLowerCase().includes('evolve') && !entry.path.includes('gladiator')))
    .slice(0, ENV.opponentPoolSearchLimit);
}

function loadState() {
  const fallback = {
    version: 1,
    startedUtc: nowIso(),
    lastSlot: -1,
    lastOpponentIndex: -1,
    cycle: 0,
    root: ROOT,
    lastStatus: 'init',
    rotation: null,
    lastRun: null,
  };

  const existing = fs.existsSync(STATE_FILE)
    ? STATE_FILE
    : (fs.existsSync(STATE_FILE_COMPAT) ? STATE_FILE_COMPAT : null);
  const state = existing ? loadJson(existing, fallback) : fallback;

  return {
    ...fallback,
    ...state,
    startedUtc: String(state.startedUtc || fallback.startedUtc),
  };
}

function writeState(state) {
  state.updatedUtc = nowIso();
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.writeFileSync(STATE_FILE_COMPAT, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function readJsonSafe(filePath) {
  return loadJson(filePath, null);
}

function parseExtraArgs() {
  const extra = [];

  const direct = process.env.FIRETURD_SUPERVISOR_ONE_PASS_ARGS;
  if (direct && String(direct).trim()) {
    const trimmed = String(direct).trim();
    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('FIRETURD_SUPERVISOR_ONE_PASS_ARGS must be a JSON array of strings');
      }
      for (const item of parsed) {
        if (typeof item !== 'string' || !item.trim()) {
          throw new Error('FIRETURD_SUPERVISOR_ONE_PASS_ARGS array must contain non-empty strings');
        }
        extra.push(item);
      }
    } else {
      const tokens = trimmed.match(/(?:"([^"]*)"|'([^']*)'|([^\s]+))/g);
      if (tokens) {
        for (const token of tokens) {
          extra.push(token.replace(/^"|"$/g, '').replace(/^'|'$/g, ''));
        }
      }
    }
  }

  const envMap = [
    ['--quick-games', 'FIRETURD_ONE_PASS_QUICK_GAMES'],
    ['--strict-games', 'FIRETURD_ONE_PASS_STRICT_GAMES'],
    ['--recheck-games', 'FIRETURD_ONE_PASS_RECHECK_GAMES'],
    ['--miss-games', 'FIRETURD_ONE_PASS_MISS_GAMES'],
    ['--max-ply-quick', 'FIRETURD_ONE_PASS_MAX_PLY_QUICK'],
    ['--max-ply-strict', 'FIRETURD_ONE_PASS_MAX_PLY_STRICT'],
    ['--max-ply-miss', 'FIRETURD_ONE_PASS_MAX_PLY_MISS'],
    ['--timeout-ms', 'FIRETURD_ONE_PASS_TIMEOUT_MS'],
    ['--coach-timeout-ms', 'FIRETURD_ONE_PASS_COACH_TIMEOUT_MS'],
  ];

  for (const [flag, envName] of envMap) {
    const value = process.env[envName];
    if (value === undefined) continue;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid integer value for ${envName}: ${value}`);
    }
    extra.push(flag, String(parsed));
  }

  return extra;
}

function buildRunArgs(student, opponent, coach, extraArgs) {
  const args = [
    ONE_PASS_SCRIPT,
    '--student', `${student.label}=${student.path}`,
    '--opponent', `${opponent.label}=${opponent.path}`,
    '--coach', `${coach.label}=${coach.path}`,
    '--out-dir', OUT_DIR,
  ];

  return args.concat(extraArgs);
}

function runOnePass(student, opponent, coach, cycle, state, cycleLogPath) {
  const args = buildRunArgs(student, opponent, coach, state.passArgs);
  const commandLabel = `node ${args.join(' ')}`;

  appendLogLine(cycleLogPath, `[one-pass] ${nowIso()} cycle=${cycle} command=${commandLabel}`);
  appendLogLine(cycleLogPath, `[one-pass] student=${student.path}`);
  appendLogLine(cycleLogPath, `[one-pass] opponent=${opponent.path}`);
  appendLogLine(cycleLogPath, `[one-pass] coach=${coach.path}`);

  const res = spawnSync('node', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

  const combined = `${res.stdout || ''}${res.stderr ? `\n${res.stderr}` : ''}`;
  fs.writeFileSync(cycleLogPath, combined, { flag: 'a' });

  const baselineSnapshot = path.join(OUT_DIR, 'fireturd-pass-baseline.cjs');
  return {
    exitCode: res.status || 0,
    stderr: res.stderr || '',
    stdout: res.stdout || '',
    baselineSnapshot,
    reportPath: path.join(OUT_DIR, 'fireturd_overnight_best_knobs.json'),
  };
}

function selectOpponents(pool, cycle, studentPath, lastOpponentIndex) {
  if (!pool.length) {
    return {
      opponent: null,
      opponentIndex: -1,
    };
  }

  const normalized = studentPath.toLowerCase();
  const count = pool.length;
  let idx = Number.isInteger(lastOpponentIndex) ? lastOpponentIndex : -1;

  for (let attempt = 0; attempt < count; attempt += 1) {
    idx = (idx + 1) % count;
    const candidate = pool[idx];
    if ((candidate.path || '').toLowerCase() !== normalized) {
      return { opponent: candidate, opponentIndex: idx };
    }
  }

  return {
    opponent: null,
    opponentIndex: -1,
  };
}

function loadConfig() {
  const passArgs = parseExtraArgs();
  return {
    passArgs,
    endEpoch: computeEndEpoch(),
    sleepBetweenSeconds: ENV.sleepBetween,
    maxCycles: ENV.maxCycles,
    roster: resolveBuiltinRoster(),
    opponentCandidates: collectOpponentArtifacts(),
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const cfg = loadConfig();
  const state = loadState();

  const started = nowIso();
  state.root = ROOT;
  state.targetEndLocal = `${ENV.endLocal} ${ENV.tzLocal}`;
  state.endEpoch = cfg.endEpoch ?? null;
  state.sleepBetweenSeconds = cfg.sleepBetweenSeconds;
  state.rotation = state.rotation || {};
  state.rotation.roster = cfg.roster;
  state.passArgs = cfg.passArgs;
  state.opponentCandidates = cfg.opponentCandidates;

  const logPath = `${LOG_FILE_PREFIX}_${nowStamp()}.log`;
  const logFile = logPath;

  appendLogLine(logFile, `[supervisor] started at ${started} root=${ROOT}`);
  appendLogLine(logFile, `[supervisor] roster slots=${cfg.roster.length}`);
  for (const slot of cfg.roster) {
    appendLogLine(logFile, `[supervisor] slot ${slot.slot}=${slot.name} path=${slot.path} source=${slot.source}`);
  }
  appendLogLine(logFile, `[supervisor] opponent-artifacts=${cfg.opponentCandidates.length}`);
  appendLogLine(logFile, `[supervisor] state=${STATE_FILE}`);

  state.lastStatus = 'running';
  writeState(state);

  while (true) {
    const cycle = (state.cycle || 0) + 1;

    if (cfg.maxCycles > 0 && state.cycle >= cfg.maxCycles) {
      appendLogLine(logFile, `[supervisor] reached maxCycles=${cfg.maxCycles}, exiting`);
      break;
    }

    if (cfg.endEpoch && Math.floor(Date.now() / 1000) >= cfg.endEpoch) {
      appendLogLine(logFile, '[supervisor] end window reached, exiting');
      break;
    }

    const active = detectActiveRuns();
    if (active.length) {
      appendLogLine(logFile, `[supervisor] waiting for active training to finish (${active.length} process(es))`);
      for (const item of active) {
        appendLogLine(logFile, `  - ${item.kind} pid=${item.pid} source=${item.source} cmd=${item.cmd}`);
      }
      state.lastStatus = 'waiting-active';
      state.waitingFor = active;
      writeState(state);
      await sleep(cfg.sleepBetweenSeconds * 1000);
      continue;
    }

    const lastSlot = Number.isInteger(state.lastSlot) ? state.lastSlot : -1;
    const nextSlot = (lastSlot + 1) % cfg.roster.length;
    const student = cfg.roster[nextSlot];

    const opponentSelection = selectOpponents(cfg.opponentCandidates, cycle, student.path, state.lastOpponentIndex);
    const opponent = opponentSelection.opponent || {
      label: 'tomitank',
      path: ENV.tomitank,
      source: 'tomitank-fallback',
    };

    const coach = {
      label: 'coach',
      path: ENV.coachPath,
      source: 'config',
    };

    const cycleLogPath = path.join(OUT_DIR, `fireturd_overnight_revolver_${String(cycle).padStart(4, '0')}_slot${student.slot}_${student.name}.log`);

    appendLogLine(logFile, `[supervisor] cycle ${cycle} slot transition ${String(lastSlot)} -> ${student.slot} (${student.name})`);
    appendLogLine(logFile, `[supervisor] cycle ${cycle} student label=${student.label} path=${student.path} source=${student.source}`);
    appendLogLine(logFile, `[supervisor] cycle ${cycle} opponent label=${opponent.label} path=${opponent.path} source=${opponent.source}`);

    state.lastStatus = 'running-pass';
    state.lastRun = {
      cycle,
      startedUtc: nowIso(),
      student,
      opponent,
      coach,
      cycleLogPath,
      slotTransitionFrom: lastSlot,
      slotTransitionTo: student.slot,
    };
    state.waitingFor = [];
    writeState(state);

    const result = runOnePass(student, opponent, coach, cycle, state, cycleLogPath);
    const finishedUtc = nowIso();

    state.lastSlot = student.slot;
    state.lastOpponentIndex = opponentSelection.opponentIndex;
    state.cycle = cycle;
    state.lastStatus = 'run-finished';
    state.lastRun.finishedUtc = finishedUtc;
    state.lastRun.exitCode = result.exitCode;
    state.lastRun.baselineSnapshot = result.baselineSnapshot;
    state.lastRun.bestKnobsJson = result.reportPath;
    state.lastRun.logPath = cycleLogPath;
    writeState(state);

    appendLogLine(logFile, `[supervisor] cycle ${cycle} run-finished rc=${result.exitCode} baseline=${result.baselineSnapshot}`);

    if (result.exitCode !== 0) {
      appendLogLine(logFile, `[supervisor] cycle ${cycle} one-pass exit nonzero: ${result.exitCode}`);
      appendLogLine(cycleLogPath, `one-pass failed rc=${result.exitCode}`);
    }

    if (cfg.sleepBetweenSeconds > 0) {
      await sleep(cfg.sleepBetweenSeconds * 1000);
    }
  }

  state.lastStatus = 'complete';
  state.completedUtc = nowIso();
  writeState(state);
  appendLogLine(logFile, `[supervisor] complete at ${state.completedUtc}`);
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message || String(err)}\n`);
  process.exitCode = 1;
});
