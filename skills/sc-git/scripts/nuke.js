#!/usr/bin/env node
// nuke.js — disable / re-enable Actions on repo
const { parseArgs, ghApi, repoExists, OWNER, ok, err } = require('./_shared');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo;
  if (!repo) { err('--repo required'); process.exit(1); }
  if (!repoExists(repo)) { err(`repo ${OWNER}/${repo} not found`); process.exit(1); }
  const enabled = !!args.revert;
  ghApi(`repos/${OWNER}/${repo}/actions/permissions`, {
    method: 'PUT',
    body: { enabled: String(enabled), allowed_actions: 'all' },
  });
  ok(`Actions ${enabled ? 'enabled' : 'disabled'} for ${OWNER}/${repo}`);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
