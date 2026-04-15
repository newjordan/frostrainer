import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const nodeRequire = createRequire(import.meta.url);
const agentCache = new Map();
const IMPORT_RE = /^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm;

function stripShebang(code) {
  return code.replace(/^#!.*\n/, '');
}

function uniquePush(items, item) {
  if (!items.some((entry) => entry.key === item.key && entry.value === item.value)) {
    items.push(item);
  }
}

function collectExportEntries(code) {
  const exports = [];

  for (const match of code.matchAll(/^export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    uniquePush(exports, { key: match[1], value: match[1] });
  }

  for (const match of code.matchAll(/^export\s*\{([\s\S]*?)\};?\s*$/gm)) {
    const parts = match[1].split(',').map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliasMatch) {
        uniquePush(exports, { key: aliasMatch[2], value: aliasMatch[1] });
      } else {
        uniquePush(exports, { key: part, value: part });
      }
    }
  }

  return exports;
}

function stripExports(code) {
  return code
    .replace(/^export\s+const\s+/gm, 'const ')
    .replace(/^export\s+let\s+/gm, 'let ')
    .replace(/^export\s+var\s+/gm, 'var ')
    .replace(/^export\s+function\s+/gm, 'function ')
    .replace(/^export\s+class\s+/gm, 'class ')
    .replace(/^export\s+default\s+/gm, '')
    .replace(/^export\s*\{[\s\S]*?\};?\s*$/gm, '');
}

function resolveImportPath(fromPath, specifier) {
  let resolved = resolve(dirname(fromPath), specifier);
  if (existsSync(resolved)) return resolved;
  if (existsSync(`${resolved}.js`)) return `${resolved}.js`;
  if (existsSync(`${resolved}.mjs`)) return `${resolved}.mjs`;
  const indexJs = join(resolved, 'index.js');
  if (existsSync(indexJs)) return indexJs;
  const indexMjs = join(resolved, 'index.mjs');
  if (existsSync(indexMjs)) return indexMjs;
  return resolved;
}

function buildImportBindings(specifierText, moduleVar) {
  const bracesStart = specifierText.indexOf('{');
  const bracesEnd = specifierText.lastIndexOf('}');
  if (bracesStart === -1 || bracesEnd === -1 || bracesEnd <= bracesStart) return '';

  const inner = specifierText.slice(bracesStart + 1, bracesEnd).trim();
  if (!inner) return '';

  const props = inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const aliasMatch = part.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      return aliasMatch ? `${aliasMatch[1]}: ${aliasMatch[2]}` : part;
    });

  return props.length ? `const { ${props.join(', ')} } = ${moduleVar};` : '';
}

function bundleModule(modulePath, state) {
  if (state.modules.has(modulePath)) return state.modules.get(modulePath);

  const moduleVar = `__dojo_mod_${state.nextModuleId++}`;
  state.modules.set(modulePath, moduleVar);

  let code = stripShebang(readFileSync(modulePath, 'utf8'));
  let prelude = '';

  code = code.replace(IMPORT_RE, (full, specifierText, source) => {
    if (!source.startsWith('.')) return '';
    const depPath = resolveImportPath(modulePath, source);
    const depVar = bundleModule(depPath, state);
    const binding = buildImportBindings(specifierText, depVar);
    if (binding) prelude += binding + '\n';
    return '';
  });

  const exportEntries = collectExportEntries(code);
  code = stripExports(code);
  const exportBody = exportEntries.map(({ key, value }) => `${key}: ${value}`).join(', ');

  state.chunks.push(`
const ${moduleVar} = (() => {
${prelude}${code}
return { ${exportBody} };
})();
`);

  return moduleVar;
}

function bundleSource(sourceCode, sourcePath) {
  const state = { modules: new Map(), chunks: [], nextModuleId: 0 };
  let code = stripShebang(sourceCode);
  let prelude = '';

  code = code.replace(IMPORT_RE, (full, specifierText, source) => {
    if (!source.startsWith('.')) return '';
    const depPath = resolveImportPath(sourcePath, source);
    const depVar = bundleModule(depPath, state);
    const binding = buildImportBindings(specifierText, depVar);
    if (binding) prelude += binding + '\n';
    return '';
  });

  code = stripExports(code);

  return `${state.chunks.join('\n')}\n${prelude}${code}`;
}

