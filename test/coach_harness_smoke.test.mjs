import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = join(ROOT, 'coach_harness.mjs');
const FIXTURES = join(ROOT, 'test', 'fixtures');

function runHarness(args, outDir) {
  return spawnSync(process.execPath, [HARNESS, ...args, '--out-dir', outDir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

test('harness runs games, reviews losses and writes both reports', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cpu-coach-harness-smoke-'));
  try {
    const res = runHarness([
      '--student', `student=${join(FIXTURES, 'blunder_engine.mjs')}`,
      '--opponent', `foe=${join(FIXTURES, 'last_legal_engine.mjs')}`,
      '--coach', `coach=${join(FIXTURES, 'last_legal_engine.mjs')}`,
      '--games', '2',
      '--cycles', '1',
      '--max-ply', '60',
      '--timeout-ms', '5000',
      '--coach-timeout-ms', '5000',
      '--student-mode', 'spawn',
      '--opponent-mode', 'spawn',
      '--coach-mode', 'spawn',
      '--prefix', 'smoke',
    ], outDir);

    assert.equal(res.status, 0, `harness exited nonzero\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);

    const report = JSON.parse(readFileSync(join(outDir, 'smoke_coach_report.json'), 'utf8'));
    assert.equal(report.summary.games, 2);
    assert.equal(report.summary.losses, 2);
    assert.ok(report.summary.reviewedPositions >= 1, 'at least one student position must be reviewed');
    assert.ok(report.summary.lessonCount >= 1, 'the coach must disagree at least once');
    assert.ok(Object.keys(report.breakdown.categories).length >= 1, 'lessons must be categorized');
    assert.equal(report.cycles.length, 1);

    const md = readFileSync(join(outDir, 'smoke_coach_report.md'), 'utf8');
    assert.ok(md.startsWith('# CPU Coach Harness Report'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('missing required flags fail with a clear error', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cpu-coach-harness-smoke-'));
  try {
    const res = runHarness(['--student', 'x=./nonexistent.js'], outDir);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Missing required flag: --opponent/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
