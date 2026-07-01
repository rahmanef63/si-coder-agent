// onboarding-domains.js — Single source of truth for the onboarding domain
// registry, per-key validators, and the ~/.bashrc detection helper.
// Required by both scripts/scan-env.js and bin/onboard.js so the domain
// registry, CLI menu, and docs never drift.
const path = require('path');
const { readShellRc, parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));

const DOMAIN_VARS = {
  github:    { required: ['GITHUB_TOKEN'], optional: [] },
  dokploy:   { required: ['DOKPLOY_API_URL', 'DOKPLOY_API_KEY'], optional: [] },
  convex:    { required: [], optional: ['CONVEX_ADMIN_KEY'] },
  hostinger: { required: [], optional: ['HOSTINGER_API_TOKEN'] },
  // STUB domains — vars pre-registered so /sc-onboarding can collect them.
  // Scripts for these /sc-* skills are not implemented yet (exit code 2).
  cf:        { required: [], optional: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] },
  stripe:    { required: [], optional: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  resend:    { required: [], optional: ['RESEND_API_KEY', 'RESEND_FROM_DOMAIN'] },
  clerk:     { required: [], optional: ['CLERK_SECRET_KEY', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CLERK_FRONTEND_API_URL'] },
  vercel:        { required: ['VERCEL_TOKEN'], optional: ['VERCEL_TEAM_ID'] },
  'convex-cloud':{ required: ['CONVEX_DEPLOY_KEY'], optional: ['CONVEX_DEPLOYMENT'] },
  supabase:  { required: [], optional: ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_ORG_ID'] },
  sync:      { required: ['SYNC_ROLE', 'SYNC_VPS_TS_ADDR', 'SYNC_LOCAL_TS_ADDR'], optional: ['SYNC_REMOTE_USER', 'SYNC_REMOTE_PATH'] },
};

const VALIDATORS = {
  GITHUB_TOKEN: v => (v.startsWith('ghp_') || v.startsWith('github_pat_')) && v.length >= 40,
  DOKPLOY_API_URL: v => v.startsWith('https://'),
  DOKPLOY_API_KEY: v => v.length >= 24,
  HOSTINGER_API_TOKEN: v => v.length >= 32,
  CONVEX_ADMIN_KEY: v => v.includes('|') && v.length >= 32,
  CONVEX_DEPLOY_KEY: v => v.includes('|') && /^(prod|preview|project):/.test(v) && v.length >= 32,
  CONVEX_DEPLOYMENT: v => v.length >= 6, // e.g. "prod:happy-animal-123" or a deployment name
  CLOUDFLARE_API_TOKEN: v => v.length >= 32,
  CLOUDFLARE_ACCOUNT_ID: v => v.length >= 16,
  STRIPE_SECRET_KEY: v => /^sk_(test|live)_/.test(v),
  STRIPE_PUBLISHABLE_KEY: v => /^pk_(test|live)_/.test(v),
  STRIPE_WEBHOOK_SECRET: v => v.startsWith('whsec_'),
  RESEND_API_KEY: v => v.startsWith('re_'),
  RESEND_FROM_DOMAIN: v => /\./.test(v),
  CLERK_SECRET_KEY: v => /^sk_(test|live)_/.test(v),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: v => /^pk_(test|live)_/.test(v),
  NEXT_PUBLIC_CLERK_FRONTEND_API_URL: v => v.startsWith('https://'),
  VERCEL_TOKEN: v => v.length >= 24,
  VERCEL_TEAM_ID: v => v.length >= 8,
  SUPABASE_ACCESS_TOKEN: v => v.startsWith('sbp_'),
  SUPABASE_ORG_ID: v => v.length >= 16,
  SYNC_ROLE: v => v === 'vps' || v === 'local',
  SYNC_VPS_TS_ADDR: v => v.length > 0 && /^[a-zA-Z0-9.:_-]+$/.test(v),
  SYNC_LOCAL_TS_ADDR: v => v.length > 0 && /^[a-zA-Z0-9.:_-]+$/.test(v),
  SYNC_REMOTE_USER: v => v.length > 0,
  SYNC_REMOTE_PATH: v => v.length > 0,
};

// Parse ~/.bashrc into a plain KEY->value map, stripping the leading `export `
// so the result is comparable to process.env. Shared by both scripts.
function readShellRcEnv() {
  const env = parseEnvString(readShellRc().replace(/^\s*export\s+/gm, ''));
  // Reverse the POSIX single-quote escaping that shSingleQuote/appendExportToShellRc emit:
  // a literal ' is written as '\'' inside the quoted value (bash decodes it on `source`),
  // so undo it for the JS readback (presence + redacted-preview display).
  for (const k of Object.keys(env)) env[k] = env[k].replace(/'\\''/g, "'");
  return env;
}

module.exports = { DOMAIN_VARS, VALIDATORS, readShellRcEnv };
