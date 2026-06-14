// deploy.js — legacy /use-si-coder monolith (zero-human full-stack deploy)
const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dns = require('dns');
const util = require('util');
const lookup = util.promisify(dns.lookup);

// M1 DRY: reuse shared helpers from libs instead of forking logic.
const { parseEnvString, mergeEnvString } = require('../lib/env');
const { configureDnsRecord } = require('../lib/hostinger');
// DRY-1: admin-key extraction + schema deploy live in lib/convex (single source of truth).
// generateAdminKey wraps dockerExec(generate_admin_key.sh)+extractAdminKey; deploySchema
// wraps waitForValidTls + the no-shell `npx convex deploy`. extractAdminKey is re-exported
// for tests/back-compat.
const { extractAdminKey, generateAdminKey, deploySchema, probeBackend } = require('../lib/convex');

// ---- M2: named constants (no magic numbers) ----
const BACKEND_PORTS = { api: 3210, site: 3211, dash: 6791 };
const DNS_TTL = 14400;
const CONVEX_TEMPLATE_ID = 'convex';
const BACKEND_CONTAINER_SUFFIX = '-backend-1';

// ---- S3/R1: fetch resilience tunables ----
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;          // total attempts on retryable failures
const FETCH_BACKOFF_BASE_MS = 1000;

// ---- R2: admin-key health-poll tunables ----
const ADMIN_KEY_ATTEMPTS = 10;
const ADMIN_KEY_BACKOFF_BASE_MS = 3000;
// Cap each backoff so uncapped 2**(attempt-1) growth can't make a slow-booting backend
// look hung for ~half an hour. Capped at 30s, cumulative sleep across the 9 retries is
// ~3.3 min of backoff (plus per-attempt docker exec time).
const ADMIN_KEY_BACKOFF_MAX_MS = 30000;

// ---- R3: app-deploy poll tunables ----
const DEPLOY_POLL_INTERVAL_MS = 5000;
const DEPLOY_POLL_MAX_ATTEMPTS = 60; // ~5 minutes

// M3: module-scope so it can be exported + reused without re-declaring per run.
// Accept SSH (git@github.com:owner/repo.git) or https github URLs only.
const REPO_URL_RE = /^(git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?)$/;

const delay = ms => new Promise(res => setTimeout(res, ms));

// M1 NOTE (quote-stripping caveat):
// lib/env.parseEnvString strips one matching pair of surrounding quotes; the legacy
// inline parser preserved values verbatim. Dokploy compose env values are read back
// and re-written verbatim (INSTANCE_SECRET, CONVEX_ADMIN_KEY `name|base64`, URLs),
// so round-tripping them through a quote-stripping parser could corrupt a value that
// legitimately contains surrounding quotes. For the compose env merge path we keep the
// SAFE (verbatim, non-stripping) merge below. The lib helpers are still imported and
// re-exported for callers/tests and used wherever no risky round-trip occurs.
// DRY-2: single verbatim (non-quote-stripping) parse helper. Returns the key/value map
// plus first-seen key order so merge can preserve layout. parseEnvComposeVerbatim and
// mergeEnvStringVerbatim both build on this — no duplicated split/trim/indexOf loop.
function parseEnvVerbatimOrdered(envString = '') {
  const env = {};
  const order = [];
  for (const rawLine of envString.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    if (!order.includes(key)) order.push(key);
    env[key] = line.slice(eq + 1); // verbatim, no quote stripping
  }
  return { env, order };
}

function mergeEnvStringVerbatim(existingEnv = '', updates = {}) {
  const { env, order } = parseEnvVerbatimOrdered(existingEnv);
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) continue;
    if (!order.includes(key)) order.push(key);
    env[key] = String(value);
  }
  return order.map(key => `${key}=${env[key]}`).join('\n');
}

function maskSecret(s = '') {
  s = String(s);
  if (s.length <= 4) return '****';
  return `len=${s.length} …${s.slice(-4)}`;
}

// selectDomainsToDelete kept local (pure) for export + parity with prior behavior.
function selectDomainsToDelete(domains = [], desiredHosts = []) {
  const desired = new Set(desiredHosts.filter(Boolean));
  const keptDesiredHosts = new Set();
  const deletions = [];
  for (const domain of domains) {
    const host = domain.host;
    const isDesired = desired.has(host);
    const isTraefik = typeof host === 'string' && host.endsWith('.traefik.me');
    if (isDesired) {
      if (keptDesiredHosts.has(host)) deletions.push(domain);
      else keptDesiredHosts.add(host);
      continue;
    }
    if (isTraefik || desired.size > 0) deletions.push(domain);
  }
  return deletions;
}

// ---- S1: target-project .gitignore safety ----
const GITIGNORE_REQUIRED = ['.env', '.env.*', '!.env.example', 'node_modules', '.next', '.DS_Store'];

// SEC-3: small denylist of common root-level secret filenames (other than dotenv)
// that `git add .` would otherwise stage. Matched against the cwd root only.
const SECRET_FILE_RE = /^(id_rsa|id_dsa|id_ecdsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key|serviceaccount.*\.json|.*service[-_]?account.*\.json|.*-credentials\.json|gha-creds-.*\.json)$/i;

// SEC-2: detect a dangerous `!.env` / `!.env.*` (or `!.env.<secret-suffix>`) re-include in
// the existing .gitignore. git uses last-match-wins, so such a negation would UN-ignore the
// secret even when the required `.env` / `.env.*` rules are present earlier in the file.
// The legitimate `!.env.example` template re-include is explicitly allowed.
function isReincludedByNegation(gitignoreText = '') {
  return gitignoreText
    .split(/\r?\n/)
    .map(l => l.trim())
    .some(l => /^!\.env(\..+)?$/.test(l) && l !== '!.env.example');
}

