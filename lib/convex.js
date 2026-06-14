// lib/convex.js — Convex self-hosted helpers (admin key, schema deploy, JWT env)
const crypto = require('crypto');
const { run, dockerExec } = require('./proc');
const { waitForValidTls } = require('./tls');

function extractAdminKey(output = '') {
  const lines = output
    .split(/\r?\n/)
    .map(l => l.replace(/^Admin key:\s*/, '').trim())
    .filter(Boolean);
  return lines.find(l => l.includes('|')) || lines[lines.length - 1] || '';
}

function generateAdminKey({ containerName }) {
  if (!containerName) throw new Error('containerName required');
  const raw = dockerExec(containerName, ['./generate_admin_key.sh']);
  const adminKey = extractAdminKey(raw);
  if (!adminKey) throw new Error('admin-key extraction returned empty');
  return adminKey;
}

async function deploySchema({ apiDomain, adminKey, cwd = process.cwd() }) {
  if (!apiDomain || !adminKey) throw new Error('apiDomain + adminKey required');
  // Wait for a VALID TLS cert instead of disabling verification while shipping the admin key.
  await waitForValidTls(apiDomain);
  // Admin key passed via env (CONVEX_SELF_HOSTED_ADMIN_KEY), never on argv / in a shell string.
  run('npx', ['convex', 'deploy', '--url', `https://${apiDomain}`], {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey },
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
async function setBackendEnv({ apiDomain, adminKey, changes }) {
  if (!apiDomain || !adminKey) throw new Error('apiDomain + adminKey required');
  const payload = { changes: Object.entries(changes).map(([name, value]) => ({ name, value })) };
  const res = await fetch(`https://${apiDomain}/api/update_environment_variables`, {
    method: 'POST',
    headers: { Authorization: `Convex ${adminKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Convex env set ${res.status}: ${text}`);
  return text;
}

// Probe api-/site-/dash- subdomains for liveness.
async function probeBackend({ apiDomain, siteDomain, dashDomain, adminKey } = {}) {
  const results = {};
  async function check(label, url, init) {
    if (!url) return;
    try {
      const r = await fetch(url, init);
      results[label] = { url, status: r.status, ok: r.ok };
    } catch (e) {
      results[label] = { url, error: e.message };
    }
  }
  if (apiDomain) {
    await check('api_version', `https://${apiDomain}/version`);
    await check('api_jwks', `https://${apiDomain}/.well-known/jwks.json`);
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
  generateAdminKey,
  deploySchema,
  generateAuthKeys,
  setBackendEnv,
  probeBackend,
};
