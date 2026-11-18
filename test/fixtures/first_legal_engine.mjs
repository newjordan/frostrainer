#!/usr/bin/env node
// Test fixture engine: reads one FEN from stdin, prints the first legal UCI move.
import { readFileSync } from 'node:fs';
import { generateLegalMoves, parseFen } from '../../src/dojo_chess.mjs';

const fen = readFileSync(0, 'utf8').trim();
const moves = generateLegalMoves(parseFen(fen));
process.stdout.write(moves.length ? moves[0] : '0000');