// Ensure cwd has a .gitignore covering secrets/build dirs. Writes/augments it if needed,
// then asks GIT ITSELF (git check-ignore) whether each discovered dotenv file is ignored,
// honoring negations / nested patterns / global excludes — not a hand-rolled matcher.
function ensureGitignoreSafety(cwd = process.cwd()) {
  const gitignorePath = path.join(cwd, '.gitignore');
  let existing = '';
  if (fs.existsSync(gitignorePath)) existing = fs.readFileSync(gitignorePath, 'utf8');

  const presentLines = new Set(
    existing.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  );
  const missing = GITIGNORE_REQUIRED.filter(rule => !presentLines.has(rule));

  // SEC-2: a trailing `!.env*` re-include defeats our required rules (last-match-wins).
  // Refuse rather than print 'already covers' while git would still stage the secret.
  if (isReincludedByNegation(existing)) {
    throw new Error(
      `Refusing to push: ${gitignorePath} contains a '!.env' / '!.env.*' re-include that ` +
      `un-ignores dotenv secrets (git last-match-wins). Remove the negation before deploying.`
    );
  }

  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `# Auto-added by si-coder deploy (secret-leak guard)\n${GITIGNORE_REQUIRED.join('\n')}\n`);
    console.log('🛡️ Wrote .gitignore with secret/build ignore rules.');
  } else if (missing.length) {
    const trimmed = existing.replace(/\n+$/, '');
    fs.writeFileSync(gitignorePath, `${trimmed}\n\n# Added by si-coder deploy (secret-leak guard)\n${missing.join('\n')}\n`);
    console.log(`🛡️ Augmented .gitignore with: ${missing.join(', ')}`);
  } else {
    console.log('🛡️ .gitignore already covers secrets/build dirs.');
  }

  // SEC-2: ask git directly whether each discovered dotenv file is ignored. This honors
  // negations, nested .gitignore files, and the user's global excludes — i.e. git's real
  // semantics, not our minimal matcher. Falls back to the static matcher only if git is
  // unavailable (e.g. not yet a repo and `git check-ignore` cannot run).
  const entries = fs.readdirSync(cwd, { withFileTypes: true });
  const dangerous = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === '.env.example') continue;
    // Match `.env` and any `.env.<suffix>` variant.
    if (name === '.env' || name.startsWith('.env.')) {
      if (!gitIgnores(cwd, name)) dangerous.push(name);
    }
  }
  if (dangerous.length) {
    throw new Error(
      `Refusing to push: unignored secret file(s) present in ${cwd}: ${dangerous.join(', ')}. ` +
      `Add them to .gitignore (or remove them) before deploying.`
    );
  }

  // SEC-3: warn (do not auto-ignore) on common non-dotenv secret files at repo root that
  // `git add .` would stage. We only WARN here — naming conventions vary and a false abort
  // would block legitimate deploys; the operator decides.
  const rootSecrets = scanRootSecretFiles(cwd);
  if (rootSecrets.length) {
    console.warn(
      `⚠️ Potential secret file(s) at repo root that 'git add .' may stage: ${rootSecrets.join(', ')}. ` +
      `If sensitive, add them to .gitignore before deploying.`
    );
  }
}

// NESTED-DOTENV: ensureGitignoreSafety only inspects the cwd ROOT, but `git add .` stages
// the ENTIRE tree. Recursively walk for `**/.env*` (excluding .env.example) and ask GIT
// (check-ignore) whether each is ignored tree-wide. Must run AFTER `git init` so
// check-ignore is authoritative. Aborts on any nested dotenv git would actually stage.
// Skips .git/ and node_modules/ (huge, and node_modules is ignored anyway).
function scanNestedDotenvLeaks(cwd = process.cwd()) {
  const SKIP_DIRS = new Set(['.git', 'node_modules']);
  const dangerous = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        const name = entry.name;
        if (name === '.env.example') continue;
        if (name === '.env' || name.startsWith('.env.')) {
          const rel = path.relative(cwd, full);
          if (!gitIgnores(cwd, rel)) dangerous.push(rel);
        }
      }
    }
  };
  walk(cwd);
  if (dangerous.length) {
    throw new Error(
      `Refusing to push: unignored nested secret file(s) that 'git add .' would stage: ` +
      `${dangerous.join(', ')}. Add them to .gitignore (or remove them) before deploying.`,
    );
  }
}

// SEC-2: ask git whether <relPath> (relative to cwd) is ignored. Returns true when git
// reports it ignored. If git can't answer (no git / not a repo yet), fall back to the
// static GITIGNORE_REQUIRED matcher so we never silently treat an unknown as 'ignored'.
function gitIgnores(cwd, relPath) {
  try {
    const res = spawnSync(
      'git', ['check-ignore', '-q', '--', relPath],
      { cwd, stdio: 'ignore' }
    );
    // exit 0 = ignored, 1 = NOT ignored, 128 = error (e.g. not a repo) → use fallback.
    if (res.error || res.status === 128 || res.status === null) {
      return isIgnoredByRules(path.basename(relPath));
    }
    return res.status === 0;
  } catch {
    return isIgnoredByRules(path.basename(relPath));
  }
}

