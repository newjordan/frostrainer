#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_BASE_ENGINE = path.join(ROOT, 'engines', 'fireturd.cjs');
const DEFAULT_OUT_DIR = path.join(ROOT, 'out', 'gladiator', 'presets');
const DEFAULT_MANIFEST = path.join(DEFAULT_OUT_DIR, 'gladiator_presets_manifest.json');

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

const FRONTS = {
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

const PRESETS = [
  {
    name: 'anvil',
    style: 'calm, low-temperature grinder with minimal bridge and ordering bias',
    profile: { time: 'low', pruning: 'depruned', bridge: 'off', ordering: 'off', layer: 'flat' },
  },
  {
    name: 'rapier',
    style: 'aggressive quick-cutter with lighter bridge support and balanced ordering',
    profile: { time: 'med', pruning: 'aggressive', bridge: 'light', ordering: 'mid', layer: 'mid' },
  },
  {
    name: 'sentinel',
    style: 'calm defensive hold with light bridge use and restrained ordering',
    profile: { time: 'med', pruning: 'depruned', bridge: 'light', ordering: 'off', layer: 'mid' },
  },
  {
    name: 'marauder',
    style: 'ordering-heavy raider that leans fast and tactical',
    profile: { time: 'high', pruning: 'aggressive', bridge: 'off', ordering: 'high', layer: 'mid' },
  },
  {
    name: 'oracle',
    style: 'bridge-heavy evaluator with measured pruning and stable tempo',
    profile: { time: 'med', pruning: 'neutral', bridge: 'strong', ordering: 'mid', layer: 'mid' },
  },
  {
    name: 'furnace',
    style: 'hot aggressive attacker with strong bridge and ordering pressure',
    profile: { time: 'high', pruning: 'aggressive', bridge: 'strong', ordering: 'high', layer: 'hot' },
  },
  {
    name: 'avalanche',
    style: 'high-time pressure engine that piles on bridge strength and hot layers',
    profile: { time: 'extreme', pruning: 'neutral', bridge: 'strong', ordering: 'mid', layer: 'hot' },
  },
  {
    name: 'overclock',
    style: 'maxed-out time-pressure berserker with aggressive pruning and heavy ordering',
    profile: { time: 'extreme', pruning: 'aggressive', bridge: 'strong', ordering: 'high', layer: 'hot' },
  },
];

const MIN_PRESET_COUNT = 8;

function printHelp() {
  const presetNames = PRESETS.map((preset) => preset.name).join(', ');
  const lines = [
    'Gladiator Preset Generator',
    '',
    'Usage:',
    '  node scripts/gladiator_generate_presets.mjs [options]',
    '',
    'Options:',
    `  --base-engine <path>   Base engine path. Default: ${DEFAULT_BASE_ENGINE}`,
    `  --out-dir <path>       Output dir for generated fighter engines. Default: ${DEFAULT_OUT_DIR}`,
    `  --manifest <path>      Manifest JSON path. Default: ${DEFAULT_MANIFEST}`,
    '  --force                Overwrite existing generated preset files.',
    '  --help                 Show this message.',
    '',
    'Notes:',
    `  - Generates ${PRESETS.length} Fireturd fighter presets (minimum required: ${MIN_PRESET_COUNT}).`,
    `  - Presets: ${presetNames}`,
    '  - Does not modify engines/fireturd.cjs.',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

function parseArgs(argv) {
  const opts = {
    baseEngine: DEFAULT_BASE_ENGINE,
    outDir: DEFAULT_OUT_DIR,
    manifest: DEFAULT_MANIFEST,
    force: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--force') {
      opts.force = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const next = argv[i + 1];
    if (next === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }
    if (arg === '--base-engine') {
      opts.baseEngine = next;
    } else if (arg === '--out-dir') {
      opts.outDir = next;
    } else if (arg === '--manifest') {
      opts.manifest = next;
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
    i += 1;
  }

  return opts;
}

function resolveMaybeRelative(target) {
  if (!target) return target;
  return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

function slugify(value) {
  return String(value || 'preset')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'preset';
}

function parseCurrentKnobs(engineText) {
  const m = engineText.match(/const RAZOR_X_5S_KNOBS = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error('RAZOR_X_5S_KNOBS block not found in base engine');
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
      continue;
    }
    if (value && typeof value === 'object') {
      lines.push(`  ${key}: ${JSON.stringify(value)},`);
      continue;
    }
    lines.push(`  ${key}: ${value},`);
  }
  return `const RAZOR_X_5S_KNOBS = {\n${lines.join('\n')}\n};`;
}

function replaceKnobs(engineText, knobs) {
  const pattern = /const RAZOR_X_5S_KNOBS = \{[\s\S]*?\n\};/;
  if (!pattern.test(engineText)) {
    throw new Error('Failed to replace knob block while generating preset');
  }
  const replaced = engineText.replace(pattern, formatKnobsObject(knobs));
  return replaced;
}

function buildPresetKnobs(baseKnobs, preset) {
  const merged = {
    ...baseKnobs,
  };

  for (const [frontName, levelName] of Object.entries(preset.profile || {})) {
    const front = FRONTS[frontName];
    if (!front) throw new Error(`Unknown front "${frontName}" in preset "${preset.name}"`);
    const level = front[levelName];
    if (!level) throw new Error(`Unknown level "${levelName}" for front "${frontName}" in preset "${preset.name}"`);
    Object.assign(merged, level);
  }
  if (preset.overrides && typeof preset.overrides === 'object') {
    Object.assign(merged, preset.overrides);
  }
  return merged;
}

function main() {
  if (PRESETS.length < MIN_PRESET_COUNT) {
    throw new Error(`Expected at least ${MIN_PRESET_COUNT} presets, found ${PRESETS.length}`);
  }

  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  const baseEnginePath = resolveMaybeRelative(opts.baseEngine);
  const outDir = resolveMaybeRelative(opts.outDir);
  const manifestPath = resolveMaybeRelative(opts.manifest);

  if (!fs.existsSync(baseEnginePath)) {
    throw new Error(`Base engine not found: ${baseEnginePath}`);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });

  const baseSource = fs.readFileSync(baseEnginePath, 'utf8');
  const baseKnobs = parseCurrentKnobs(baseSource);
  const generated = [];

  for (const preset of PRESETS) {
    const slug = slugify(preset.name);
    const fighterPath = path.join(outDir, `fireturd_${slug}.cjs`);
    const descriptorPath = path.join(outDir, `fireturd_${slug}.json`);

    if (!opts.force && (fs.existsSync(fighterPath) || fs.existsSync(descriptorPath))) {
      throw new Error(
        `Preset output exists for "${preset.name}". Re-run with --force to overwrite: ${fighterPath}`,
      );
    }

    const knobs = buildPresetKnobs(baseKnobs, preset);
    const fighterSource = replaceKnobs(baseSource, knobs);

    fs.writeFileSync(fighterPath, fighterSource, 'utf8');
    const descriptor = {
      name: preset.name,
      slug,
      style: preset.style || '',
      baseEnginePath,
      enginePath: fighterPath,
      profile: preset.profile,
      overrides: preset.overrides || {},
      knobs,
    };
    fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
    generated.push({
      name: preset.name,
      slug,
      style: preset.style || '',
      enginePath: fighterPath,
      descriptorPath,
      profile: preset.profile,
    });
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    script: 'scripts/gladiator_generate_presets.mjs',
    presetCount: generated.length,
    baseEnginePath,
    outDir,
    presets: generated,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  process.stdout.write('Gladiator presets generated\n');
  process.stdout.write(`  count: ${generated.length}\n`);
  process.stdout.write(`  out dir: ${outDir}\n`);
  process.stdout.write(`  manifest: ${manifestPath}\n`);
  for (const preset of generated) {
    process.stdout.write(`  - ${preset.name}: ${preset.enginePath}\n`);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
}
