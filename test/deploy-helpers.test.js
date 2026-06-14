'use strict';

// Tests for the pure helpers exported by scripts/deploy.js (legacy /use-si-coder
// monolith). Uses only the Node.js built-ins node:test + node:assert — no new deps.
// The require below is safe: deploy.js guards its entry with `require.main === module`,
// so importing it here does NOT trigger a deployment.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseEnvString,
  mergeEnvString,
  mergeEnvStringVerbatim,
  parseEnvComposeVerbatim,
  selectDomainsToDelete,
  extractAdminKey,
  maskSecret,
  ensureGitignoreSafety,
  scanNestedDotenvLeaks,
  isReincludedByNegation,
  scanRootSecretFiles,
  parseDeployArgs,
  REPO_URL_RE,
} = require('../scripts/deploy.js');
const { execFileSync } = require('node:child_process');

// ---------------------------------------------------------------------------
// parseEnvString
// ---------------------------------------------------------------------------
test('parseEnvString: parses K=V pairs', () => {
  assert.deepEqual(parseEnvString('A=1\nB=2'), { A: '1', B: '2' });
});

test('parseEnvString: skips blank and comment lines', () => {
  const input = '\n# a comment\nA=1\n   \n#another\nB=2\n';
  assert.deepEqual(parseEnvString(input), { A: '1', B: '2' });
});

test("parseEnvString: preserves '=' inside the value", () => {
  const out = parseEnvString('TOKEN=abc=def==ghi');
  assert.equal(out.TOKEN, 'abc=def==ghi');
});

test('parseEnvString: empty / default input yields empty object', () => {
  assert.deepEqual(parseEnvString(''), {});
  assert.deepEqual(parseEnvString(), {});
});

// ---------------------------------------------------------------------------
// mergeEnvString
// ---------------------------------------------------------------------------
test('mergeEnvString: updates override existing values', () => {
  assert.equal(mergeEnvString('A=1\nB=2', { B: '99' }), 'A=1\nB=99');
});

test('mergeEnvString: preserves original key order', () => {
  assert.equal(mergeEnvString('Z=1\nA=2\nM=3', { A: '20' }), 'Z=1\nA=20\nM=3');
});

test('mergeEnvString: appends new keys after existing ones', () => {
  assert.equal(mergeEnvString('A=1', { B: '2', C: '3' }), 'A=1\nB=2\nC=3');
});

test('mergeEnvString: ignores undefined / null update values', () => {
  assert.equal(mergeEnvString('A=1\nB=2', { B: undefined, C: null }), 'A=1\nB=2');
});

// ---------------------------------------------------------------------------
// selectDomainsToDelete
// ---------------------------------------------------------------------------
test('selectDomainsToDelete: keeps desired host (first occurrence)', () => {
  const domains = [{ host: 'app.example.com', id: 1 }];
  assert.deepEqual(selectDomainsToDelete(domains, ['app.example.com']), []);
});

test('selectDomainsToDelete: removes duplicate desired hosts, keeps first', () => {
  const domains = [
    { host: 'app.example.com', id: 1 },
    { host: 'app.example.com', id: 2 },
  ];
  const out = selectDomainsToDelete(domains, ['app.example.com']);
  assert.deepEqual(out, [{ host: 'app.example.com', id: 2 }]);
});

test('selectDomainsToDelete: removes *.traefik.me even when desired is empty', () => {
  const domains = [{ host: 'foo-bar.traefik.me', id: 7 }];
  const out = selectDomainsToDelete(domains, []);
  assert.deepEqual(out, [{ host: 'foo-bar.traefik.me', id: 7 }]);
});

test('selectDomainsToDelete: removes non-desired hosts when desired is non-empty', () => {
  const domains = [
    { host: 'keep.example.com', id: 1 },
    { host: 'stale.example.com', id: 2 },
  ];
  const out = selectDomainsToDelete(domains, ['keep.example.com']);
  assert.deepEqual(out, [{ host: 'stale.example.com', id: 2 }]);
});

test('selectDomainsToDelete: keeps all non-traefik hosts when desired is empty', () => {
  const domains = [
    { host: 'a.example.com', id: 1 },
    { host: 'b.example.com', id: 2 },
  ];
  assert.deepEqual(selectDomainsToDelete(domains, []), []);
});

// ---------------------------------------------------------------------------
// extractAdminKey
// ---------------------------------------------------------------------------
test("extractAdminKey: picks the line matching the key shape (with noise around it)", () => {
  const raw = 'some noise\nconvex-self-hosted|abc123def456\ntrailing noise line';
  assert.equal(extractAdminKey(raw), 'convex-self-hosted|abc123def456');
});

