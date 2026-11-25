import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  START_FEN,
  applyUci,
  boardToFen,
  generateLegalMoves,
  insuffMat,
  isInCheck,
  parseFen,
} from '../src/dojo_chess.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = join(ROOT, 'coach_harness.mjs');
const FIXTURES = join(ROOT, 'test', 'fixtures');

function selfPlay(pickWhite, pickBlack, maxPly = 200) {
  let pos = parseFen(START_FEN);
  const seen = new Map();
  const moves = [];

  for (let ply = 0; ply < maxPly; ply++) {
    if (pos.halfmove >= 100) return { reason: '50move', moves };
    if (insuffMat(pos.board)) return { reason: 'insufficient_material', moves };
    const key = boardToFen({ ...pos, halfmove: 0, fullmove: 0 }).split(' ').slice(0, 4).join(' ');
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) >= 3) return { reason: 'threefold', moves };

    const legal = generateLegalMoves(pos);
    if (legal.length === 0) {
      return { reason: isInCheck(pos.board, pos.side) ? 'checkmate' : 'stalemate', moves };
    }

    const move = pos.side === 'w' ? pickWhite(legal) : pickBlack(legal);
    assert.ok(legal.includes(move), `selected move ${move} must be legal`);
    moves.push(move);
    pos = applyUci(pos, move);
  }

  return { reason: 'max_ply', moves };
}

function replay(moves) {
  let pos = parseFen(START_FEN);
  for (const move of moves) {
    const legal = generateLegalMoves(pos);
    assert.ok(legal.includes(move), `${move} must be legal from ${boardToFen(pos)}`);
    pos = applyUci(pos, move);
  }
  return pos;
}

test('headless first-legal vs last-legal self-play draws by threefold', () => {
  const game = selfPlay(
    (legal) => legal[0],
    (legal) => legal[legal.length - 1],
  );
  assert.equal(game.reason, 'threefold');
  assert.equal(game.moves.length, 20);
  replay(game.moves);
});

test('headless last-legal vs first-legal self-play draws by threefold', () => {
  const game = selfPlay(
    (legal) => legal[legal.length - 1],
    (legal) => legal[0],
  );
  assert.equal(game.reason, 'threefold');
  assert.equal(game.moves.length, 12);
  replay(game.moves);
});

test('harness self-play smoke writes a completed match report', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'cpu-coach-self-play-'));
  try {
    const res = spawnSync(process.execPath, [
      HARNESS,
      '--student', `white=${join(FIXTURES, 'first_legal_engine.mjs')}`,
      '--opponent', `black=${join(FIXTURES, 'last_legal_engine.mjs')}`,
      '--coach', `coach=${join(FIXTURES, 'first_legal_engine.mjs')}`,
      '--games', '2',
      '--cycles', '1',
      '--max-ply', '40',
      '--timeout-ms', '5000',
      '--coach-timeout-ms', '5000',
      '--student-mode', 'spawn',
      '--opponent-mode', 'spawn',
      '--coach-mode', 'spawn',
      '--prefix', 'selfplay',
      '--out-dir', outDir,
    ], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });

    assert.equal(res.status, 0, `harness exited nonzero\nstdout: ${res.stdout}\nstderr: ${res.stderr}`);
    assert.match(res.stdout, /game 1\/2 vs black \(W\)\.\.\. DRAW \(threefold, 20 ply\)/);
    assert.match(res.stdout, /game 2\/2 vs black \(B\)\.\.\. DRAW \(threefold, 12 ply\)/);

    const report = JSON.parse(readFileSync(join(outDir, 'selfplay_coach_report.json'), 'utf8'));
    assert.equal(report.summary.games, 2);
    assert.equal(report.summary.wins, 0);
    assert.equal(report.summary.draws, 2);
    assert.equal(report.summary.losses, 0);
    assert.equal(report.summary.lessonCount, 0);
    assert.equal(report.cycles.length, 1);
    assert.equal(report.cycles[0].draws, 2);

    const md = readFileSync(join(outDir, 'selfplay_coach_report.md'), 'utf8');
    assert.match(md, /Draws: 2/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
