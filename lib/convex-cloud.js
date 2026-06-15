// lib/convex-cloud.js — Convex Cloud (managed) deploy helpers + probe
//
// HUMAN ONE-TIME SETUP (no headless Cloud API for these):
//   1. Create Convex team + project in the dashboard (or `npx convex dev` once interactively).
//   2. Generate a PRODUCTION deploy key: Dashboard -> project -> production deployment
//      -> Settings -> General -> Generate Production Deploy Key. Save as CONVEX_DEPLOY_KEY.
//      (Headless mint alternative if a logged-in CLI exists:
//         npx convex deployment token create ci-key --prod --save-env )
// After that, all deploys here are scriptable. NEVER log the deploy key.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseEnvString } = require('./env');

// Run the coupled build: `npx convex deploy --cmd <buildCmd>` so Convex Cloud deploys
// before the frontend build and injects the deployment URL into `urlEnvVar`.
// The deploy key is passed ONLY via env — never interpolated into the command string.
function deployCloud({
  deployKey,
  buildCmd = 'npm run build',
  urlEnvVar = 'NEXT_PUBLIC_CONVEX_URL',
  cwd = process.cwd(),
  message,
} = {}) {
  if (!deployKey) throw new Error('deployCloud needs deployKey');
  const args = ['convex', 'deploy', '--cmd', buildCmd, '--cmd-url-env-var-name', urlEnvVar];
  if (message) args.push('--message', message);
  execFileSync('npx', args, {
    env: { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
    stdio: 'inherit',
    cwd,
  });
  return { ok: true };
}

// Backend-only push (no coupled build) — used when Vercel runs the build itself.
function deployBackendOnly({ deployKey, cwd = process.cwd(), message } = {}) {
  if (!deployKey) throw new Error('deployBackendOnly needs deployKey');
  const args = ['convex', 'deploy', ...(message ? ['--message', message] : [])];
  execFileSync('npx', args, {
    env: { ...process.env, CONVEX_DEPLOY_KEY: deployKey },
    stdio: 'inherit',
    cwd,
  });
  return { ok: true };
}

// Best-effort derive the Cloud deployment URL from a deploy key.
// A prod key looks like `prod:qualified-jaguar-123|eyJ2...`.
// Caveat: this is best-effort; the canonical source of the URL is `--cmd` injection at
// build time. For preview keys the deployment name is branch-derived and NOT in the key,
// so return null for preview.
function deriveCloudUrl(deployKey) {
  if (!deployKey || typeof deployKey !== 'string') return null;
  const left = deployKey.split('|')[0];
  const colon = left.indexOf(':');
  if (colon === -1) return null;
  const prefix = left.slice(0, colon);
  const rest = left.slice(colon + 1);
  if (prefix !== 'prod') return null; // preview/project keys do not carry the deployment name
  const name = rest.trim();
  if (!name) return null;
  return `https://${name}.convex.cloud`;
}

// Read the URL injected into a local env file by a previous `npx convex dev`/coupled build.
function readInjectedUrl({ envFile = '.env.local', urlEnvVar = 'NEXT_PUBLIC_CONVEX_URL', cwd = process.cwd() } = {}) {
  try {
    const p = path.resolve(cwd, envFile);
    if (!fs.existsSync(p)) return null;
    const env = parseEnvString(fs.readFileSync(p, 'utf8'));
    return env[urlEnvVar] || null;
  } catch {
    return null;
  }
}

// Probe a Cloud deployment for liveness (mirrors convex.js probeBackend result shape).
// Each request is bounded by a short timeout (default 10s) so a hung Cloud endpoint
// can't stall check-cloud.js in the zero-human / CI flow (Node 22 fetch has no default).
async function probeCloud({ deploymentUrl, timeoutMs = 10000 } = {}) {
  const results = {};
  async function check(label, url) {
    if (!url) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: controller.signal });
      results[label] = { url, status: r.status, ok: r.ok };
    } catch (e) {
      const msg = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message;
      results[label] = { url, error: msg };
    } finally {
      clearTimeout(timer);
    }
  }
  if (deploymentUrl) {
    await check('version', `${deploymentUrl}/version`);
    await check('jwks', `${deploymentUrl}/.well-known/jwks.json`);
  }
  return results;
}

module.exports = { deployCloud, deployBackendOnly, deriveCloudUrl, readInjectedUrl, probeCloud };
