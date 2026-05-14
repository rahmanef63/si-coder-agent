#!/usr/bin/env node
// disable.js — strip auto-triggers from workflow YAML, leave workflow_dispatch only
const fs = require('fs');
const path = require('path');
const { parseArgs, localRepoPath, backup, ensureBranch, gitInRepo, log, ok, warn, err } = require('./_shared');

const BRANCH = 'chore/reduce-github-actions-usage';
const COMMIT_MSG = 'chore(actions): reduce GitHub Actions usage';

// Rewrite the `on:` block to ONLY contain workflow_dispatch.
// Preserves the rest of file verbatim.
function patchYaml(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let inOn = false;
  let onIndent = -1;
  let patched = false;
  let alreadyDispatchOnly = false;

  // Scan first to detect if already dispatch-only
  let onBlock = '';
  let collecting = false, collIndent = -1;
  for (const l of lines) {
    if (!collecting && /^on:\s*$/.test(l)) { collecting = true; collIndent = l.search(/\S/); continue; }
    if (collecting) {
      const cur = l.search(/\S/);
      if (l.trim() && cur <= collIndent) break;
      onBlock += l + '\n';
    }
  }
  const hasPush = /(^|\s)push\s*:/m.test(onBlock) || /-\s*push/m.test(onBlock);
  const hasPR = /(^|\s)pull_request\s*:/m.test(onBlock) || /-\s*pull_request/m.test(onBlock);
  const hasSched = /(^|\s)schedule\s*:/m.test(onBlock);
  const hasWfRun = /(^|\s)workflow_run\s*:/m.test(onBlock);
  if (!hasPush && !hasPR && !hasSched && !hasWfRun) {
    return { changed: false, alreadyDispatchOnly: true, text };
  }

  while (i < lines.length) {
    const l = lines[i];
    if (!inOn && /^on:\s*$/.test(l)) {
      inOn = true;
      onIndent = l.search(/\S/);
      out.push('on:');
      out.push('  workflow_dispatch:');
      patched = true;
      i++;
      // Skip until indent goes back to <=onIndent on non-empty line
      while (i < lines.length) {
        const ll = lines[i];
        if (!ll.trim()) { i++; continue; }
        const cur = ll.search(/\S/);
        if (cur <= onIndent) break;
        i++;
      }
      continue;
    }
    // Handle single-line `on: push` or `on: [push, pull_request]`
    if (!inOn && /^on:\s*\S/.test(l) && !/workflow_dispatch/.test(l)) {
      out.push('on:');
      out.push('  workflow_dispatch:');
      patched = true;
      i++;
      continue;
    }
    out.push(l);
    i++;
  }
  return { changed: patched, alreadyDispatchOnly: false, text: out.join('\n') };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo;
  if (!repo) { err('--repo required'); process.exit(1); }
  const repoPath = localRepoPath(repo);
  if (!repoPath) { err(`local clone not found at ~/projects/${repo}`); process.exit(1); }

  const wfDir = path.join(repoPath, '.github', 'workflows');
  if (!fs.existsSync(wfDir)) { warn('no .github/workflows dir'); return; }
  const files = fs.readdirSync(wfDir).filter(f => /\.(ya?ml)$/i.test(f) && !f.endsWith('.bak'));
  const targets = args.workflow ? files.filter(f => f === args.workflow) : files;
  if (targets.length === 0) { warn('no matching workflow files'); return; }

  const results = [];
  for (const f of targets) {
    const abs = path.join(wfDir, f);
    const orig = fs.readFileSync(abs, 'utf8');
    const { changed, alreadyDispatchOnly, text } = patchYaml(orig);
    if (alreadyDispatchOnly) {
      results.push({ file: f, status: 'skip-already-dispatch-only' });
      continue;
    }
    if (!changed) {
      results.push({ file: f, status: 'skip-no-change-detected' });
      continue;
    }
    if (args['dry-run']) {
      results.push({ file: f, status: 'dry-run' });
      log(`\n--- ${f} (dry-run diff) ---`);
      log(text.split('\n').slice(0, 25).join('\n'));
      continue;
    }
    backup(abs);
    fs.writeFileSync(abs, text);
    results.push({ file: f, status: 'patched' });
  }

  if (args['dry-run']) {
    console.table(results);
    return;
  }

  const patchedAny = results.some(r => r.status === 'patched');
  if (!patchedAny) {
    log('nothing changed.');
    console.table(results);
    return;
  }

  // git: branch + commit
  const cur = gitInRepo(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (cur !== BRANCH) ensureBranch(repoPath, BRANCH);
  gitInRepo(repoPath, ['add', '.github/workflows/']);
  try {
    gitInRepo(repoPath, ['commit', '-m', COMMIT_MSG]);
  } catch (e) {
    warn('commit skipped (probably nothing staged or signing issue):', e.message);
  }
  ok(`patched ${results.filter(r => r.status === 'patched').length} file(s) on branch ${BRANCH}`);
  console.table(results);
  log(`\nNext: cd ~/projects/${repo} && git push -u origin ${BRANCH} && gh pr create`);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
