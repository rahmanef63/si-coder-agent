// lib/convex.js — Convex self-hosted helpers (admin key, schema deploy, JWT env)
const crypto = require('crypto');
const { run, dockerExec } = require('./proc');
const { waitForValidTls } = require('./tls');

// Self-hosted Convex admin keys are `<instance-name>|<hex>` (optionally an extra
// version-tag segment like `<name>|<tag>|<hex>`). Match that shape exactly so noisy
// container output (warnings/logs with no key) does NOT fall through to an arbitrary
// last line — a bogus 'key' would otherwise be propagated into Dokploy env + convex deploy.
// Final segment widened from hex-only to base64/base64url-bodied secrets ([A-Za-z0-9+/_=.-]);
// the leading `<name>(\|<seg>)*\|` structure is preserved so prose/log noise still fails to match.
// Name segments allow ':' so Convex deployment-style instance names (e.g. `prod:proj-123`) parse.
const ADMIN_KEY_RE = /^[\w.:-]+(?:\|[\w.:-]+)*\|[A-Za-z0-9+/_=.-]+$/;

function extractAdminKey(output = '') {
  const lines = output
    .split(/\r?\n/)
    .map(l => l.replace(/^Admin key:\s*/, '').trim())
    .filter(Boolean);
  const key = lines.find(l => ADMIN_KEY_RE.test(l));
  if (!key) {
    throw new Error(
      'admin-key extraction: no line matched the self-hosted key shape ' +
      '(<instance-name>|<hex>) in generate_admin_key.sh output',
    );
  }
  return key;
}

function generateAdminKey({ containerName }) {
  if (!containerName) throw new Error('containerName required');
  const raw = dockerExec(containerName, ['./generate_admin_key.sh']);
  // extractAdminKey throws if no line matches the self-hosted key shape.
  return extractAdminKey(raw);
}

// Preflight: the convex CLI must be resolvable FROM the target app (it is not a dep of
// si-coder-agent and node_modules/.bin/convex is absent here). On an offline/air-gapped
// runner npx would otherwise fail late with a confusing fetch error mid-deploy; surface
// an upfront, actionable message instead.
function assertConvexResolvable(cwd) {
  try {
    require.resolve('convex/package.json', { paths: [cwd] });
  } catch {
    throw new Error(
      `convex CLI not found in ${cwd}; run 'npm install' in the target app ` +
      `(convex is a project dependency, not bundled with si-coder-agent).`,
    );
  }
}

async function deploySchema({ apiDomain, adminKey, cwd = process.cwd() }) {
  if (!apiDomain || !adminKey) throw new Error('apiDomain + adminKey required');
  // Fail fast if convex isn't installed in the target app, before the TLS wait.
  assertConvexResolvable(cwd);
  // Wait for a VALID TLS cert instead of disabling verification while shipping the admin key.
  await waitForValidTls(apiDomain);
  // Backend URL + admin key are both passed via env — the convex CLI (v1.27+) resolves a
  // self-hosted backend from CONVEX_SELF_HOSTED_URL paired with CONVEX_SELF_HOSTED_ADMIN_KEY,
  // NOT the legacy `--url` flag (mixing the flag with only the env key can target the wrong
  // backend). Secrets stay off argv / out of any shell string.
  // `npx --yes` so a zero-human run can never hang on an "install convex?" prompt.
  run('npx', ['--yes', 'convex', 'deploy'], {
    stdio: 'inherit',
    cwd,
    env: {
      // NOTE: `...process.env` is inherited by the convex CLI child by design — npx/node
      // need the full PATH and tool env to resolve & run convex; we deliberately do NOT
      // allowlist here (a trimmed env risks breaking npx/PATH resolution on the runner).
      ...process.env,
      // Neutralize any Convex Cloud selectors the operator may have exported in this
      // shell — some convex CLI versions prefer them over CONVEX_SELF_HOSTED_URL and
      // would silently push the schema to the wrong (Cloud) backend.
      CONVEX_DEPLOYMENT: '',
      CONVEX_DEPLOY_KEY: '',
      CONVEX_SELF_HOSTED_URL: `https://${apiDomain}`,
      CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
    },
  });
}

// Generate RS256 keypair for @convex-dev/auth (PEM PKCS8 + JWKS)
function generateAuthKeys({ kid = 'convex-self-hosted-1' } = {}) {
  const { generateKeyPairSync, createPublicKey } = crypto;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  jwk.kid = kid;
  return {
    JWT_PRIVATE_KEY: privateKey,
    JWKS: JSON.stringify({ keys: [jwk] }),
  };
}

// Set env vars on a running self-hosted Convex backend via admin REST API.
// Use this (NOT `npx convex env set`) when the value contains PEM/`--` prefixes.
async function setBackendEnv({ apiDomain, adminKey, changes, timeoutMs = 10000 }) {
  if (!apiDomain || !adminKey) throw new Error('apiDomain + adminKey required');
  const payload = { changes: Object.entries(changes).map(([name, value]) => ({ name, value })) };
  // Bound the call so a hung backend can't stall a zero-human run (mirrors probeBackend).
  // Keep the timer armed across the body read: a backend that sends headers then stalls
  // the body must still hit the timeout, so .text() runs INSIDE the try (before clear).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${apiDomain}/api/update_environment_variables`, {
      method: 'POST',
      headers: { Authorization: `Convex ${adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Convex env set ${res.status}: ${text}`);
    return text;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Convex env set timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Probe api-/site-/dash- subdomains for liveness. Each request is bounded by a short
// timeout (default 10s) so a hung URL can't stall a zero-human run.
async function probeBackend({ apiDomain, siteDomain, dashDomain, adminKey, timeoutMs = 10000 } = {}) {
  const results = {};
  async function check(label, url, init = {}) {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...init, signal: controller.signal });
      results[label] = { url, status: r.status, ok: r.ok };
    } catch (e) {
      const msg = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message;
      results[label] = { url, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
  if (apiDomain) {
    await check('api_version', `https://${apiDomain}/version`);
    // @convex-dev/auth serves JWKS on the SITE host (site-<domain>), NOT the api-
    // host — self-hosted mirrors Cloud here. Probe it there; the label stays
    // `api_jwks` so callers (check-backend.js) consume it unchanged. When no
    // siteDomain was supplied the host isn't derivable, so leave it not-checked.
    if (siteDomain) await check('api_jwks', `https://${siteDomain}/.well-known/jwks.json`);
    if (adminKey) {
      await check('api_admin', `https://${apiDomain}/api/list_environment_variables`, {
        method: 'POST',
        headers: { Authorization: `Convex ${adminKey}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
    }
  }
  if (siteDomain) await check('site_root', `https://${siteDomain}`);
  if (dashDomain) await check('dash_root', `https://${dashDomain}`);
  return results;
}

module.exports = {
  extractAdminKey,
  ADMIN_KEY_RE,
  generateAdminKey,
  assertConvexResolvable,
  deploySchema,
  generateAuthKeys,
  setBackendEnv,
  probeBackend,
};
