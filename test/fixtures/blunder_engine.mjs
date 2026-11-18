#!/usr/bin/env node
// Test fixture engine: plays one legal move from the start position, then always
// returns an illegal move. Used to force deterministic student losses.
import { readFileSync } from 'node:fs';
import { START_FEN, generateLegalMoves, parseFen } from '../../src/dojo_chess.mjs';

const fen = readFileSync(0, 'utf8').trim();
if (fen === START_FEN) {
  process.stdout.write(generateLegalMoves(parseFen(fen))[0]);
} else {
  process.stdout.write('a1a1');
}