function buildWrappedAgent(agentPath) {
  let code = stripShebang(readFileSync(agentPath, 'utf8'));

  const patternA = /^const fen = readFileSync\(0,\s*'utf8'\)\.trim\(\);/m;
  const idxA = code.search(patternA);

  let engineCode;
  let getMoveCall;

  if (idxA !== -1) {
    engineCode = code.substring(0, idxA);
    getMoveCall = `
  const start = performance.now();
  const pos = parseFen(fen);
  const result = iterativeDeepening(pos);
  let bestMove = result && typeof result === 'object' ? result.move : result;
  const internalMetrics = result && typeof result === 'object' ? result.metrics : {};
  const internalTrace =
    result && typeof result === 'object' && result.trace
      ? result.trace
      : (typeof getDojoTrace === 'function' ? getDojoTrace() : undefined);

  if (!bestMove) {
    const legal = generateMoves(pos, false).filter(m => {
      const undo = makeMove(pos, m);
      const ok = !isInCheck(pos, 1 - pos.side);
      unmakeMove(pos, m, undo);
      return ok;
    });
    if (legal.length > 0) bestMove = legal[0];
  }
  const end = performance.now();
  return {
    move: bestMove ? (typeof bestMove === 'string' ? bestMove : moveToUci(bestMove)) : '0000',
    metrics: {
      ...internalMetrics,
      totalMs: end - start,
    },
    trace: internalTrace,
  };`;
  } else {
    const writeMatch = code.match(/process\.stdout\.write\([`'"]\$\{([^(]+)\(/);
    if (!writeMatch) return null;

    const funcName = writeMatch[1].trim();
    const mainIdx = code.search(/const fen\s*=/m);
    if (mainIdx <= 0) return null;

    engineCode = code.substring(0, mainIdx);
    getMoveCall = `
  const start = performance.now();
  const move = ${funcName}(fen);
  const end = performance.now();
  return {
    move,
    metrics: { totalMs: end - start },
    trace: typeof getDojoTrace === 'function' ? getDojoTrace() : undefined,
  };`;
  }

  engineCode = bundleSource(engineCode, agentPath)
    .replace(/^(module\.exports|export)\s*=\s*\{[^}]*\};?\s*$/gm, '');

  return `
(function() {
${engineCode}

function __getMove(fen) {
${getMoveCall}
}

return __getMove;
})();`;
}

function createSandbox() {
  return vm.createContext({
    readFileSync,
    require: nodeRequire,
    console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
    Math, Date, Array, Object, String, Number, Boolean, Map, Set, WeakMap, WeakSet,
    RegExp, Error, TypeError, RangeError, SyntaxError, ReferenceError, URIError, EvalError,
    JSON, parseInt, parseFloat, isNaN, isFinite,
    undefined, Infinity, NaN,
    Int8Array, Int16Array, Int32Array, Uint8Array, Uint16Array, Uint32Array,
    Float32Array, Float64Array, BigInt64Array, BigUint64Array,
    ArrayBuffer, SharedArrayBuffer, DataView,
    Symbol, Proxy, Reflect, Promise, BigInt,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Buffer, TextEncoder, TextDecoder, URL, URLSearchParams,
    process: {
      stdout: { write() { return true; } },
      stderr: { write() { return true; } },
      exit() {},
      env: {},
      argv: [],
    },
    performance: { now: () => Date.now() },
    globalThis: {},
    queueMicrotask,
    ...(typeof structuredClone !== 'undefined' ? { structuredClone } : {}),
    ...(typeof atob !== 'undefined' ? { atob, btoa } : {}),
  });
}

function compileAgent(agentPath, options = {}) {
  const { forceReload = false } = options;
  if (!forceReload && agentCache.has(agentPath)) return agentCache.get(agentPath);

  const wrappedCode = buildWrappedAgent(agentPath);
  if (!wrappedCode) {
    agentCache.set(agentPath, null);
    return null;
  }

  try {
    const script = new vm.Script(wrappedCode, { filename: basename(agentPath) });
    const fn = script.runInContext(createSandbox(), { timeout: 15000 });
    if (typeof fn !== 'function') {
      agentCache.set(agentPath, null);
      return null;
    }
    agentCache.set(agentPath, fn);
    return fn;
  } catch (error) {
    console.error(`[dojo_runtime] compile fail ${basename(agentPath)}: ${error.message}`);
    agentCache.set(agentPath, null);
    return null;
  }
}

function resetAgentCache(agentPath = null) {
  if (agentPath) agentCache.delete(agentPath);
  else agentCache.clear();
}

function getMoveFromFn(fn, fen) {
  if (typeof fn !== 'function') return { move: '__FAIL__', metrics: { totalMs: 0 }, trace: null };
  try {
    const result = fn(fen);
    const move = typeof result === 'string' ? result : result.move;
    const metrics = typeof result === 'string' ? { totalMs: 0 } : result.metrics;
    const trace = typeof result === 'string' ? null : (result.trace || null);

    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return { move, metrics, trace };
    if (move === '0000') return { move, metrics, trace };
    return { move: '__FAIL__', metrics, trace };
  } catch {
    return { move: '__FAIL__', metrics: { totalMs: 0 }, trace: null };
  }
}

export { compileAgent, resetAgentCache, getMoveFromFn };