test("extractAdminKey: strips 'Admin key:' prefix", () => {
  const raw = 'Admin key: convex-self-hosted|deadbeef';
  assert.equal(extractAdminKey(raw), 'convex-self-hosted|deadbeef');
});

test('extractAdminKey: accepts a versioned <name>|<tag>|<hex> key', () => {
  const raw = 'noise\nconvex-self-hosted|v1|deadbeefcafe\nmore noise';
  assert.equal(extractAdminKey(raw), 'convex-self-hosted|v1|deadbeefcafe');
});

test('extractAdminKey: THROWS on noisy container output with no key', () => {
  // EXTRACT-ADMINKEY-WEAK-FALLBACK: warnings/log noise (no `|<hex>` line) must NOT
  // fall back to the last arbitrary line — a bogus key would be propagated otherwise.
  const noisy = [
    'WARNING: container starting up',
    'level=info msg="waiting for database"',
    'some trailing diagnostic without a key',
  ].join('\n');
  assert.throws(() => extractAdminKey(noisy), /no line matched|key shape/i);
});

test('extractAdminKey: THROWS on empty / default input', () => {
  assert.throws(() => extractAdminKey(''), /no line matched|key shape/i);
  assert.throws(() => extractAdminKey(), /no line matched|key shape/i);
});

test('extractAdminKey: THROWS when a |-containing line is not a valid key', () => {
  // A pipe-in-prose line ("foo | bar baz") must not be mistaken for a key.
  const raw = 'docker run foo | bar baz\nsome other output';
  assert.throws(() => extractAdminKey(raw), /no line matched|key shape/i);
});

// ---------------------------------------------------------------------------
// maskSecret
// ---------------------------------------------------------------------------
test("maskSecret: short secret (<=4 chars) becomes '****'", () => {
  assert.equal(maskSecret('abcd'), '****');
  assert.equal(maskSecret('x'), '****');
  assert.equal(maskSecret(''), '****');
});

test("maskSecret: long secret starts with 'len='", () => {
  const out = maskSecret('supersecretvalue12345');
  assert.ok(out.startsWith('len='), `expected len= prefix, got: ${out}`);
});

// ---------------------------------------------------------------------------
// REPO_URL_RE
// ---------------------------------------------------------------------------
test('REPO_URL_RE: accepts git@github.com:owner/repo.git', () => {
  assert.ok(REPO_URL_RE.test('git@github.com:owner/repo.git'));
});

test('REPO_URL_RE: accepts https://github.com/owner/repo and .git variant', () => {
  assert.ok(REPO_URL_RE.test('https://github.com/owner/repo'));
  assert.ok(REPO_URL_RE.test('https://github.com/owner/repo.git'));
});

test('REPO_URL_RE: rejects command-injection in repo url', () => {
  assert.ok(!REPO_URL_RE.test('git@github.com:o/r.git; rm -rf /'));
});

// ---------------------------------------------------------------------------
// SEC-1: parseDeployArgs — secrets never come from argv
// ---------------------------------------------------------------------------
test('parseDeployArgs: --flag value form', () => {
  assert.deepEqual(
    parseDeployArgs(['--project', 'p', '--app', 'a', '--domain', 'd']),
    { project: 'p', app: 'a', domain: 'd' },
  );
});

test('parseDeployArgs: --flag=value form', () => {
  assert.deepEqual(
    parseDeployArgs(['--project=p', '--app=a', '--domain=d']),
    { project: 'p', app: 'a', domain: 'd' },
  );
});

test('parseDeployArgs: bare positionals map to project/app/domain', () => {
  assert.deepEqual(
    parseDeployArgs(['myproj', 'myapp', 'app.example.com']),
    { project: 'myproj', app: 'myapp', domain: 'app.example.com' },
  );
});

test('parseDeployArgs: domain optional', () => {
  assert.deepEqual(
    parseDeployArgs(['--project', 'p', '--app', 'a']),
    { project: 'p', app: 'a', domain: undefined },
  );
});

test('parseDeployArgs: flags win over positionals', () => {
  assert.deepEqual(
    parseDeployArgs(['pos1', '--app', 'flagapp', 'pos2']),
    { project: 'pos1', app: 'flagapp', domain: undefined },
  );
});

test('parseDeployArgs: --flag does not swallow a following flag as its value', () => {
  // NIT-ARGPARSE-GREEDY: a missing value must NOT consume the next flag token.
  assert.deepEqual(
    parseDeployArgs(['--project', '--app', 'myapp']),
    { project: undefined, app: 'myapp', domain: undefined },
  );
});

