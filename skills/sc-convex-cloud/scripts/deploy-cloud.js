#!/usr/bin/env node
// deploy-cloud.js — Deploy a Convex Cloud (managed) deployment via CONVEX_DEPLOY_KEY.
// Coupled build (default) injects NEXT_PUBLIC_CONVEX_URL; --backend-only pushes backend alone.
// NEVER logs the deploy key — only the public NEXT_PUBLIC_CONVEX_URL.
const path = require('path');
const {
  deployCloud,
  deployBackendOnly,
  deriveCloudUrl,
  readInjectedUrl,
} = require(path.resolve(__dirname, '../../../lib/convex-cloud'));

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    }
  }
  return o;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildCmd = args['build-cmd'] || 'npm run build';
  const urlEnvVar = args['url-env'] || 'NEXT_PUBLIC_CONVEX_URL';
  const backendOnly = !!args['backend-only'];
  const message = typeof args.message === 'string' ? args.message : undefined;
  const cwd = typeof args.cwd === 'string' ? args.cwd : process.cwd();

  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey) { console.error('Missing CONVEX_DEPLOY_KEY in env'); process.exit(1); }

  if (!/^(prod|preview|project):/.test(deployKey)) {
    console.warn('⚠️ CONVEX_DEPLOY_KEY does not start with prod:/preview:/project: — may be invalid');
  }

  if (backendOnly) {
    console.log('🚀 Convex Cloud backend-only deploy...');
    deployBackendOnly({ deployKey, cwd, message });
  } else {
    console.log(`🚀 Convex Cloud coupled deploy (build: ${buildCmd}, url-env: ${urlEnvVar})...`);
    deployCloud({ deployKey, buildCmd, urlEnvVar, cwd, message });
  }

  const url = readInjectedUrl({ urlEnvVar, cwd }) || deriveCloudUrl(deployKey);
  if (url) console.log(`${urlEnvVar}=${url}`);
  else console.warn(`⚠️ could not resolve ${urlEnvVar} (preview key or no injected env) — read it from the build log`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
