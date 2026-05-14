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
    const { url, events = 'push', secret } = args;
    if (!url) { err('--url required'); process.exit(1); }
    const body = {
      'name': 'web',
      'active': 'true',
      'events[]': events.split(','),
      'config[url]': url,
      'config[content_type]': 'json',
    };
    if (secret) body['config[secret]'] = secret;
    const hook = ghApi(`repos/${OWNER}/${repo}/hooks`, { method: 'POST', body });
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

  err('Usage: webhook.js list|create|delete --repo X [--url ...] [--id ...]');
  process.exit(1);
}
main().catch(e => { console.error('❌', e.message); process.exit(1); });
