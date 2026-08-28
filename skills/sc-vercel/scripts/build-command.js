'use strict';

// Resolve the Vercel build command without overriding a repository's own deploy
// contract. A repo-level vercel.json is authoritative for coupled production
// builds; only fall back to a generated Convex command when the repo has none.
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function usesBun(cwd, packageJson) {
  if (fs.existsSync(path.join(cwd, 'bun.lock')) || fs.existsSync(path.join(cwd, 'bun.lockb'))) return true;
  const manager = typeof packageJson?.packageManager === 'string' ? packageJson.packageManager : '';
  return manager.startsWith('bun@') || Boolean(packageJson?.engines?.bun);
}

function resolveBuildCommand({ cwd = process.cwd(), decoupled = false, explicit } = {}) {
  if (typeof explicit === 'string' && explicit.trim()) {
    return { command: explicit.trim(), source: '--build-command' };
  }

  // --decoupled explicitly means “do not deploy Convex in this Vercel build”,
  // so a repo command that may couple backend deployment must not override it.
  if (!decoupled) {
    const vercel = readJson(path.join(cwd, 'vercel.json'));
    if (typeof vercel?.buildCommand === 'string' && vercel.buildCommand.trim()) {
      return { command: vercel.buildCommand.trim(), source: 'vercel.json' };
    }
  }

  const packageJson = readJson(path.join(cwd, 'package.json')) || {};
  const bun = usesBun(cwd, packageJson);
  const appBuild = bun ? 'bun run build' : 'npm run build';
  if (decoupled) return { command: appBuild, source: bun ? 'bun fallback' : 'npm fallback' };

  const convex = bun ? 'bunx convex deploy' : 'npx convex deploy';
  return {
    command: `${convex} --cmd '${appBuild}' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`,
    source: bun ? 'bun fallback' : 'npm fallback',
  };
}

module.exports = { resolveBuildCommand };