// SEC-3: list common root-level secret filenames (non-dotenv) present in cwd.
function scanRootSecretFiles(cwd = process.cwd()) {
  let entries;
  try { entries = fs.readdirSync(cwd, { withFileTypes: true }); }
  catch { return []; }
  const hits = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === '.env.example') continue;
    if (SECRET_FILE_RE.test(name)) hits.push(name);
  }
  return hits;
}

// Minimal static evaluator for the fixed GITIGNORE_REQUIRED ruleset against a filename.
// Used ONLY as a fallback when `git check-ignore` cannot run (no repo yet).
// Honors the `!.env.example` re-include and `.env` / `.env.*` ignores.
function isIgnoredByRules(name) {
  let ignored = false;
  for (const rule of GITIGNORE_REQUIRED) {
    if (rule === '.env' && name === '.env') ignored = true;
    else if (rule === '.env.*' && name.startsWith('.env.')) ignored = true;
    else if (rule === '!.env.example' && name === '.env.example') ignored = false;
  }
  return ignored;
}

function makeFetchers({ baseUrl, apiKey, githubToken }) {
  // R1/S3: shared retry+timeout wrapper. Retries on network errors and HTTP 5xx/429
  // (with exponential backoff); does NOT retry other 4xx. Each attempt is bounded by
  // an AbortController timeout (~30s).
  async function fetchWithResilience(label, url, options) {
    let lastErr;
    for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = text; }

        if (!res.ok) {
          const retryable = res.status === 429 || (res.status >= 500 && res.status <= 599);
          const msg = `${label} API Error ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : data}`;
          if (retryable && attempt < FETCH_RETRIES) {
            lastErr = new Error(msg);
            const backoff = FETCH_BACKOFF_BASE_MS * 2 ** (attempt - 1);
            console.warn(`⚠️ ${label} ${res.status}: attempt ${attempt} of ${FETCH_RETRIES} failed, retrying in ${backoff}ms...`);
            await delay(backoff);
            continue;
          }
          throw new Error(msg);
        }
        return data;
      } catch (err) {
        clearTimeout(timer);
        // Re-throw non-retryable HTTP errors immediately (already-final 4xx / final attempt).
        if (/API Error/.test(err.message)) throw err;
        // Network error / abort: retry with backoff.
        lastErr = err;
        if (attempt < FETCH_RETRIES) {
          const backoff = FETCH_BACKOFF_BASE_MS * 2 ** (attempt - 1);
          const reason = err.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS}ms` : err.message;
          console.warn(`⚠️ ${label} network error (${reason}): attempt ${attempt} of ${FETCH_RETRIES} failed, retrying in ${backoff}ms...`);
          await delay(backoff);
          continue;
        }
      }
    }
    throw lastErr || new Error(`${label} request failed`);
  }

  async function fetchDokploy(endpoint, method = 'GET', body = null) {
    const url = `${baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);
    return fetchWithResilience('Dokploy', url, options);
  }

  async function fetchGitHub(endpoint, method = 'GET', body = null) {
    const url = `https://api.github.com${endpoint}`;
    const options = {
      method,
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SICoder-Auto-Deploy-Skill',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
    return fetchWithResilience('GitHub', url, options);
  }

  return { fetchDokploy, fetchGitHub };
}

// SEC-1: parse only NON-secret values from argv. Secrets (DOKPLOY_API_URL,
// DOKPLOY_API_KEY, GITHUB_TOKEN) come EXCLUSIVELY from the environment so they
// never occupy an argv slot visible via `ps aux` / /proc/<pid>/cmdline.
// Non-secret flags: --project/--app/--domain. Bare positionals are accepted as
// <PROJECT> <APP> [DOMAIN] for convenience (still no secrets).
function parseDeployArgs(argv = []) {
  const out = { project: undefined, app: undefined, domain: undefined };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq !== -1) {
      const k = a.slice(2, eq);
      const v = a.slice(eq + 1);
      if (k === 'project') out.project = v;
      else if (k === 'app') out.app = v;
      else if (k === 'domain') out.domain = v;
    } else if (a === '--project' || a === '--app' || a === '--domain') {
      const k = a.slice(2);
      // Guard the look-ahead: don't swallow the next token as a value when it is itself a
      // flag (or absent) — that would silently produce a bogus `--app`-as-project name.
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        console.error(`deploy.js: --${k} expects a value but none was given; ignoring.`);
      } else {
        out[k] = argv[++i];
      }
    } else if (!a.startsWith('-')) {
      positional.push(a);
    }
  }
  if (out.project === undefined && positional[0] !== undefined) out.project = positional[0];
  if (out.app === undefined && positional[1] !== undefined) out.app = positional[1];
  if (out.domain === undefined && positional[2] !== undefined) out.domain = positional[2];
  return out;
}

