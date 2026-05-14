#!/usr/bin/env node
// cron.js — VPS crontab CRUD wrapper (runs locally; assumes you ARE on the VPS)
const { spawnSync } = require('child_process');
const { parseArgs, log, ok, err, warn } = require('./_shared');

const TAG_PREFIX = '# sc-git:';

function readCron() {
  const r = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (r.status !== 0 && !/no crontab/.test(r.stderr)) throw new Error(r.stderr);
  return r.stdout || '';
}

function writeCron(text) {
  const r = spawnSync('crontab', ['-'], { input: text, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
}

function entries() {
  const txt = readCron();
  const out = [];
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const tag = lines[i].match(new RegExp(`^${TAG_PREFIX}\\s*(\\S+)`));
    if (tag && lines[i + 1]) {
      out.push({ name: tag[1], line: lines[i + 1], idx: i });
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'list') {
    const es = entries();
    if (!es.length) { log('(no sc-git cron entries)'); return; }
    console.table(es.map(e => ({ name: e.name, schedule: e.line.split(/\s+/).slice(0, 5).join(' '), cmd: e.line.split(/\s+/).slice(5).join(' ').slice(0, 60) })));
    return;
  }

  if (cmd === 'add') {
    const { name, schedule, cmd: shellCmd } = args;
    if (!name || !schedule || !shellCmd) { err('Usage: cron.js add --name X --schedule "0 19 * * 0" --cmd "bash ..."'); process.exit(1); }
    const cur = readCron();
    if (cur.includes(`${TAG_PREFIX} ${name}`)) { warn('entry with that name already exists. remove first.'); return; }
    const newText = (cur.trim() + '\n' + `${TAG_PREFIX} ${name}\n${schedule} ${shellCmd}\n`).trimStart();
    writeCron(newText);
    ok(`added cron '${name}' (${schedule})`);
    return;
  }

  if (cmd === 'remove') {
    const { name } = args;
    if (!name) { err('--name required'); process.exit(1); }
    const cur = readCron();
    const lines = cur.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === `${TAG_PREFIX} ${name}`) { i++; continue; }
      out.push(lines[i]);
    }
    writeCron(out.join('\n'));
    ok(`removed cron '${name}'`);
    return;
  }

  err('Usage: cron.js list|add|remove [...]');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
