#!/usr/bin/env node
// webhook.js — GitHub webhook CRUD (push → VPS endpoint)
const { parseArgs, ghApi, OWNER, ok, err, log } = require('./_shared');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  const repo = args.repo;
  if (!repo) { err('--repo required'); process.exit(1); }

  if (cmd === 'list') {
    const hooks = ghApi(`repos/${OWNER}/${repo}/hooks`);
    console.table(hooks.map(h => ({ id: h.id, url: h.config?.url, events: (h.events || []).join(','), active: h.active })));
    return;
  }

  if (cmd === 'create') {
    const { url, events = 'push' } = args;
    if (!url) { err('--url required'); process.exit(1); }
    // S10: never take the secret on argv (leaks to ps/shell history). Read from env or stdin.
    let secret = process.env.SC_GIT_WEBHOOK_SECRET || '';
    if (!secret && !process.stdin.isTTY) {
      try { secret = require('fs').readFileSync(0, 'utf8').trim(); } catch {}
    }
    const eventList = events.split(',').map(s => s.trim()).filter(Boolean);
    // S13: send active as a typed boolean and events[] as repeated raw fields.
    const rawBody = { active: true, 'events': eventList };
    const body = {
      'name': 'web',
      'config[url]': url,
      'config[content_type]': 'json',
    };
    if (secret) body['config[secret]'] = secret;
    const hook = ghApi(`repos/${OWNER}/${repo}/hooks`, { method: 'POST', rawBody, body });
    ok(`webhook ${hook.id} created → ${url}`);
    return;
  }

  if (cmd === 'delete') {
    const { id } = args;
    if (!id) { err('--id required'); process.exit(1); }
    ghApi(`repos/${OWNER}/${repo}/hooks/${id}`, { method: 'DELETE' });
    ok(`webhook ${id} deleted`);
    return;
  }

  err('Usage: webhook.js list|create|delete --repo X [--url ...] [--events push,pull_request] [--id ...]  (secret via SC_GIT_WEBHOOK_SECRET env or stdin)');
  process.exit(1);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
