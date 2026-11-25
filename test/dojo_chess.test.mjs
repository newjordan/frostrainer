import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  START_FEN,
  applyUci,
  boardToFen,
  generateLegalMoves,
  insuffMat,
  isInCheck,
  parseFen,
  sqToIdx,
} from '../src/dojo_chess.mjs';

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = generateLegalMoves(pos);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) {
    nodes += perft(applyUci(pos, move), depth - 1);
  }
  return nodes;
}

test('perft matches reference node counts', () => {
  const cases = [
    ['startpos', START_FEN, { 1: 20, 2: 400, 3: 8902, 4: 197281 }],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', { 1: 48, 2: 2039, 3: 97862 }],
    ['ep-pin', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', { 1: 14, 2: 191, 3: 2812, 4: 43238 }],
    ['promotions', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', { 1: 6, 2: 264, 3: 9467 }],
    ['castling-checks', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', { 1: 44, 2: 1486, 3: 62379 }],
    ['middlegame', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', { 1: 46, 2: 2079, 3: 89890 }],
  ];

  for (const [name, fen, table] of cases) {
    for (const [depth, expected] of Object.entries(table)) {
      assert.equal(perft(parseFen(fen), Number(depth)), expected, `${name} depth ${depth}`);
    }
  }
});

test('starting position generates the standard move list', () => {
  const moves = generateLegalMoves(parseFen(START_FEN)).slice().sort();
  assert.deepEqual(moves, [
    'a2a3', 'a2a4', 'b1a3', 'b1c3', 'b2b3', 'b2b4', 'c2c3', 'c2c4',
    'd2d3', 'd2d4', 'e2e3', 'e2e4', 'f2f3', 'f2f4', 'g1f3', 'g1h3',
    'g2g3', 'g2g4', 'h2h3', 'h2h4',
  ]);
});

test('FEN round trip preserves position', () => {
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
  assert.equal(boardToFen(parseFen(fen)), fen);
});

test('castling move updates king, rook and rights', () => {
  const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const next = applyUci(pos, 'e1g1');
  assert.equal(next.board[sqToIdx('g1')], 'K');
  assert.equal(next.board[sqToIdx('f1')], 'R');
  assert.equal(next.board[sqToIdx('e1')], '.');
  assert.equal(next.castling, 'kq');
});

test('rook move drops only its own castling right', () => {
  const pos = parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(applyUci(pos, 'h1h2').castling, 'Qkq');
  assert.equal(applyUci(pos, 'a1a2').castling, 'Kkq');
});

test('castling is not generated through attacked squares', () => {
  const pos = parseFen('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1');
  const moves = generateLegalMoves(pos);
  assert.ok(moves.includes('e1c1'), 'queenside castling must be legal');
  assert.ok(!moves.includes('e1g1'), 'kingside castling must be blocked (f1 attacked)');
});

test('en passant capture removes the passed pawn', () => {
  const pos = parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  const moves = generateLegalMoves(pos);
  assert.ok(moves.includes('e5d6'), 'en passant capture must be generated');
  const next = applyUci(pos, 'e5d6');
  assert.equal(next.board[sqToIdx('d6')], 'P');
  assert.equal(next.board[sqToIdx('d5')], '.');
  assert.equal(next.ep, '-');
});

test('promotion generates all four piece choices', () => {
  const moves = generateLegalMoves(parseFen('8/P6k/8/8/8/8/8/K7 w - - 0 1'));
  assert.ok(moves.includes('a7a8q'));
  assert.ok(moves.includes('a7a8r'));
  assert.ok(moves.includes('a7a8b'));
  assert.ok(moves.includes('a7a8n'));
});

test('checkmate position has no legal moves and is in check', () => {
  const pos = parseFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
  assert.ok(isInCheck(pos.board, 'w'));
  assert.equal(generateLegalMoves(pos).length, 0);
});

test('stalemate position has no legal moves and is not in check', () => {
  const pos = parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.ok(!isInCheck(pos.board, 'b'));
  assert.equal(generateLegalMoves(pos).length, 0);
});

test('insufficient material detection', () => {
  assert.ok(insuffMat(parseFen('8/8/4k3/8/8/3K4/8/8 w - - 0 1').board));
  assert.ok(insuffMat(parseFen('8/8/4k3/8/8/3KN3/8/8 w - - 0 1').board));
  assert.ok(!insuffMat(parseFen('8/8/4k3/8/8/3KQ3/8/8 w - - 0 1').board));
});
