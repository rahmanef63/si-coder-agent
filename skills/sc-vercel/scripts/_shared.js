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
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    } else {
      o._.push(a);
    }
  }
  return o;
}

module.exports = { getClient, parseArgs };
