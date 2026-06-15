// _shared.js — common bootstrapping for sc-vercel CLI scripts
const path = require('path');
const { makeClient } = require(path.resolve(__dirname, '../../../lib/vercel'));

function getClient() {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID || undefined; // optional
  if (!token) {
    console.error('Missing VERCEL_TOKEN in env');
    process.exit(1);
  }
  return makeClient({ token, teamId });
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        // --key=value (handles empty value and '=' inside the value)
        o[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const k = body;
      const n = argv[i + 1];
      // Don't consume a following flag (starts with '--') as this flag's value;
      // treat the flag as a boolean instead.
      if (n === undefined || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    } else {
      o._.push(a);
    }
  }
  return o;
}

module.exports = { getClient, parseArgs };
