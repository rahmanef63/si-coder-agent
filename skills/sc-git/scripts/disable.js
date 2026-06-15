#!/usr/bin/env node
// disable.js — strip auto-triggers from workflow YAML, leave workflow_dispatch only
const fs = require('fs');
const path = require('path');
const { parseArgs, localRepoPath, backup, ensureBranch, gitInRepo, detectTriggers, log, ok, warn, err } = require('./_shared');

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

  // Use the SAME trigger detection as audit.js (shared helper). This handles
  // bare `on:`, quoted `"on":`, single-line scalar `on: push`, and flow-seq
  // `on: [push, pull_request]`, so audit and disable never disagree on what
  // counts as an active trigger. Only bail as "already dispatch-only" when NO
  // auto-trigger is present.
  const trig = detectTriggers(text);
  if (!trig.push && !trig.pr && !trig.schedule && !trig.workflowRun) {
    return { changed: false, alreadyDispatchOnly: true, text };
  }

  while (i < lines.length) {
    const l = lines[i];
    // Multiline block form: `on:` / `"on":` on its own line, triggers indented below.
    if (!inOn && /^("on"|on):\s*$/.test(l)) {
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
    // Single-line scalar `on: push` / flow-seq `on: [push, pull_request]` /
    // quoted `"on": push`. Collapse to workflow_dispatch. We reach this code
    // only when the file has a live auto-trigger (push/pr/schedule/workflow_run
    // — checked at the top via detectTriggers), so a flow-seq that MIXES
    // workflow_dispatch with a live trigger, e.g. `on: [push, workflow_dispatch]`,
    // must still be rewritten. Gating on the file-level trig flags (not on
    // whether the literal 'workflow_dispatch' appears on the line) keeps audit
    // and disable in lockstep.
    if (!inOn && /^("on"|on):\s*\S/.test(l) &&
        (trig.push || trig.pr || trig.schedule || trig.workflowRun)) {
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

  // dry-run never touches the repo: classify only, no branch switch, no writes.
  if (args['dry-run']) {
    const results = [];
    for (const f of targets) {
      const abs = path.join(wfDir, f);
      const { changed, alreadyDispatchOnly, text } = patchYaml(fs.readFileSync(abs, 'utf8'));
      if (alreadyDispatchOnly) { results.push({ file: f, status: 'skip-already-dispatch-only' }); continue; }
      if (!changed) { results.push({ file: f, status: 'skip-no-change-detected' }); continue; }
      results.push({ file: f, status: 'dry-run' });
      log(`\n--- ${f} (dry-run diff) ---`);
      log(text.split('\n').slice(0, 25).join('\n'));
    }
    console.table(results);
    return;
  }

  // Pre-flight: refuse to mutate a dirty tree. Patching unstaged on top of
  // existing modifications, then `git checkout <branch>`, risks an abort
  // ("local changes would be overwritten") that strands patched-but-uncommitted
  // files. Require a clean tree so the branch switch below can never collide.
  const startBranch = gitInRepo(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = gitInRepo(repoPath, ['status', '--porcelain']);
  if (dirty) {
    err(`working tree not clean in ~/projects/${repo}. commit/stash first, then re-run.`);
    log(dirty);
    process.exit(1);
  }

  // Switch to the work branch BEFORE writing any files. Committing the patch on
  // the branch (rather than writing on startBranch then checking out) means a
  // divergent pre-existing branch can never abort a checkout over our freshly
  // written files. On checkout failure, restore the starting branch.
  if (startBranch !== BRANCH) {
    try {
      ensureBranch(repoPath, BRANCH);
    } catch (e) {
      err(`could not switch to ${BRANCH}: ${e.message}`);
      try { gitInRepo(repoPath, ['checkout', startBranch]); } catch { /* best-effort */ }
      log(`recovery: tree unchanged, restored branch ${startBranch}. Resolve the divergent '${BRANCH}' branch (delete or merge it) and re-run.`);
      process.exit(1);
    }
  }

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
    backup(abs);
    fs.writeFileSync(abs, text);
    results.push({ file: f, status: 'patched' });
  }

  const patchedAny = results.some(r => r.status === 'patched');
  if (!patchedAny) {
    log('nothing changed.');
    console.table(results);
    return;
  }

  // git: commit (already on BRANCH)
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

// Run as CLI only when invoked directly; stay importable for unit tests.
if (require.main === module) {
  main().catch(e => { console.error('❌', e.message); process.exit(1); });
}

module.exports = { patchYaml };
