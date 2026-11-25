import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  START_FEN,
  applyUci,
  generateLegalMoves,
  parseFen,
  sqToIdx,
} from '../src/dojo_chess.mjs';
import {
  analyzeMoment,
  classifyPhase,
  evaluatePosition,
  materialBalance,
} from '../src/dojo_eval.mjs';

// Piece values used by the coach: pawn 100, knight 320, bishop 330, rook 500, queen 900.
// Expected totals below are counted from the FEN, not from the evaluator.
const PERFT_POSITIONS = [
  {
    name: 'startpos',
    fen: START_FEN,
    white: 4000,
    black: 4000,
    phase: 'opening',
  },
  {
    name: 'kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    white: 4000,
    black: 4000,
    phase: 'opening',
  },
  {
    name: 'ep-pin',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    white: 800,
    black: 800,
    phase: 'endgame',
  },
  {
    name: 'promotions',
    // White: 8P 2N 2B 2R Q = 4000. Black: 7P 2N 2B 2R Q = 3900.
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    white: 4000,
    black: 3900,
    phase: 'opening',
  },
  {
    name: 'castling-checks',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    white: 3800,
    black: 3800,
    phase: 'opening',
  },
  {
    name: 'middlegame',
    fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    white: 4000,
    black: 4000,
    phase: 'opening',
  },
];

const CAPTURE_VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900 };

function moverMaterialGain(pos, uci) {
  const from = sqToIdx(uci.slice(0, 2));
  const to = sqToIdx(uci.slice(2, 4));
  const promo = uci[4] || '';
  const piece = pos.board[from];
  const target = pos.board[to];
  let gain = 0;
  if (target !== '.') gain += CAPTURE_VALUE[target.toLowerCase()];
  if (piece.toLowerCase() === 'p' && pos.ep !== '-' && uci.slice(2, 4) === pos.ep) {
    gain += CAPTURE_VALUE.p;
  }
  if (promo) gain += CAPTURE_VALUE[promo] - CAPTURE_VALUE.p;
  return gain;
}

test('perft positions have the counted material evaluation', () => {
  for (const position of PERFT_POSITIONS) {
    const pos = parseFen(position.fen);
    const balance = position.white - position.black;
    assert.equal(materialBalance(pos.board), balance, position.name);
    assert.equal(evaluatePosition(position.fen), pos.side === 'w' ? balance : -balance, position.name);
    assert.equal(classifyPhase(pos.board), position.phase, position.name);

    const parts = position.fen.split(' ');
    parts[1] = pos.side === 'w' ? 'b' : 'w';
    const flipped = parts.join(' ');
    assert.equal(evaluatePosition(flipped), -evaluatePosition(position.fen), `${position.name} side flip`);
  }
});

test('legal moves from perft positions change material only by captures and promotions', () => {
  const extra = [
    '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
    '8/P6k/8/8/8/8/8/K7 w - - 0 1',
  ];
  const fens = [...PERFT_POSITIONS.map((position) => position.fen), ...extra];

  for (const fen of fens) {
    const pos = parseFen(fen);
    const before = materialBalance(pos.board);
    for (const uci of generateLegalMoves(pos)) {
      const sign = pos.side === 'w' ? 1 : -1;
      const after = materialBalance(applyUci(pos, uci).board);
      assert.equal(
        after - before,
        sign * moverMaterialGain(pos, uci),
        `${fen} ${uci}`,
      );
    }
  }
});

test('hanging queen is scored as a 900 centipawn material miss', () => {
  const fen = '4k3/8/8/8/3q4/2P5/8/4K3 w - - 0 1';
  const moment = analyzeMoment(fen, 'c3c4', 'c3d4');
  assert.equal(moment.deltaCp, 900);
  assert.equal(moment.studentDeltaCp, 0);
  assert.equal(moment.coachDeltaCp, 900);
  assert.equal(moment.phase, 'endgame');
  assert.ok(moment.categories.includes('material'));
  assert.ok(moment.categories.includes('endgame'));
  assert.equal(moment.coachMoveInfo.capture, true);
  assert.equal(moment.studentMoveInfo.capture, false);
});

test('underpromotion is scored against a queen promotion', () => {
  const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
  const moment = analyzeMoment(fen, 'a7a8n', 'a7a8q');
  assert.equal(moment.studentDeltaCp, 220);
  assert.equal(moment.coachDeltaCp, 800);
  assert.equal(moment.deltaCp, 580);
  assert.ok(moment.categories.includes('material'));
});

test('undeveloped flank pawn is tagged as a development miss', () => {
  const moment = analyzeMoment(START_FEN, 'a2a3', 'g1f3');
  assert.equal(moment.deltaCp, 0);
  assert.equal(moment.phase, 'opening');
  assert.deepEqual(moment.categories, ['development']);
});
