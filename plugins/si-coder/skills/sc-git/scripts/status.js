#!/usr/bin/env node
// status.js — POST commit status (replaces required-check Actions)
const { parseArgs, ghApi, OWNER, ok, err } = require('./_shared');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { repo, sha, state, context = 'sc-git-ci', description = '', url } = args;
  if (!repo || !sha || !state) {
    err('Usage: status.js --repo X --sha Y --state success|failure|pending|error [--context ci] [--description "msg"] [--url https://...]');
    process.exit(1);
  }
  const body = { state, context, description };
  if (url) body.target_url = url;
  ghApi(`repos/${OWNER}/${repo}/statuses/${sha}`, { method: 'POST', body });
  ok(`status ${state} posted to ${repo}@${sha.slice(0, 7)} (${context})`);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
