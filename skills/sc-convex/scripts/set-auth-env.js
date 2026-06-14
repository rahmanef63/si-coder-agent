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
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    // JWKS is public (goes in .well-known) — safe to print.
    console.log('\nJWKS (public, safe to commit to frontend config):');
    console.log(changes.JWKS);
    // JWT_PRIVATE_KEY is secret — write to a 0600 file, do NOT print plaintext.
    const outPath = process.env.JWT_PRIVATE_KEY_OUT
      || path.join(os.homedir(), `.si-coder-jwt-private-${domain}.pem`);
    fs.writeFileSync(outPath, changes.JWT_PRIVATE_KEY, { mode: 0o600 });
    try { fs.chmodSync(outPath, 0o600); } catch {}
    console.log(`\n🔐 JWT_PRIVATE_KEY written to ${outPath} (mode 600).`);
    console.log('   KEEP THIS FILE. Lost = cannot rotate without re-issuing all tokens.');
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
