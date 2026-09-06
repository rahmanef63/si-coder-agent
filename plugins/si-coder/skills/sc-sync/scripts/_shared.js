// _shared.js — common helpers for sc-sync scripts
const ROLES = new Set(['vps', 'local']);
const DIRECTIONS = new Set(['vps-local', 'local-vps']);

// Directories that never make sense to sync (build output, VCS internals,
// language caches). Matched as a full path segment, not a substring — e.g.
// "vendors/x.js" is NOT blocked just because it contains "vendor".
const BLOCKLIST = [
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo',
  '.venv', 'venv', '__pycache__', 'target', 'vendor', 'coverage', '.cache',
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCKLIST_RE = new RegExp(
  `(^|/)(${BLOCKLIST.map(escapeRegExp).join('|')})(/|$)`,
);

// True if `relPath` (repo-relative, forward-slash or backslash) falls under
// one of the blocked directories at any depth.
function isBlockedPath(relPath) {
  return BLOCKLIST_RE.test(String(relPath).replace(/\\/g, '/'));
}

// Filter a list of repo-relative paths, dropping anything under BLOCKLIST.
function filterBlocked(paths) {
  return paths.filter((p) => p && !isBlockedPath(p));
}

// route(direction, role) — pure, no env/IO. Figures out which of the two
// machines is the rsync SRC and which is the DST for a requested direction,
// then says whether *this* machine (identified by `role`, i.e. SYNC_ROLE) is
// the one pushing (isSrc) or pulling (isDst).
//
//   direction=vps-local, role=vps   -> src=vps,   dst=local, this=SRC (push)
//   direction=vps-local, role=local -> src=vps,   dst=local, this=DST (pull)
//   direction=local-vps, role=local -> src=local, dst=vps,   this=SRC (push)
//   direction=local-vps, role=vps   -> src=local, dst=vps,   this=DST (pull)
function route(direction, role) {
  if (!DIRECTIONS.has(direction)) {
    throw new Error(`invalid direction: ${JSON.stringify(direction)} (expected 'vps-local' or 'local-vps')`);
  }
  if (!ROLES.has(role)) {
    throw new Error(`invalid role: ${JSON.stringify(role)} (expected 'vps' or 'local')`);
  }
  const src = direction === 'vps-local' ? 'vps' : 'local';
  const dst = direction === 'vps-local' ? 'local' : 'vps';
  const isSrc = role === src;
  const isDst = role === dst;
  const mode = isSrc ? 'push' : 'pull';
  // The role on the other end of the wire from this machine.
  const other = isSrc ? dst : src;
  return { src, dst, isSrc, isDst, mode, other };
}

// Flags that are always booleans, even when immediately followed by a
// positional arg that doesn't itself start with '--' (e.g. the CLI shape
// `<direction> [--apply] [path...]` — without this, the naive "next token
// that doesn't start with -- is this flag's value" heuristic would swallow
// the first path as --apply's value instead of a positional).
const BOOLEAN_FLAGS = new Set(['apply', 'help']);

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { o[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(k) && n !== undefined && !n.startsWith('--')) {
        o[k] = n; i++;
      } else {
        o[k] = true;
      }
    } else {
      o._.push(a);
    }
  }
  return o;
}

function log(...a) { console.log(...a); }
function warn(...a) { console.warn('⚠️ ', ...a); }
function err(...a) { console.error('❌', ...a); }
function ok(...a) { console.log('✅', ...a); }

module.exports = {
  ROLES, DIRECTIONS, BLOCKLIST,
  isBlockedPath, filterBlocked,
  route, parseArgs,
  log, warn, err, ok,
};
