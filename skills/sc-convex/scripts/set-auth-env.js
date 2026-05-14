#!/usr/bin/env node
// set-auth-env.js — Set JWT_PRIVATE_KEY + JWKS on self-hosted Convex backend via admin REST API.
// CLI `npx convex env set` breaks on PEM values (-- parsed as flag), so use the REST endpoint directly.
const path = require('path');
const { generateAuthKeys, setBackendEnv } = require(path.resolve(__dirname, '../../../lib/convex'));

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
  const domain = args.domain;
  const adminKey = args['admin-key'] || process.env.CONVEX_ADMIN_KEY;
  const doGenerate = !!args.generate;

  if (!domain || !adminKey) {
    console.error('Usage: set-auth-env.js --domain <root.tld> --admin-key KEY [--generate]');
    process.exit(1);
  }

  const apiDomain = `api-${domain}`;
  let changes = {};

  if (doGenerate) {
    const keys = generateAuthKeys();
    changes.JWT_PRIVATE_KEY = keys.JWT_PRIVATE_KEY;
    changes.JWKS = keys.JWKS;
    console.log('🔐 Generated fresh RS256 keypair');
  } else {
    if (!process.env.JWT_PRIVATE_KEY || !process.env.JWKS) {
      console.error('No --generate and no JWT_PRIVATE_KEY/JWKS in env');
      process.exit(1);
    }
    changes.JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY;
    changes.JWKS = process.env.JWKS;
  }

  await setBackendEnv({ apiDomain, adminKey, changes });
  console.log(`✅ JWT_PRIVATE_KEY + JWKS pushed to ${apiDomain}`);
  if (doGenerate) {
    console.log('\nKEEP THESE LOCALLY (lost = unable to rotate without re-issuing all tokens):');
    console.log('JWKS:', changes.JWKS);
    console.log('JWT_PRIVATE_KEY: [printed once — copy now]');
    console.log(changes.JWT_PRIVATE_KEY);
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
