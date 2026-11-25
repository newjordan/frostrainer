import { applyUci, parseFen, sqToIdx } from './dojo_chess.mjs';

const CENTER_SQUARES = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5', 'c6', 'd6', 'e6', 'f6']);
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function materialBalance(board) {
  let score = 0;
  for (const piece of board) {
    if (piece === '.') continue;
    const value = PIECE_VALUES[piece.toLowerCase()] || 0;
    score += piece === piece.toUpperCase() ? value : -value;
  }
  return score;
}

function scoreForSide(board, side) {
  const score = materialBalance(board);
  return side === 'w' ? score : -score;
}

function totalNonKingMaterial(board) {
  let total = 0;
  for (const piece of board) {
    if (piece === '.' || piece.toLowerCase() === 'k') continue;
    total += PIECE_VALUES[piece.toLowerCase()] || 0;
  }
  return total;
}

function classifyPhase(board) {
  const total = totalNonKingMaterial(board);
  if (total >= 5200) return 'opening';
  if (total >= 2200) return 'middlegame';
  return 'endgame';
}

function chebyshev(a, b) {
  const ar = a >> 3;
  const ac = a & 7;
  const br = b >> 3;
  const bc = b & 7;
  return Math.max(Math.abs(ar - br), Math.abs(ac - bc));
}

function describeMove(pos, uci) {
  const fromSq = uci.slice(0, 2);
  const toSq = uci.slice(2, 4);
  const from = sqToIdx(fromSq);
  const to = sqToIdx(toSq);
  const piece = pos.board[from] || '.';
  const target = pos.board[to] || '.';
  const pieceType = piece.toLowerCase();
  const ownKing = pos.board.indexOf(pos.side === 'w' ? 'K' : 'k');
  const isEnPassant = pieceType === 'p' && pos.ep === toSq;
  const rank = Number(fromSq[1]);
  const file = fromSq[0];

  return {
    uci,
    fromSq,
    toSq,
    piece,
    pieceType,
    isCapture: target !== '.' || isEnPassant,
    isPawn: pieceType === 'p',
    isCentral: CENTER_SQUARES.has(toSq),
    distanceToOwnKing: ownKing >= 0 ? chebyshev(to, ownKing) : 99,
    develops:
      (pieceType === 'n' || pieceType === 'b') && CENTER_SQUARES.has(toSq) ||
      pieceType === 'p' && CENTER_SQUARES.has(toSq),
    isEarlyHeavyPiece: (pieceType === 'q' || pieceType === 'r') && pos.fullmove <= 10,
    isFlankPawn: pieceType === 'p' && ['a', 'b', 'g', 'h'].includes(file) && (rank === 2 || rank === 7),
  };
}

function countEnemyPressureNearKing(pos) {
  const king = pos.board.indexOf(pos.side === 'w' ? 'K' : 'k');
  if (king < 0) return 0;
  let count = 0;
  for (let i = 0; i < 64; i++) {
    const piece = pos.board[i];
    if (piece === '.') continue;
    const isEnemy = pos.side === 'w' ? piece === piece.toLowerCase() : piece === piece.toUpperCase();
    if (!isEnemy || piece.toLowerCase() === 'k') continue;
    if (chebyshev(i, king) <= 2) count++;
  }
  return count;
}

function analyzeMoment(fen, studentMove, coachMove) {
  const pos = parseFen(fen);
  const phase = classifyPhase(pos.board);
  const beforeScore = scoreForSide(pos.board, pos.side);
  const studentAfter = applyUci(pos, studentMove);
  const coachAfter = applyUci(parseFen(fen), coachMove);
  const studentInfo = describeMove(pos, studentMove);
  const coachInfo = describeMove(pos, coachMove);
  const studentDeltaCp = scoreForSide(studentAfter.board, pos.side) - beforeScore;
  const coachDeltaCp = scoreForSide(coachAfter.board, pos.side) - beforeScore;
  const deltaCp = coachDeltaCp - studentDeltaCp;
  const pressure = countEnemyPressureNearKing(pos);
  const categories = [];

  if (deltaCp >= 100 || (coachInfo.isCapture && !studentInfo.isCapture)) categories.push('material');
  if (pressure >= 2 && coachInfo.distanceToOwnKing < studentInfo.distanceToOwnKing) categories.push('king_safety');
  if (phase === 'opening' && coachInfo.develops && (!studentInfo.develops || studentInfo.isEarlyHeavyPiece || studentInfo.isFlankPawn)) {
    categories.push('development');
  }
  if ((phase === 'opening' || phase === 'middlegame') && coachInfo.isPawn && coachInfo.isCentral && (!studentInfo.isPawn || !studentInfo.isCentral)) {
    categories.push('pawn_structure');
  }
  if (phase === 'endgame') categories.push('endgame');
  if (categories.length === 0) categories.push(coachInfo.isCapture ? 'tactics' : 'positional');

  return {
    phase,
    categories: [...new Set(categories)],
    studentDeltaCp,
    coachDeltaCp,
    deltaCp,
    severity: Math.max(deltaCp, 0) + (coachInfo.isCapture && !studentInfo.isCapture ? 25 : 0),
    studentMoveInfo: {
      piece: studentInfo.pieceType,
      capture: studentInfo.isCapture,
      to: studentInfo.toSq,
    },
    coachMoveInfo: {
      piece: coachInfo.pieceType,
      capture: coachInfo.isCapture,
      to: coachInfo.toSq,
    },
  };
}

function evaluatePosition(posOrFen) {
  const pos = typeof posOrFen === 'string' ? parseFen(posOrFen) : posOrFen;
  return scoreForSide(pos.board, pos.side);
}

export {
  PIECE_VALUES,
  materialBalance,
  scoreForSide,
  classifyPhase,
  analyzeMoment,
  evaluatePosition,
};
