#!/usr/bin/env node
// audit.js — scan all repos for workflow burn risk
const fs = require('fs');
const path = require('path');
const { parseArgs, ghApi, listRepos, workflowFiles, runCount, OWNER, log, warn } = require('./_shared');

function detectTriggers(yamlText) {
  const t = { push: false, pr: false, schedule: false, dispatch: false, workflowRun: false, paths: false, branches: [], cron: [] };
  const lines = yamlText.split('\n');
  let inOn = false, indent = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^on:\s*$/.test(l) || /^on:\s*\[/.test(l) || /^"on":/.test(l)) { inOn = true; indent = l.search(/\S/); continue; }
    if (inOn) {
      const cur = l.search(/\S/);
      if (l.trim() && cur <= indent) inOn = false;
    }
    if (inOn || /^on:\s/.test(l)) {
      if (/(^|\s)push\s*:/.test(l) || /^\s+-\s*push/.test(l)) t.push = true;
      if (/(^|\s)pull_request\s*:/.test(l) || /^\s+-\s*pull_request/.test(l)) t.pr = true;
      if (/(^|\s)schedule\s*:/.test(l)) t.schedule = true;
      if (/(^|\s)workflow_dispatch\s*:/.test(l) || /^\s+-\s*workflow_dispatch/.test(l)) t.dispatch = true;
      if (/(^|\s)workflow_run\s*:/.test(l)) t.workflowRun = true;
      if (/^\s+paths:/.test(l)) t.paths = true;
      const cron = l.match(/cron:\s*['"]([^'"]+)['"]/); if (cron) t.cron.push(cron[1]);
      const br = l.match(/branches:\s*\[([^\]]+)\]/); if (br) t.branches.push(...br[1].split(',').map(s => s.trim().replace(/['"]/g, '')));
    }
  }
  return t;
}

function risksFor(trig, yamlText, runs) {
  const r = [];
  if (trig.schedule) r.push(`cron(${trig.cron.join(',') || '?'})`);
  if (trig.push && !trig.paths) r.push('push-no-paths');
  if (trig.push && trig.pr) r.push('push+pr-fanout');
  if (/matrix:\s*$/m.test(yamlText)) r.push('matrix');
  if (/runs-on:\s*\[?\s*(ubuntu|macos|windows)-/i.test(yamlText) && /macos|windows/i.test(yamlText)) r.push('costly-os');
  if (runs > 50) r.push(`hot(${runs}runs)`);
  if (!/concurrency:/.test(yamlText)) r.push('no-concurrency');
  if (/sleep\s+\d{2,}/.test(yamlText)) r.push('long-sleep');
  return r;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = args.since || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const repos = args.repo
    ? [{ name: args.repo, private: true, archived: false }]
    : listRepos().filter(r => !r.archived).map(r => ({ name: r.name, private: r.private, archived: r.archived }));

  const report = { since, owner: OWNER, repos: [] };

  for (const r of repos) {
    const wfs = workflowFiles(r.name);
    if (wfs.length === 0) continue;
    const runs = runCount(r.name, since);
    const items = [];
    for (const w of wfs) {
      let yaml = '';
      if (w.local) {
        try { yaml = fs.readFileSync(w.abs, 'utf8'); } catch {}
      } else {
        try {
          // No shell: ghApi runs `gh` via spawnSync (argv). w.abs comes from the
          // GitHub API and must never be interpolated into a shell string.
          const b64 = ghApi(`repos/${OWNER}/${r.name}/contents/${w.abs}`, { jq: '.content' });
          yaml = Buffer.from(b64, 'base64').toString('utf8');
        } catch {}
      }
      const trig = detectTriggers(yaml);
      const risk = risksFor(trig, yaml, runs);
      items.push({ name: w.name, trig, risk });
    }
    report.repos.push({ name: r.name, private: r.private, runs, workflows: items });
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Markdown
  log(`# sc-git audit — ${OWNER}`);
  log(`\nWindow: since **${since}**\n`);
  log(`| repo | runs | workflows | risk |`);
  log(`|---|---:|---|---|`);
  const sorted = [...report.repos].sort((a, b) => b.runs - a.runs);
  for (const r of sorted) {
    const wfList = r.workflows.map(w => w.name).join(', ');
    const allRisk = [...new Set(r.workflows.flatMap(w => w.risk))].join(', ') || '-';
    log(`| ${r.name}${r.private ? '' : ' (public)'} | ${r.runs} | ${wfList} | ${allRisk} |`);
  }
  log(`\nTotal repos with workflows: ${report.repos.length}`);
  log(`Total workflows: ${report.repos.reduce((s, r) => s + r.workflows.length, 0)}`);
  log(`Total runs since ${since}: ${report.repos.reduce((s, r) => s + r.runs, 0)}`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
