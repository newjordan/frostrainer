#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  START_FEN,
  applyUci,
  boardToFen,
  generateLegalMoves,
  insuffMat,
  isInCheck,
  parseFen,
  sqToIdx,
} from './src/dojo_chess.mjs';
import { compileAgent, getMoveFromFn, resetAgentCache } from './src/dojo_runtime.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_COACH = resolve(__dirname, '..', 'trainers', 'lozza', 'agent.js');
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const CENTER_SQUARES = new Set(['c3', 'd3', 'e3', 'f3', 'c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5', 'c6', 'd6', 'e6', 'f6']);
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

function printUsage() {
  const defaultCoach = existsSync(DEFAULT_COACH) ? ` Defaults to ${DEFAULT_COACH}.` : '';
  console.log(`CPU Coach Harness

Usage:
  node cpu_coach_harness/coach_harness.mjs --student <engine> --opponent <engine> [--opponent <engine> ...] [options]

Required:
  --student <engine>           Student engine path or command name.
  --opponent <engine>          Opponent engine path or command name. Repeat or use --opponents.

Optional:
  --coach <engine>             Coach engine path or command name.${defaultCoach}
  --opponents a,b,c            Comma-separated opponent list.
  --games <n>                  Games per cycle. Default: 6
  --cycles <n>                 Coaching cycles. Default: 1
  --timeout-ms <ms>            Student/opponent move timeout. Default: 2000
  --coach-timeout-ms <ms>      Coach move timeout. Default: 2000
  --max-ply <n>                Max plies per game. Default: 200
  --start-fen <fen>            Starting position. Default: standard start
  --out-dir <dir>              Output directory. Default: cpu_coach_harness/out
  --prefix <name>              Output file prefix. Default: student label
  --help                       Show this message

Named engines:
  label=path/to/engine.js      Override the engine label shown in reports.

Examples:
  node cpu_coach_harness/coach_harness.mjs \\
    --student student=variants/razor_x.js \\
    --opponent titan=trainers/titan/agent.js \\
    --opponent colossus=trainers/colossus/agent.js \\
    --coach lozza=trainers/lozza/agent.js \\
    --games 4 --cycles 2
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function asPositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) fail(`Invalid value for ${flag}: ${value}`);
  return parsed;
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || 'coach')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'coach';
}

function parseNamedInput(input) {
  const text = String(input || '').trim();
  const idx = text.indexOf('=');
  if (idx <= 0) return { label: '', raw: text };
  return {
    label: text.slice(0, idx).trim(),
    raw: text.slice(idx + 1).trim(),
  };
}

function resolveEngineSpec(input, baseDir) {
  const { label, raw: rawInput } = parseNamedInput(input);
  let raw = rawInput;
  if (!raw) fail(`Invalid engine spec: ${input}`);
  if (raw === 'lozza' && existsSync(DEFAULT_COACH)) raw = DEFAULT_COACH;

  const looksLikePath = raw.includes('/') || raw.startsWith('.') || raw.startsWith('~') || raw.includes('\\') || extname(raw) !== '';
  const resolvedCandidate = resolve(baseDir, raw);

  if (existsSync(resolvedCandidate) || looksLikePath) {
    const filePath = existsSync(resolvedCandidate) ? resolvedCandidate : resolve(raw);
    if (!existsSync(filePath)) fail(`Engine file not found: ${raw}`);
    return {
      input,
      label: label || basename(filePath).replace(/\.[^.]+$/, ''),
      kind: 'file',
      filePath,
      cwd: dirname(filePath),
    };
  }

  return {
    input,
    label: label || raw,
    kind: 'command',
    command: raw,
    cwd: baseDir,
  };
}

function parseArgs(argv) {
  const options = {
    student: '',
    coach: existsSync(DEFAULT_COACH) ? DEFAULT_COACH : '',
    opponents: [],
    games: 6,
    cycles: 1,
    timeoutMs: 2000,
    coachTimeoutMs: 2000,
    maxPly: 200,
    startFen: START_FEN,
    outDir: resolve(process.cwd(), 'cpu_coach_harness', 'out'),
    prefix: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '--student') {
      options.student = argv[++i] || '';
    } else if (arg === '--coach') {
      options.coach = argv[++i] || '';
    } else if (arg === '--opponent') {
      options.opponents.push(argv[++i] || '');
    } else if (arg === '--opponents') {
      options.opponents.push(...splitList(argv[++i] || ''));
    } else if (arg === '--games') {
      options.games = asPositiveInt(argv[++i], '--games');
    } else if (arg === '--cycles') {
      options.cycles = asPositiveInt(argv[++i], '--cycles');
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = asPositiveInt(argv[++i], '--timeout-ms');
    } else if (arg === '--coach-timeout-ms') {
      options.coachTimeoutMs = asPositiveInt(argv[++i], '--coach-timeout-ms');
    } else if (arg === '--max-ply') {
      options.maxPly = asPositiveInt(argv[++i], '--max-ply');
    } else if (arg === '--start-fen') {
      options.startFen = argv[++i] || START_FEN;
    } else if (arg === '--out-dir') {
      options.outDir = resolve(process.cwd(), argv[++i] || '');
    } else if (arg === '--prefix') {
      options.prefix = argv[++i] || '';
    } else {
      fail(`Unknown flag: ${arg}`);
    }
  }

  if (!options.student) fail('Missing required flag: --student');
  if (options.opponents.length === 0) fail('Missing required flag: --opponent');
  if (!options.coach) fail('Missing coach engine. Pass --coach <engine>.');

  const baseDir = process.cwd();
  const student = resolveEngineSpec(options.student, baseDir);
  const coach = resolveEngineSpec(options.coach, baseDir);
  const opponents = options.opponents.map((item) => resolveEngineSpec(item, baseDir));

  return {
    ...options,
    student,
    coach,
    opponents,
    prefix: slugify(options.prefix || student.label),
  };
}

function buildSpawnInvocation(spec) {
  if (spec.kind === 'command') {
    return { cmd: spec.command, args: [] };
  }
  const ext = extname(spec.filePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return { cmd: process.execPath, args: [spec.filePath] };
  }
  return { cmd: spec.filePath, args: [] };
}

function extractMove(raw) {
  const text = String(raw || '').trim();
  const matches = text.match(/[a-h][1-8][a-h][1-8][qrbn]?/g);
  if (matches && matches.length > 0) return matches[matches.length - 1];
  return text.split(/\s+/).filter(Boolean).pop() || '__FAIL__';
}

function runSpawnEngine(spec, fen, timeoutMs) {
  const { cmd, args } = buildSpawnInvocation(spec);
  const start = performance.now();
  try {
    const raw = execFileSync(cmd, args, {
      cwd: spec.cwd,
      input: `${fen}\n`,
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const end = performance.now();
    return {
      move: extractMove(raw),
      metrics: { totalMs: end - start },
      raw: String(raw || '').trim(),
    };
  } catch (error) {
    const end = performance.now();
    return {
      move: '__FAIL__',
      metrics: { totalMs: end - start },
      raw: `${String(error.stdout || '').trim()} ${String(error.stderr || '').trim()}`.trim(),
      error: error.message,
    };
  }
}

function shouldAttemptCompile(spec) {
  if (spec.kind !== 'file' || !/\.(?:js|mjs|cjs)$/i.test(spec.filePath)) return false;
  try {
    const source = readFileSync(spec.filePath, 'utf8');
    return !source.includes('import.meta');
  } catch {
    return false;
  }
}

function canUseProbeMove(move, fen) {
  if (!UCI_RE.test(move)) return false;
  const legalMoves = generateLegalMoves(parseFen(fen));
  return legalMoves.includes(move);
}

function loadEngine(spec, timeoutMs, preferCompile = true, probeFen = START_FEN) {
  if (preferCompile && shouldAttemptCompile(spec)) {
    resetAgentCache(spec.filePath);
    const fn = compileAgent(spec.filePath, { forceReload: true });
    if (fn) {
      const probe = getMoveFromFn(fn, probeFen);
      if (canUseProbeMove(probe.move, probeFen)) {
        return {
          ...spec,
          mode: 'compiled',
          getMove(fen) {
            return getMoveFromFn(fn, fen);
          },
        };
      }
    }
  }

  return {
    ...spec,
    mode: 'spawn',
    getMove(fen) {
      return runSpawnEngine(spec, fen, timeoutMs);
    },
  };
}

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

function buildRepetitionKey(pos) {
  return boardToFen({ ...pos, halfmove: 0, fullmove: 0 }).split(' ').slice(0, 4).join(' ');
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

function playGame(student, opponent, studentAsWhite, options, cycle, index) {
  let pos = parseFen(options.startFen);
  const history = [];
  const seen = new Map();

  for (let ply = 0; ply < options.maxPly; ply++) {
    if (pos.halfmove >= 100) {
      return { cycle, index, opponent: opponent.label, studentColor: studentAsWhite ? 'white' : 'black', result: 'draw', reason: '50move', plies: history.length, history };
    }
    if (insuffMat(pos.board)) {
      return { cycle, index, opponent: opponent.label, studentColor: studentAsWhite ? 'white' : 'black', result: 'draw', reason: 'insufficient_material', plies: history.length, history };
    }

    const repKey = buildRepetitionKey(pos);
    seen.set(repKey, (seen.get(repKey) || 0) + 1);
    if (seen.get(repKey) >= 3) {
      return { cycle, index, opponent: opponent.label, studentColor: studentAsWhite ? 'white' : 'black', result: 'draw', reason: 'threefold', plies: history.length, history };
    }

    const legalMoves = generateLegalMoves(pos);
    const studentTurn = (pos.side === 'w') === studentAsWhite;
    if (legalMoves.length === 0) {
      const result = isInCheck(pos.board, pos.side)
        ? (studentTurn ? 'loss' : 'win')
        : 'draw';
      const reason = result === 'draw' ? 'stalemate' : 'checkmate';
      return { cycle, index, opponent: opponent.label, studentColor: studentAsWhite ? 'white' : 'black', result, reason, plies: history.length, history };
    }

    const fen = boardToFen(pos);
    const engine = studentTurn ? student : opponent;
    const reply = engine.getMove(fen);
    const move = String(reply.move || '').trim();
    if (!UCI_RE.test(move)) {
      return {
        cycle,
        index,
        opponent: opponent.label,
        studentColor: studentAsWhite ? 'white' : 'black',
        result: studentTurn ? 'loss' : 'win',
        reason: 'invalid_move',
        plies: history.length,
        history,
      };
    }

    if (!legalMoves.includes(move)) {
      return {
        cycle,
        index,
        opponent: opponent.label,
        studentColor: studentAsWhite ? 'white' : 'black',
        result: studentTurn ? 'loss' : 'win',
        reason: 'illegal_move',
        plies: history.length,
        history,
      };
    }

    history.push({
      ply,
      fen,
      fullmove: pos.fullmove,
      sideToMove: pos.side,
      studentTurn,
      move,
      engine: engine.label,
      totalMs: Number(reply.metrics?.totalMs || 0),
    });
    pos = applyUci(pos, move);
  }

  return { cycle, index, opponent: opponent.label, studentColor: studentAsWhite ? 'white' : 'black', result: 'draw', reason: 'max_ply', plies: history.length, history };
}

function reviewLosses(lossGames, coach) {
  const lessons = [];
  let reviewedPositions = 0;
  let skippedCoachMoves = 0;

  for (const game of lossGames) {
    for (const entry of game.history) {
      if (!entry.studentTurn) continue;
      reviewedPositions++;
      const legalMoves = generateLegalMoves(parseFen(entry.fen));
      const reply = coach.getMove(entry.fen);
      const coachMove = String(reply.move || '').trim();
      if (!UCI_RE.test(coachMove) || !legalMoves.includes(coachMove)) {
        skippedCoachMoves++;
        continue;
      }
      if (coachMove === entry.move) continue;

      lessons.push({
        cycle: game.cycle,
        game: game.index,
        opponent: game.opponent,
        studentColor: game.studentColor,
        ply: entry.ply,
        fen: entry.fen,
        studentMove: entry.move,
        coachMove,
        coachMs: Number(reply.metrics?.totalMs || 0),
        ...analyzeMoment(entry.fen, entry.move, coachMove),
      });
    }
  }

  lessons.sort((a, b) => b.severity - a.severity || b.deltaCp - a.deltaCp || a.ply - b.ply);
  return { reviewedPositions, skippedCoachMoves, lessons };
}

function countBy(items, pickKey) {
  const counts = {};
  for (const item of items) {
    const values = Array.isArray(pickKey(item)) ? pickKey(item) : [pickKey(item)];
    for (const value of values) {
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
}

function averageMoveTime(games, studentOnly = false) {
  let totalMs = 0;
  let count = 0;
  for (const game of games) {
    for (const entry of game.history) {
      if (studentOnly && !entry.studentTurn) continue;
      totalMs += Number(entry.totalMs || 0);
      count++;
    }
  }
  return count ? totalMs / count : 0;
}

function buildMarkdown(report) {
  const lines = [];
  lines.push('# CPU Coach Harness Report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Engines');
  lines.push('');
  lines.push(`- Student: ${report.student.label} (${report.student.mode})`);
  lines.push(`- Coach: ${report.coach.label} (${report.coach.mode})`);
  lines.push(`- Opponents: ${report.opponents.map((item) => `${item.label} (${item.mode})`).join(', ')}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Games: ${report.summary.games}`);
  lines.push(`- Wins: ${report.summary.wins}`);
  lines.push(`- Draws: ${report.summary.draws}`);
  lines.push(`- Losses: ${report.summary.losses}`);
  lines.push(`- Reviewed student positions from losses: ${report.summary.reviewedPositions}`);
  lines.push(`- Coaching disagreements: ${report.summary.lessonCount}`);
  lines.push(`- Avg student move time: ${report.summary.avgStudentMoveMs.toFixed(1)} ms`);
  lines.push('');
  lines.push('## Cycles');
  lines.push('');
  lines.push('| Cycle | Wins | Draws | Losses | Reviewed | Lessons |');
  lines.push('|---|---:|---:|---:|---:|---:|');
  for (const cycle of report.cycles) {
    lines.push(`| ${cycle.cycle} | ${cycle.wins} | ${cycle.draws} | ${cycle.losses} | ${cycle.reviewedPositions} | ${cycle.lessons} |`);
  }
  lines.push('');
  lines.push('## Lesson Breakdown');
  lines.push('');
  for (const [category, count] of Object.entries(report.breakdown.categories)) {
    lines.push(`- ${category}: ${count}`);
  }
  lines.push('');
  lines.push('## Top Lessons');
  lines.push('');
  if (report.lessons.length === 0) {
    lines.push('No disagreements were recorded.');
  } else {
    lines.push('| Cycle | Game | Opponent | Ply | Phase | Categories | Student | Coach | Delta |');
    lines.push('|---|---:|---|---:|---|---|---|---|---:|');
    for (const lesson of report.lessons.slice(0, 15)) {
      lines.push(
        `| ${lesson.cycle} | ${lesson.game} | ${lesson.opponent} | ${lesson.ply} | ${lesson.phase} | ${lesson.categories.join(', ')} | ${lesson.studentMove} | ${lesson.coachMove} | ${lesson.deltaCp} |`,
      );
    }
  }
  lines.push('');
  lines.push('## Output');
  lines.push('');
  lines.push(`- JSON: ${report.output.jsonPath}`);
  lines.push(`- Markdown: ${report.output.mdPath}`);
  lines.push('');
  return lines.join('\n') + '\n';
}

function buildReport(options, student, coach, opponents, games, cycleSummaries, lessonsMeta) {
  const { lessons, reviewedPositions, skippedCoachMoves } = lessonsMeta;
  const wins = games.filter((game) => game.result === 'win').length;
  const draws = games.filter((game) => game.result === 'draw').length;
  const losses = games.filter((game) => game.result === 'loss').length;

  return {
    generatedAt: new Date().toISOString(),
    config: {
      gamesPerCycle: options.games,
      cycles: options.cycles,
      timeoutMs: options.timeoutMs,
      coachTimeoutMs: options.coachTimeoutMs,
      maxPly: options.maxPly,
      startFen: options.startFen,
    },
    student: { label: student.label, mode: student.mode, input: student.input },
    coach: { label: coach.label, mode: coach.mode, input: coach.input },
    opponents: opponents.map((opponent) => ({ label: opponent.label, mode: opponent.mode, input: opponent.input })),
    summary: {
      games: games.length,
      wins,
      draws,
      losses,
      reviewedPositions,
      skippedCoachMoves,
      lessonCount: lessons.length,
      avgStudentMoveMs: averageMoveTime(games, true),
      avgAllMoveMs: averageMoveTime(games, false),
    },
    cycles: cycleSummaries,
    breakdown: {
      categories: countBy(lessons, (lesson) => lesson.categories),
      phases: countBy(lessons, (lesson) => lesson.phase),
      opponents: countBy(lessons, (lesson) => lesson.opponent),
    },
    lessons,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('');
  console.log('CPU Coach Harness');
  console.log(`  student:   ${options.student.label}`);
  console.log(`  coach:     ${options.coach.label}`);
  console.log(`  opponents: ${options.opponents.map((item) => item.label).join(', ')}`);
  console.log(`  cycles:    ${options.cycles}`);
  console.log(`  games:     ${options.games}`);
  console.log('');

  const student = loadEngine(options.student, options.timeoutMs, true, options.startFen);
  const coach = loadEngine(options.coach, options.coachTimeoutMs, true, options.startFen);
  const opponents = options.opponents.map((item) => loadEngine(item, options.timeoutMs, true, options.startFen));

  console.log(`Loaded student via ${student.mode}`);
  console.log(`Loaded coach via ${coach.mode}`);
  for (const opponent of opponents) {
    console.log(`Loaded opponent ${opponent.label} via ${opponent.mode}`);
  }
  console.log('');

  const allGames = [];
  const cycleSummaries = [];
  const allLessons = [];
  let totalReviewedPositions = 0;
  let totalSkippedCoachMoves = 0;

  for (let cycle = 1; cycle <= options.cycles; cycle++) {
    let wins = 0;
    let draws = 0;
    let losses = 0;
    const cycleGames = [];

    console.log(`Cycle ${cycle}/${options.cycles}`);
    for (let index = 0; index < options.games; index++) {
      const opponent = opponents[index % opponents.length];
      const studentAsWhite = index % 2 === 0;
      process.stdout.write(`  game ${index + 1}/${options.games} vs ${opponent.label} (${studentAsWhite ? 'W' : 'B'})... `);
      const game = playGame(student, opponent, studentAsWhite, options, cycle, index + 1);
      cycleGames.push(game);
      allGames.push(game);

      if (game.result === 'win') wins++;
      else if (game.result === 'draw') draws++;
      else losses++;

      console.log(`${game.result.toUpperCase()} (${game.reason}, ${game.plies} ply)`);
    }

    const lossesThisCycle = cycleGames.filter((game) => game.result === 'loss');
    const review = reviewLosses(lossesThisCycle, coach);
    totalReviewedPositions += review.reviewedPositions;
    totalSkippedCoachMoves += review.skippedCoachMoves;
    allLessons.push(...review.lessons);

    cycleSummaries.push({
      cycle,
      wins,
      draws,
      losses,
      reviewedPositions: review.reviewedPositions,
      lessons: review.lessons.length,
    });

    console.log(`  reviewed positions: ${review.reviewedPositions}`);
    console.log(`  coaching disagreements: ${review.lessons.length}`);
    if (review.skippedCoachMoves > 0) {
      console.log(`  skipped coach outputs: ${review.skippedCoachMoves}`);
    }
    console.log('');
  }

  allLessons.sort((a, b) => b.severity - a.severity || b.deltaCp - a.deltaCp || a.ply - b.ply);
  const report = buildReport(
    options,
    student,
    coach,
    opponents,
    allGames,
    cycleSummaries,
    {
      lessons: allLessons,
      reviewedPositions: totalReviewedPositions,
      skippedCoachMoves: totalSkippedCoachMoves,
    },
  );

  mkdirSync(options.outDir, { recursive: true });
  const jsonPath = join(options.outDir, `${options.prefix}_coach_report.json`);
  const mdPath = join(options.outDir, `${options.prefix}_coach_report.md`);
  report.output = { jsonPath, mdPath };
  const markdown = buildMarkdown(report);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(mdPath, markdown);

  console.log('Final Summary');
  console.log(`  wins/draws/losses: ${report.summary.wins}/${report.summary.draws}/${report.summary.losses}`);
  console.log(`  reviewed student positions: ${report.summary.reviewedPositions}`);
  console.log(`  lessons: ${report.summary.lessonCount}`);
  console.log(`  report: ${mdPath}`);
}

main();
