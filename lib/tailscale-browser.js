'use strict';
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function run(args, { allowFailure = false } = {}) {
  const bin = process.env.SC_TAILSCALE_BIN || 'tailscale';
  const r = spawnSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) {
    if (allowFailure) return { code: 127, stdout: '', stderr: r.error.message };
    throw r.error;
  }
  if (r.status !== 0 && !allowFailure) throw new Error((r.stderr || r.stdout || 'tailscale command failed').trim());
  return { code: r.status ?? 1, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}
function parseStatus(text) {
  try {
    const value = JSON.parse(text);
    const dnsName = String(value?.Self?.DNSName || '').replace(/\.$/, '');
    const ipv4 = (value?.Self?.TailscaleIPs || []).find(x => /^100\./.test(String(x))) || null;
    return { running: value?.BackendState === 'Running' && value?.Self?.Online !== false, dnsName, ipv4 };
  } catch { return { running: false, dnsName: '', ipv4: null }; }
}
function inspect() {
  const r = run(['status', '--json'], { allowFailure: true });
  return r.code === 0 ? parseStatus(r.stdout) : { running: false, dnsName: '', ipv4: null };
}
function serveStatus() {
  const r = run(['serve', 'status', '--json'], { allowFailure: true });
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}
function handlerExists(status, dnsName, basePath, port) {
  const handlers = status?.Web?.[`${dnsName}:443`]?.Handlers || {};
  const proxy = handlers?.[basePath]?.Proxy;
  return proxy === `http://127.0.0.1:${port}` || proxy === `http://localhost:${port}`;
}
function startTailnetServe(port) {
  const state = inspect();
  if (!state.running || !state.dnsName) return { active: false, reason: 'Tailscale is not online with MagicDNS' };
  const basePath = `/sc-${crypto.randomBytes(8).toString('hex')}`;
  const target = `http://127.0.0.1:${port}`;
  let r = run(['serve', '--bg', '--yes', `--set-path=${basePath}`, target], { allowFailure: true });
  if (r.code !== 0 && /operator|sudo tailscale set --operator/i.test(`${r.stderr}\n${r.stdout}`)) {
    const username = os.userInfo().username;
    const sudo = spawnSync('sudo', ['-n', 'tailscale', 'set', `--operator=${username}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (sudo.status === 0) r = run(['serve', '--bg', '--yes', `--set-path=${basePath}`, target], { allowFailure: true });
  }
  if (r.code !== 0) return { active: false, reason: (r.stderr || r.stdout || 'Tailscale Serve unavailable').split(/\r?\n/)[0] };
  if (!handlerExists(serveStatus(), state.dnsName, basePath, port)) {
    run(['serve', '--https=443', `--set-path=${basePath}`, 'off'], { allowFailure: true });
    return { active: false, reason: 'Tailscale Serve did not retain the requested route' };
  }
  let closed = false;
  return {
    active: true,
    origin: `https://${state.dnsName}`,
    basePath,
    url: `https://${state.dnsName}${basePath}/`,
    close() {
      if (closed) return;
      closed = true;
      run(['serve', '--https=443', `--set-path=${basePath}`, 'off'], { allowFailure: true });
    },
  };
}
module.exports = { parseStatus, inspect, serveStatus, handlerExists, startTailnetServe };