test('parseDeployArgs: trailing --flag with no value is ignored, not crashed', () => {
  assert.deepEqual(
    parseDeployArgs(['--app', 'a', '--domain']),
    { project: undefined, app: 'a', domain: undefined },
  );
});

// ---------------------------------------------------------------------------
// DRY-2: verbatim env parse/merge (no quote stripping)
// ---------------------------------------------------------------------------
test('mergeEnvStringVerbatim: preserves surrounding quotes verbatim', () => {
  assert.equal(mergeEnvStringVerbatim('A="quoted"', { B: '2' }), 'A="quoted"\nB=2');
});

test('mergeEnvStringVerbatim: preserves key order and overrides', () => {
  assert.equal(mergeEnvStringVerbatim('Z=1\nA=2', { A: '20', M: '3' }), 'Z=1\nA=20\nM=3');
});

test('parseEnvComposeVerbatim: keeps quotes + value with = signs', () => {
  const out = parseEnvComposeVerbatim('KEY="a|b=c"\nN=1');
  assert.equal(out.KEY, '"a|b=c"');
  assert.equal(out.N, '1');
});

// ---------------------------------------------------------------------------
// SEC-2: isReincludedByNegation
// ---------------------------------------------------------------------------
test('isReincludedByNegation: detects trailing !.env', () => {
  assert.ok(isReincludedByNegation('.env\n.env.*\n!.env'));
});

test('isReincludedByNegation: detects !.env.*', () => {
  assert.ok(isReincludedByNegation('.env\n!.env.*'));
});

test('isReincludedByNegation: false when no negation', () => {
  assert.ok(!isReincludedByNegation('.env\n.env.*\n!.env.example'));
});

// ---------------------------------------------------------------------------
// SEC-3: scanRootSecretFiles
// ---------------------------------------------------------------------------
test('scanRootSecretFiles: flags id_rsa / *.pem / serviceAccount.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-secrets-'));
  try {
    fs.writeFileSync(path.join(dir, 'id_rsa'), 'x');
    fs.writeFileSync(path.join(dir, 'cert.pem'), 'x');
    fs.writeFileSync(path.join(dir, 'serviceAccount.json'), '{}');
    fs.writeFileSync(path.join(dir, 'index.js'), '//ok');
    const hits = scanRootSecretFiles(dir).sort();
    assert.deepEqual(hits, ['cert.pem', 'id_rsa', 'serviceAccount.json']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// SEC-2: ensureGitignoreSafety delegates to git semantics
// ---------------------------------------------------------------------------
test('ensureGitignoreSafety: aborts on trailing !.env re-include even with required rules present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-gi-'));
  try {
    fs.writeFileSync(
      path.join(dir, '.gitignore'),
      ['.env', '.env.*', '!.env.example', 'node_modules', '.next', '.DS_Store', '!.env'].join('\n') + '\n',
    );
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    assert.throws(() => ensureGitignoreSafety(dir), /re-include|negation|!\.env/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureGitignoreSafety: writes .gitignore + passes when no stray dotenv', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-gi-ok-'));
  try {
    // No .gitignore yet, no .env present → should write rules and NOT throw.
    assert.doesNotThrow(() => ensureGitignoreSafety(dir));
    assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// NESTED-DOTENV: scanNestedDotenvLeaks walks the whole tree (git check-ignore)
// ---------------------------------------------------------------------------
function gitInit(dir) {
  execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
}

test('scanNestedDotenvLeaks: ABORTS on an unignored nested apps/web/.env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-nested-'));
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), '/.env\n'); // only ignores ROOT .env
    fs.mkdirSync(path.join(dir, 'apps', 'web'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'apps', 'web', '.env'), 'SECRET=1');
    assert.throws(() => scanNestedDotenvLeaks(dir), /nested secret|apps\/web\/\.env/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanNestedDotenvLeaks: PASSES when nested dotenv is git-ignored tree-wide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-nested-ok-'));
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.env.*\n!.env.example\n');
    fs.mkdirSync(path.join(dir, 'packages', 'core'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'packages', 'core', '.env.local'), 'SECRET=1');
    fs.writeFileSync(path.join(dir, 'packages', 'core', '.env.example'), 'SECRET='); // allowed
    assert.doesNotThrow(() => scanNestedDotenvLeaks(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scanNestedDotenvLeaks: skips node_modules even if it contains a .env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-nested-nm-'));
  try {
    gitInit(dir);
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', '.env'), 'X=1');
    assert.doesNotThrow(() => scanNestedDotenvLeaks(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
