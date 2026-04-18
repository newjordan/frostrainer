#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

function printUsage() {
  console.log(`Lane Aggregate

Usage:
  node scripts/lane_aggregate.mjs [options]

Options:
  --glob <pattern>      Input glob. Default: ./out/*_lane_summary.json
  --out-md <path>       Output markdown path. Default: ./out/lane_aggregate.md
  --out-json <path>     Output json path. Default: ./out/lane_aggregate.json
  --help                Show this message

Example:
  node scripts/lane_aggregate.mjs \\
    --glob './out/*_lane_summary.json' \\
    --out-md ./out/lane_aggregate.md \\
    --out-json ./out/lane_aggregate.json
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    glob: './out/*_lane_summary.json',
    outMd: resolve(process.cwd(), 'out', 'lane_aggregate.md'),
    outJson: resolve(process.cwd(), 'out', 'lane_aggregate.json'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '--glob') {
      options.glob = argv[++i] || options.glob;
    } else if (arg === '--out-md') {
      options.outMd = resolve(process.cwd(), argv[++i] || '');
    } else if (arg === '--out-json') {
      options.outJson = resolve(process.cwd(), argv[++i] || '');
    } else {
      fail(`Unknown flag: ${arg}`);
    }
  }

  return options;
}

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/');
}

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegex(globPatternAbs) {
  let out = '^';
  const src = normalizePath(globPatternAbs);
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '*') {
      const next = src[i + 1];
      if (next === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(ch);
    }
  }
  out += '$';
  return new RegExp(out);
}

function findSearchRoot(globPatternAbs) {
  const src = normalizePath(globPatternAbs);
  const wildcardIndex = src.search(/[?*]/);
  if (wildcardIndex < 0) {
    return dirname(src);
  }

  const slashIndex = src.lastIndexOf('/', wildcardIndex);
  if (slashIndex < 0) return '/';
  const root = src.slice(0, slashIndex);
  return root || '/';
}

function walkFiles(rootDir) {
  const files = [];
  if (!statSafe(rootDir)?.isDirectory()) return files;

  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  return files;
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function discoverFiles(globPattern) {
  const absPattern = isAbsolute(globPattern)
    ? globPattern
    : resolve(process.cwd(), globPattern);
  const regex = globToRegex(absPattern);
  const root = findSearchRoot(absPattern);

  const matches = walkFiles(root)
    .map((file) => resolve(file))
    .filter((file) => regex.test(normalizePath(file)))
    .sort();

  return { matches, absPattern };
}

function fmt(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toFixed(digits);
}

function boolText(value) {
  return value ? 'pass' : 'fail';
}

function laneFromSummary(path, summary) {
  const laneId = String(summary?.laneId || summary?.config?.prefix || path).trim();
  const bestQuick = Number(summary?.bestQuick?.score ?? NaN);
  const bestStrict = Number(summary?.bestStrict?.score ?? NaN);
  const ci = summary?.bestStrict?.wilson95 || summary?.strictWilson95 || null;
  const pass = Boolean(summary?.promotion?.passed);

  return {
    laneId,
    source: path,
    bestQuick: Number.isFinite(bestQuick) ? bestQuick : null,
    bestStrict: Number.isFinite(bestStrict) ? bestStrict : null,
    strictCi95: ci && Number.isFinite(Number(ci.low)) && Number.isFinite(Number(ci.high))
      ? { low: Number(ci.low), high: Number(ci.high) }
      : null,
    pass,
  };
}

function buildMarkdown(rows, meta) {
  const lines = [];
  lines.push('# Lane Aggregate');
  lines.push('');
  lines.push(`Generated: ${meta.generatedAt}`);
  lines.push(`Input glob: ${meta.glob}`);
  lines.push(`Lanes: ${rows.length}`);
  lines.push('');
  lines.push('| Lane | Best Quick | Best Strict | Strict CI95 | Decision |');
  lines.push('|---|---:|---:|---|---|');

  for (const row of rows) {
    const ciText = row.strictCi95
      ? `${fmt(row.strictCi95.low)}..${fmt(row.strictCi95.high)}`
      : '-';
    lines.push(`| ${row.laneId} | ${fmt(row.bestQuick)} | ${fmt(row.bestStrict)} | ${ciText} | ${boolText(row.pass)} |`);
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const discovered = discoverFiles(options.glob);

  const rows = [];
  for (const file of discovered.matches) {
    try {
      const raw = readFileSync(file, 'utf8');
      const data = JSON.parse(raw);
      rows.push(laneFromSummary(file, data));
    } catch (error) {
      fail(`Failed to read summary file ${file}: ${error?.message || String(error)}`);
    }
  }

  const generatedAt = new Date().toISOString();
  const aggregate = {
    generatedAt,
    glob: discovered.absPattern,
    inputCount: discovered.matches.length,
    passCount: rows.filter((row) => row.pass).length,
    failCount: rows.filter((row) => !row.pass).length,
    lanes: rows,
  };

  mkdirSync(dirname(options.outMd), { recursive: true });
  mkdirSync(dirname(options.outJson), { recursive: true });
  writeFileSync(options.outMd, buildMarkdown(rows, { generatedAt, glob: discovered.absPattern }));
  writeFileSync(options.outJson, `${JSON.stringify(aggregate, null, 2)}\n`);

  console.log('Lane Aggregate');
  console.log(`  matched files: ${discovered.matches.length}`);
  console.log(`  pass/fail: ${aggregate.passCount}/${aggregate.failCount}`);
  console.log(`  markdown: ${options.outMd}`);
  console.log(`  json: ${options.outJson}`);
}

main();