async function run() {
  // SEC-1: secrets are read ONLY from env (never argv) so `ps aux` cannot leak them.
  const apiUrl = process.env.DOKPLOY_API_URL;
  const apiKey = process.env.DOKPLOY_API_KEY;
  const githubToken = process.env.GITHUB_TOKEN;

  const { project: projectName, app: appName, domain } = parseDeployArgs(process.argv.slice(2));

  if (!apiUrl || !apiKey || !projectName || !appName || !githubToken) {
    console.error(
      'Usage: node deploy.js --project <PROJECT_NAME> --app <APP_NAME> [--domain <DOMAIN>]\n' +
      '  (bare positionals also accepted: node deploy.js <PROJECT_NAME> <APP_NAME> [DOMAIN])\n' +
      '  Secrets are read ONLY from the environment (never argv, to avoid `ps aux` leakage):\n' +
      '    DOKPLOY_API_URL, DOKPLOY_API_KEY, GITHUB_TOKEN (export these in ~/.bashrc).\n' +
      '  HOSTINGER_API_TOKEN is optional (read straight from the environment for DNS automation).'
    );
    process.exit(1);
  }

  const baseUrl = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;
  const { fetchDokploy, fetchGitHub } = makeFetchers({ baseUrl, apiKey, githubToken });
  const hostingerToken = process.env.HOSTINGER_API_TOKEN;

  // M1 DRY: Hostinger A-record via lib/hostinger.configureDnsRecord (keep dns.lookup for server IP).
  async function configureHostingerDNS(fullDomain) {
    if (!hostingerToken || !fullDomain) return;
    try {
      const apiHost = new URL(apiUrl).hostname;
      const { address: serverIp } = await lookup(apiHost);
      await configureDnsRecord({ fullDomain, type: 'A', target: serverIp, hostingerToken });
    } catch (e) {
      console.warn(`⚠️ Hostinger DNS configuration skipped due to error: ${e.message}`);
    }
  }

  async function updateComposeEnv(composeId, updates) {
    const currentCompose = await fetchDokploy(`/compose.one?composeId=${composeId}`);
    const nextEnv = mergeEnvStringVerbatim(currentCompose.env || '', updates);
    await fetchDokploy('/compose.update', 'POST', { composeId, env: nextEnv });
    return parseEnvString(nextEnv);
  }

  async function deleteDomain(domainId) {
    return fetchDokploy('/domain.delete', 'POST', { domainId });
  }

  async function cleanupComposeDomains(composeId, desiredHosts = []) {
    const currentCompose = await fetchDokploy(`/compose.one?composeId=${composeId}`);
    const deletions = selectDomainsToDelete(currentCompose.domains || [], desiredHosts);
    for (const d of deletions) {
      try { await deleteDomain(d.domainId); console.log(`🧹 Removed compose domain ${d.host}`); }
      catch (error) { console.warn(`⚠️ Failed to remove compose domain ${d.host}: ${error.message}`); }
    }
  }

  async function cleanupApplicationDomains(applicationId, desiredHosts = []) {
    const currentApplication = await fetchDokploy(`/application.one?applicationId=${applicationId}`);
    const deletions = selectDomainsToDelete(currentApplication.domains || [], desiredHosts);
    for (const d of deletions) {
      try { await deleteDomain(d.domainId); console.log(`🧹 Removed application domain ${d.host}`); }
      catch (error) { console.warn(`⚠️ Failed to remove application domain ${d.host}: ${error.message}`); }
    }
  }

  async function getDokployGithubProvider() {
    const providers = await fetchDokploy('/github.githubProviders');
    if (!Array.isArray(providers) || providers.length === 0) return null;
    return providers[0];
  }

  async function configureApplicationGithubProvider({
    applicationId, githubId, owner, repository, branch, buildPath = '/', enableSubmodules = false,
  }) {
    await fetchDokploy('/application.saveGithubProvider', 'POST', {
      applicationId, githubId, owner, repository, branch, buildPath, enableSubmodules, triggerType: 'push',
    });
  }

  try {
    console.log(`🚀 Starting full-stack zero-human deployment for ${appName} in project ${projectName}`);

    // --- 1. GITHUB REPOSITORY CREATION & PUSH ---
    console.log('🐙 Checking/Creating GitHub Repository...');
    const user = await fetchGitHub('/user');
    const githubUsername = user.login;
    const repoUrl = `git@github.com:${githubUsername}/${appName}.git`;
    const repoOwner = githubUsername;
    const repoName = appName;

    try {
      await fetchGitHub(`/repos/${githubUsername}/${appName}`);
      console.log(`✅ GitHub repository ${githubUsername}/${appName} already exists.`);
    } catch (e) {
      if (e.message.includes('404')) {
        console.log(`📁 Creating new private GitHub repository: ${appName}...`);
        await fetchGitHub('/user/repos', 'POST', {
          name: appName,
          private: true,
          description: `Auto-generated repository for ${appName}`,
        });
        console.log('✅ GitHub repository created successfully.');
      } else {
        throw e;
      }
    }

    console.log('💻 Pushing local code to GitHub via SSH...');
    if (!REPO_URL_RE.test(repoUrl)) throw new Error(`refusing unsafe repoUrl: ${repoUrl}`);

    // S1: never `git add .` until the target project ignores secrets (and abort if a
    // stray, unignored .env* would be staged).
    ensureGitignoreSafety(process.cwd());

    const ALLOW_FORCE_PUSH = process.env.SC_ALLOW_FORCE_PUSH === '1';
    // COR-1: compute the current branch exactly once and reuse it for BOTH the push and
    // the later Dokploy provider/customGit binding (no second `git branch --show-current`).
    let branch = 'main';
    try {
      const git = (gitArgs) => execFileSync('git', gitArgs, { stdio: 'ignore' });
      // Clear local build cache to avoid stale URLs
      if (fs.existsSync(path.join(process.cwd(), '.next'))) {
        console.log('🧹 Clearing local .next build cache...');
        fs.rmSync(path.join(process.cwd(), '.next'), { recursive: true, force: true });
      }

      // gitOut: capture stdout (status 0 only) — returns '' if git errors.
      const gitOut = (gitArgs) => {
        try { return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim(); }
        catch { return ''; }
      };

      git(['config', '--global', 'init.defaultBranch', 'main']);
      const isExistingRepo = gitOut(['rev-parse', '--is-inside-work-tree']) === 'true';
      if (!isExistingRepo) git(['init']);

      // LOCAL-ORIGIN-HIJACK: on a pre-existing repo, blindly removing `origin` silently
      // rewrites the user's real remote. Refuse unless explicitly allowed; when allowed,
      // log the old URL so the rewrite is visible. On a fresh `git init` there is no origin.
      const existingOrigin = gitOut(['remote', 'get-url', 'origin']);
      if (existingOrigin && existingOrigin !== repoUrl) {
        if (process.env.SC_ALLOW_REMOTE_REWRITE !== '1') {
          throw new Error(
            `Refusing to rewrite existing git origin (${existingOrigin}) to ${repoUrl}. ` +
            `This is a destructive change to your local repo. Set SC_ALLOW_REMOTE_REWRITE=1 ` +
            `to override, or run from a fresh checkout.`,
          );
        }
        console.warn(`⚠️ Rewriting local origin: ${existingOrigin} → ${repoUrl} (SC_ALLOW_REMOTE_REWRITE=1).`);
      }
      try { git(['remote', 'remove', 'origin']); } catch { /* no existing origin — fine */ }
      git(['remote', 'add', 'origin', repoUrl]);

      // NESTED-DOTENV: now that we're inside a repo, ask git (check-ignore) tree-wide so a
      // nested apps/*/.env or convex/.env.local can't be staged by the `git add .` below.
      scanNestedDotenvLeaks(process.cwd());

      git(['add', '.']);
      // COMMIT-ERROR-SWALLOWED: only tolerate the genuine 'nothing to commit' case
      // (clean staged tree). Any other commit failure — missing git identity, a failing
      // pre-commit hook — is surfaced loudly instead of silently pushing the wrong thing.
      const stagedEmpty = gitOut(['status', '--porcelain']) === '';
      if (!stagedEmpty) {
        try {
          git(['commit', '-m', 'Auto-deploy commit']);
        } catch (e) {
          throw new Error(
            `git commit failed (not 'nothing to commit'). Check your git identity ` +
            `(user.name/user.email) and any pre-commit hooks. Original: ${e.message}`,
          );
        }
      } else {
        console.log('ℹ️ Nothing new to commit; reusing existing HEAD.');
      }

      branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() || 'main';

      const pushArgs = ['push', '-u', 'origin', branch];
      if (ALLOW_FORCE_PUSH) pushArgs.push('--force');
      git(pushArgs);
      console.log(`✅ Code pushed to ${repoUrl} on branch ${branch}.`);
    } catch (error) {
      console.error('❌ Git push failed. Ensure your local SSH keys are configured for GitHub.');
      throw error;
    }

    // --- 2. DOKPLOY PROJECT CREATION ---
    console.log('🔍 Fetching Dokploy projects...');
    const projects = await fetchDokploy('/project.all');
    let project = projects.find(p => p.name === projectName);

    if (!project) {
      console.log(`📁 Project '${projectName}' not found on Dokploy. Creating...`);
      await fetchDokploy('/project.create', 'POST', { name: projectName });
      const updatedProjects = await fetchDokploy('/project.all');
      project = updatedProjects.find(p => p.name === projectName);
      if (!project) throw new Error('Failed to retrieve created Dokploy project.');
    }

    const environment = project.environments?.[0];
    const envId = environment?.environmentId;
    if (!envId) {
      throw new Error(`No environments found for project ${projectName}`);
    }
    // SECURITY: never persist the PAT in a URL into Dokploy (customGitUrl is stored plaintext).
    const publicGitUrl = `https://github.com/${repoOwner}/${repoName}.git`;

    const hasDockerCompose = fs.existsSync(path.join(process.cwd(), 'docker-compose.yml'));
    const hasDockerfile = fs.existsSync(path.join(process.cwd(), 'Dockerfile'));

    // R4: warn if nothing will be deployed to Dokploy (GitHub push already happened).
    if (!hasDockerCompose && !hasDockerfile) {
      console.warn(
        '\n⚠️ WARNING: Neither docker-compose.yml nor Dockerfile found in ' +
        `${process.cwd()}. Nothing was deployed to Dokploy — only the GitHub push happened. ` +
        'Add a Dockerfile (frontend) and/or docker-compose.yml (self-hosted Convex) to enable Dokploy deployment.'
      );
    }

    // --- 3. DOKPLOY COMPOSE DEPLOYMENT (For Self-Hosted DB) ---
    if (hasDockerCompose) {
      const composeAppName = `${appName}-db`;
      console.log(`\n🐳 Docker Compose found. Setting up DB using Convex template: ${composeAppName}`);

      let composeApp = project.environments[0]?.compose?.find(c => c.name === composeAppName);

      if (!composeApp) {
        console.log(`📦 Compose App '${composeAppName}' not found. Deploying from Convex template...`);
        try {
          const deployTplRes = await fetchDokploy('/compose.deployTemplate', 'POST', {
            environmentId: envId,
            id: CONVEX_TEMPLATE_ID,
          });

          if (deployTplRes && deployTplRes.composeId) {
            await fetchDokploy('/compose.update', 'POST', {
              composeId: deployTplRes.composeId,
              name: composeAppName,
            });
            const updatedProjects2 = await fetchDokploy('/project.all');
            const p2 = updatedProjects2.find(p => p.name === projectName);
            composeApp = p2.environments[0]?.compose?.find(c => c.name === composeAppName);
          }
        } catch (e) {
          console.error('Failed to deploy Convex template.', e.message);
        }
      } else {
        console.log(`📦 Compose App '${composeAppName}' already exists (ID: ${composeApp.composeId}).`);
      }

      if (composeApp) {
        let apiDomain = null;
        let dashDomain = null;
        let siteDomain = null;

        const currentCompose = await fetchDokploy(`/compose.one?composeId=${composeApp.composeId}`);
        // Verbatim parse for the compose round-trip (see M1 NOTE).
        const currentComposeVars = parseEnvComposeVerbatim(currentCompose.env || '');
        const instanceSecret = currentComposeVars.INSTANCE_SECRET || crypto.randomBytes(32).toString('hex');

        if (currentComposeVars.CONVEX_ADMIN_KEY) {
          project.tempAdminKey = currentComposeVars.CONVEX_ADMIN_KEY;
        }

        if (domain) {
          apiDomain = `api-${domain}`;
          dashDomain = `dash-${domain}`;
          siteDomain = `site-${domain}`;

          console.log(`\n🌐 Setting up backend domains: ${apiDomain}, ${dashDomain}, ${siteDomain}`);

          // 1. Hostinger DNS
          await configureHostingerDNS(apiDomain);
          await configureHostingerDNS(dashDomain);
          await configureHostingerDNS(siteDomain);

          // 2. Create Dokploy Domains
          const backendDomains = [
            { host: apiDomain, port: BACKEND_PORTS.api, serviceName: 'backend' },
            { host: siteDomain, port: BACKEND_PORTS.site, serviceName: 'backend' },
            { host: dashDomain, port: BACKEND_PORTS.dash, serviceName: 'dashboard' },
          ];

          for (const backendDomain of backendDomains) {
            try {
              await fetchDokploy('/domain.create', 'POST', {
                composeId: composeApp.composeId,
                host: backendDomain.host,
                port: backendDomain.port,
                serviceName: backendDomain.serviceName,
                https: true,
                certificateType: 'letsencrypt',
              });
            } catch (e) {
              console.warn(`⚠️ Domain ${backendDomain.host} may already exist or Dokploy rejected it. Skipping.`);
            }
          }

          await cleanupComposeDomains(composeApp.composeId, backendDomains.map((entry) => entry.host));

          console.log('✅ Backend domain configuration checked in Dokploy.');
          console.log('\n🔑 IMPORTANT: To deploy your Convex schema manually if needed, SSH into your Dokploy server and run:');
          console.log(`docker exec <your_compose_project>${BACKEND_CONTAINER_SUFFIX} ./generate_admin_key.sh`);
          console.log(`Then run locally (secrets via env, never on argv):\n  CONVEX_SELF_HOSTED_URL=https://${apiDomain} CONVEX_SELF_HOSTED_ADMIN_KEY="<the_generated_key>" npx convex deploy\n`);
        }

        const composeEnvUpdates = {
          INSTANCE_SECRET: instanceSecret,
          INSTANCE_NAME: appName,
        };

        if (apiDomain) {
          composeEnvUpdates.NEXT_PUBLIC_DEPLOYMENT_URL = `https://${apiDomain}`;
          composeEnvUpdates.CONVEX_CLOUD_ORIGIN = `https://${apiDomain}`;
        }

        if (siteDomain) {
          composeEnvUpdates.CONVEX_SITE_ORIGIN = `https://${siteDomain}`;
        }

        await updateComposeEnv(composeApp.composeId, composeEnvUpdates);
        console.log('✅ Compose environment synchronized without rotating existing Convex secrets.');

        console.log('🚀 Triggering Compose deployment...');
        await fetchDokploy('/compose.deploy', 'POST', { composeId: composeApp.composeId });
        console.log('⏳ Compose deployment started.');

        // --- STEP 3: AUTOMATIC SCHEMA DEPLOYMENT ---
        if (fs.existsSync(path.join(process.cwd(), 'convex/schema.ts'))) {
          console.log('🔑 Convex detected. Polling backend health for admin-key generation...');

          let adminKey = project.tempAdminKey;

          try {
            const latestCompose = await fetchDokploy(`/compose.one?composeId=${composeApp.composeId}`);
            const composeRuntimeName = latestCompose.appName || composeApp.appName;
            if (!composeRuntimeName) {
              throw new Error('Compose runtime name unavailable for admin key generation.');
            }
            const containerName = `${composeRuntimeName}${BACKEND_CONTAINER_SUFFIX}`;

            // R2 + DRY-1: keep the retry/backoff poll cadence here, but delegate the actual
            // dockerExec(generate_admin_key.sh) + extractAdminKey to lib/convex.generateAdminKey
            // so admin-key extraction lives in exactly one place.
            if (!adminKey) {
              let elapsedMs = 0;
              for (let attempt = 1; attempt <= ADMIN_KEY_ATTEMPTS; attempt++) {
                try {
                  adminKey = generateAdminKey({ containerName });
                  if (adminKey) break;
                  throw new Error('admin-key generation returned an empty value');
                } catch (genErr) {
                  if (attempt === ADMIN_KEY_ATTEMPTS) throw genErr;
                  // R2: cap each backoff so a slow boot can't stall ~26 min with no per-attempt
                  // cap. Log cumulative elapsed so a stuck backend is visible, not silently hung.
                  const backoff = Math.min(ADMIN_KEY_BACKOFF_BASE_MS * 2 ** (attempt - 1), ADMIN_KEY_BACKOFF_MAX_MS);
                  elapsedMs += backoff;
                  console.log(`⏳ Backend not ready (attempt ${attempt}/${ADMIN_KEY_ATTEMPTS}, ~${Math.round(elapsedMs / 1000)}s elapsed): ${genErr.message}. Retrying in ${backoff}ms...`);
                  await delay(backoff);
                }
              }
            }

            if (!adminKey) {
              throw new Error('Convex admin key generation returned an empty value.');
            }

            await updateComposeEnv(composeApp.composeId, { CONVEX_ADMIN_KEY: adminKey });
            project.tempAdminKey = adminKey;
            console.log('✅ Admin Key saved to Compose env.');
            console.log(`\n🔑 CONVEX_ADMIN_KEY generated (masked): ${maskSecret(adminKey)}`);
          } catch (err) {
            console.warn(`⚠️ Automatic admin-key generation failed: ${err.message}`);
          }

          if (adminKey && apiDomain) {
            try {
              // DRY-1: deploySchema waits for valid TLS then runs the no-shell convex deploy
              // with the admin key via env (CONVEX_SELF_HOSTED_ADMIN_KEY) — one shared impl.
              console.log('📤 Waiting for valid TLS on backend, then pushing Convex schema...');
              await deploySchema({ apiDomain, adminKey });
              console.log('✅ Convex schema deployed successfully.');
            } catch (err) {
              console.warn(`⚠️ Automatic schema deployment failed: ${err.message}`);
            }
          } else if (!apiDomain) {
            console.log('ℹ️ Skipping automatic Convex schema deploy because no backend domain was provided.');
          } else if (!adminKey) {
            console.log('ℹ️ Skipping automatic Convex schema deploy because admin-key generation did not complete.');
          }
        }
      }
    }

    // --- 4. DOKPLOY APPLICATION DEPLOYMENT (For Frontend) ---
    if (hasDockerfile) {
      console.log(`\n📄 Dockerfile found. Setting up standard Application: ${appName}`);
      let app = project.environments[0]?.applications?.find(a => a.name === appName);

      if (!app) {
        console.log(`📦 Application '${appName}' not found. Creating...`);
        try {
          await fetchDokploy('/application.create', 'POST', {
            name: appName,
            appName,
            environmentId: envId,
          });
          const updatedProjects3 = await fetchDokploy('/project.all');
          const p3 = updatedProjects3.find(p => p.name === projectName);
          app = p3.environments[0]?.applications?.find(a => a.name === appName);
        } catch (e) {
          console.error('Failed to create application.', e.message);
        }
      } else {
        console.log(`📦 Application '${appName}' already exists (ID: ${app.applicationId}). Updating...`);
      }

      if (app) {
        const appId = app.applicationId;

        console.log('⚙️ Configuring Dokploy application source...');
        try {
          // Frontend only needs the public Convex URL. NEVER bake the admin key into
          // image layers via env/buildArgs (it is a backend-only secret).
          let appEnv = '';
          if (domain) {
            const apiDomain = `api-${domain}`;
            appEnv = `NEXT_PUBLIC_CONVEX_URL=https://${apiDomain}`;
          }

          const githubProvider = await getDokployGithubProvider();

          if (githubProvider?.githubId) {
            console.log(`🔗 Binding Dokploy application to GitHub provider ${githubProvider.githubId}...`);
            await configureApplicationGithubProvider({
              applicationId: appId,
              githubId: githubProvider.githubId,
              owner: repoOwner,
              repository: repoName,
              branch,
            });

            await fetchDokploy('/application.update', 'POST', {
              applicationId: appId,
              sourceType: 'github',
              githubId: githubProvider.githubId,
              owner: repoOwner,
              repository: repoName,
              branch,
              buildPath: '/',
              buildType: 'dockerfile',
              dockerfile: 'Dockerfile',
              triggerType: 'push',
              autoDeploy: true,
              customGitUrl: null,
              customGitBranch: null,
              customGitBuildPath: null,
              customGitSSHKeyId: null,
              env: appEnv,
              buildArgs: appEnv,
            });
            console.log('✅ Dokploy application updated successfully with GitHub provider.');
          } else {
            console.log('ℹ️ No Dokploy GitHub provider found. Falling back to raw Git source (no embedded PAT).');
            console.warn('⚠️ Without a Dokploy GitHub provider, private repos need an SSH deploy key or GitHub App in Dokploy. Not persisting a PAT-in-URL.');
            await fetchDokploy('/application.update', 'POST', {
              applicationId: appId,
              customGitUrl: publicGitUrl,
              customGitBranch: branch,
              buildType: 'dockerfile',
              dockerfile: 'Dockerfile',
              triggerType: 'push',
              autoDeploy: true,
              sourceType: 'git',
              env: appEnv,
              buildArgs: appEnv,
            });
            console.log('✅ Dokploy application updated with raw Git source (auth handled by Dokploy provider/SSH key, not URL).');
          }
        } catch (e) {
          console.warn(`⚠️ Warning during application update: ${e.message}`);
        }

        if (domain) {
          console.log(`🌐 Setting up domain ${domain}...`);
          // FIRST: Check and configure Hostinger DNS
          await configureHostingerDNS(domain);

          try {
            await fetchDokploy('/domain.create', 'POST', {
              applicationId: appId,
              host: domain,
              https: true,
              certificateType: 'letsencrypt',
            });
            console.log(`✅ Domain ${domain} created.`);
          } catch (e) {
            console.warn('⚠️ Note on domain creation: Domain may already exist or API rejected it. Skipping.');
          }

          await cleanupApplicationDomains(appId, [domain]);
        }

        console.log('🚀 Triggering Application deployment...');
        await fetchDokploy('/application.deploy', 'POST', { applicationId: appId });
        console.log('⏳ Waiting for Application deployment to finish... (this may take a minute)');

        let isFinished = false;
        let status = 'running';
        let attempts = 0;
        let hadSuccessfulRead = false; // COR-2: distinguish 'slow build' from 'API down'.

        while (!isFinished && attempts < DEPLOY_POLL_MAX_ATTEMPTS) {
          await delay(DEPLOY_POLL_INTERVAL_MS);
          attempts++;
          try {
            const currentProjects = await fetchDokploy('/project.all');
            const p = currentProjects.find(p => p.name === projectName);
            const e = p.environments[0];
            const a = e.applications.find(a => a.name === appName);
            status = a.applicationStatus;
            hadSuccessfulRead = true;

            if (status === 'done' || status === 'error') {
              isFinished = true;
            } else {
              process.stdout.write('.'); // loading indicator
            }
          } catch (e) {
            // ignore network blips during polling
          }
        }

        console.log(''); // newline
        if (status === 'done') {
          // DEPLOY-POLL-NO-FINAL-VERIFY: 'done' in Dokploy != reachable (DNS/TLS may not have
          // propagated). When a domain is set, do a best-effort liveness GET and downgrade the
          // success message to a warning if the URL doesn't respond. Reuses probeBackend.
          let reachable = true;
          if (domain) {
            try {
              const probe = await probeBackend({ siteDomain: domain });
              const root = probe.site_root;
              reachable = !!(root && root.ok);
              if (!reachable) {
                const detail = root && root.error ? root.error : `HTTP ${root && root.status}`;
                console.warn(
                  `⚠️ Dokploy reports build 'done' but https://${domain} did not respond OK (${detail}). ` +
                  `DNS/TLS may still be propagating — re-check in a few minutes.`,
                );
              }
            } catch (e) {
              reachable = false;
              console.warn(`⚠️ Liveness probe of https://${domain} failed: ${e.message}. DNS/TLS may still be propagating.`);
            }
          }
          if (reachable) {
            console.log(`🎉 Deployment SUCCESSFUL! App should be live at https://${domain || appName}.`);
          } else {
            console.log(`✅ Deployment built (status 'done') but https://${domain} is not yet reachable — verify shortly.`);
          }
        } else if (!isFinished && !hadSuccessfulRead) {
          // COR-2: we never once read a status — Dokploy API was unreachable the whole time.
          // This is a different failure from a genuinely slow-but-healthy build.
          const minutes = Math.round((DEPLOY_POLL_MAX_ATTEMPTS * DEPLOY_POLL_INTERVAL_MS) / 60000);
          console.error(`❌ Could not read deploy status after ${minutes} min — Dokploy API unreachable (every /project.all poll failed). The build may still be running, but its status is unknown.`);
          console.error(`\n⚠️  Verify the Dokploy host (${apiUrl}) is reachable, then check the Dashboard -> '${projectName}' project -> '${appName}' -> 'Deployments'.`);
        } else if (!isFinished && status === 'running') {
          // R3: distinct timeout message vs. build 'error'.
          const minutes = Math.round((DEPLOY_POLL_MAX_ATTEMPTS * DEPLOY_POLL_INTERVAL_MS) / 60000);
          console.error(`⏱️ Deployment timed out after ${minutes} min: status still 'running' (build may still be in progress).`);
          console.error(`\n⚠️  DOKPLOY LOGS UNAVAILABLE VIA API. Please log in to your Dokploy Dashboard -> '${projectName}' project -> '${appName}' -> 'Deployments' to check progress.`);
        } else {
          console.error(`❌ Deployment ended with status: ${status}.`);
          console.error(`\n⚠️  DOKPLOY LOGS UNAVAILABLE VIA API. Please log in to your Dokploy Dashboard -> '${projectName}' project -> '${appName}' -> 'Deployments' to see the exact build error.`);
        }
      }
    }

    console.log('\n✅ All setup actions completed.');
  } catch (error) {
    console.error('❌ Process failed:', error.message);
    process.exit(1);
  }
}

// Verbatim compose env parser (see M1 NOTE) — used only for the Dokploy compose
// round-trip where quote-stripping would risk corrupting stored secret values.
// DRY-2: thin wrapper over the shared parseEnvVerbatimOrdered (returns just the map).
function parseEnvComposeVerbatim(envString = '') {
  return parseEnvVerbatimOrdered(envString).env;
}

// M3: entry guard so `require()` (tests) does not execute a deploy.
if (require.main === module) {
  run();
}

// M3: export pure helpers for tests. parseEnvString/mergeEnvString are re-exported
// from lib/env (DRY). The verbatim compose variants are also exposed for the
// compose round-trip safety path.
module.exports = {
  parseEnvString,
  mergeEnvString,
  mergeEnvStringVerbatim,
  parseEnvComposeVerbatim,
  selectDomainsToDelete,
  extractAdminKey,
  maskSecret,
  ensureGitignoreSafety,
  scanNestedDotenvLeaks,
  isIgnoredByRules,
  isReincludedByNegation,
  scanRootSecretFiles,
  parseDeployArgs,
  REPO_URL_RE,
  run,
};
