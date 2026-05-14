// _shared.js — common bootstrapping for sc-dokploy CLI scripts
const path = require('path');
const { makeClient } = require(path.resolve(__dirname, '../../../lib/dokploy'));

function getClient() {
  const apiUrl = process.env.DOKPLOY_API_URL;
  const apiKey = process.env.DOKPLOY_API_KEY;
  if (!apiUrl || !apiKey) {
    console.error('Missing DOKPLOY_API_URL / DOKPLOY_API_KEY in env');
    process.exit(1);
  }
  return makeClient({ apiUrl, apiKey });
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

async function findProject(dokploy, name) {
  const projects = await dokploy.listProjects();
  const p = projects.find(x => x.name === name);
  if (!p) throw new Error(`project '${name}' not found`);
  return p;
}

module.exports = { getClient, parseArgs, findProject };
