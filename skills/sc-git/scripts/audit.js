#!/usr/bin/env node
// audit.js — scan all repos for workflow burn risk
const fs = require('fs');
const path = require('path');
const { parseArgs, ghApi, listRepos, workflowFiles, runCount, detectTriggers, OWNER, log, warn } = require('./_shared');

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
