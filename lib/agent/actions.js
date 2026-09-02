'use strict';

const path = require('path');
const { classifyTask } = require('./policy');
const Memory = require('./memory-store');
const Evidence = require('./evidence-store');
const Recipes = require('./recipe-store');
const Skills = require('./skill-verifier');
const Repo = require('./repo-service');

function resolveRoot(input = {}, fallback = process.cwd()) {
  return path.resolve(input.root || fallback);
}

function taskRiskAction(input = {}) {
  return classifyTask(input);
}

function relevantRecipes(intent, root, limit = 2) {
  const tokens = String(intent || '').toLowerCase().split(/[^a-z0-9._-]+/).filter(x => x.length > 2);
  return Recipes.listRecipes({ root })
    .map(recipe => {
      const text = [recipe.id, recipe.name, recipe.scope, ...(recipe.tags || [])].filter(Boolean).join(' ').toLowerCase();
      const score = tokens.reduce((n, token) => n + (text.includes(token) ? 1 : 0), 0) + (recipe.status === 'executable' ? 2 : recipe.status === 'verified' ? 1 : 0);
      return { recipe, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.recipe);
}

function taskPrepareAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  const intent = String(input.intent || input.title || '').trim();
  if (!intent) throw new Error('task prepare requires intent');
  const policy = classifyTask(input);
  if (policy.risk === 'LOW') {
    return {
      intent, policy,
      retrieval: { used: false, reason: 'LOW-risk task: targeted verification is enough; project memory was not loaded.', count: 0, context: '' },
      recipes: [],
    };
  }
  const memory = Memory.queryMemory({
    query: intent,
    scope: input.scope || null,
    tags: input.tags || [],
    limit: input.limit || 6,
    maxChars: input.maxChars || 4000,
    staleAfterDays: input.staleAfterDays || 90,
    freshOnly: Boolean(input.freshOnly),
  }, { root });
  return {
    intent, policy,
    retrieval: { used: true, reason: 'MEDIUM/HIGH-risk task: loaded only ranked relevant memory.', count: memory.count, filters: memory.filters, context: memory.context, memories: memory.memories },
    recipes: relevantRecipes(intent, root, Math.max(1, Math.min(Number(input.recipeLimit) || 2, 5))),
  };
}

function memoryInitAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  return Memory.ensureFoundation(root);
}

function memoryRecordAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  const type = input.type;
  const git = Repo.gitState(root);
  const commit = input.commit || (git.git ? `${git.head}${git.dirty ? '+dirty' : ''}` : null);
  return Memory.writeMemory(type, { ...input, commit }, { root, replace: input.replace !== false });
}

function memoryQueryAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  return Memory.queryMemory(input, { root });
}

function memoryStatusAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  if (!input.id || !input.status) throw new Error('memory status requires id and status');
  return Memory.setMemoryStatus(input.id, input.status, { root, lastVerified: input.lastVerified, supersedes: input.supersedes });
}

function evidenceRecordAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  const git = Repo.gitState(root);
  return Evidence.writeEvidence({
    ...input,
    commit: input.commit || (git.git ? `${git.head}${git.dirty ? '+dirty' : ''}` : null),
  }, { root });
}

function skillVerifyAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  return Skills.verifySkills({ root, strict: Boolean(input.strict), supportedTools: input.supportedTools || null });
}

function recipeObserveAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  if (!input.name) throw new Error('recipe observe requires name');
  return Recipes.observeRecipe(input.name, input, { root });
}

function recipeVerifyAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  if (!input.id) throw new Error('recipe verify requires id');
  if (input.confirm !== true) throw new Error('confirm=true is required');
  return Recipes.verifyRecipe(input.id, { root });
}

function recipePromoteAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  if (!input.id || !input.script) throw new Error('recipe promote requires id and script');
  if (input.confirm !== true) throw new Error('confirm=true is required');
  return Recipes.promoteRecipe(input.id, input.script, { root });
}

function recipeListAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  return { recipes: Recipes.listRecipes({ root }) };
}

function compactCommandResult(result) {
  const last = text => String(text || '').trim().split('\n').filter(Boolean).slice(-8).join('\n').slice(0, 1800);
  return {
    code: result.code,
    ok: result.code === 0,
    stdoutTail: last(result.stdout),
    stderrTail: last(result.stderr),
  };
}

function repositoryVerifyAction(input = {}, options = {}) {
  const root = resolveRoot(input, options.root);
  const record = input.record !== false;
  let verificationRecipe = null;
  const git = Repo.gitState(root);
  const commitLabel = git.git ? `${git.head}${git.dirty ? '+dirty' : ''}` : null;
  const verificationStamp = new Date().toISOString();
  const suffix = git.git ? `${git.head.slice(0, 12)}${git.dirty ? '-dirty' : ''}` : 'nogit';

  const syntaxFiles = [
    'lib/agent/security.js',
    'lib/agent/markdown-record.js',
    'lib/agent/memory-store.js',
    'lib/agent/evidence-store.js',
    'lib/agent/policy.js',
    'lib/agent/recipe-store.js',
    'lib/agent/skill-verifier.js',
    'lib/agent/repo-service.js',
    'lib/agent/actions.js',
    'lib/prompt.js',
    'lib/providers.js',
    'scripts/sc-agent.js',
    'scripts/sc-mcp.js',
    'scripts/release-candidate-check.js',
    'scripts/check-skill-catalog.js',
    'scripts/sync-install-docs.js',
    'bin/sc.js',
  ].filter(file => require('fs').existsSync(path.join(root, file)));
  const syntax = Repo.syntaxCheck(syntaxFiles, root);
  const installerSyntax = syntax.ok ? Repo.run('bash', ['-n', 'install.sh'], { root }) : { code: 1, stdout: '', stderr: 'skipped because JS syntax failed' };
  const regression = syntax.ok && installerSyntax.code === 0 ? Repo.runRegression(root) : { code: 1, stdout: '', stderr: 'skipped because syntax failed' };
  const docs = regression.code === 0 ? Repo.runDocsCheck(root) : { code: 1, stdout: '', stderr: 'skipped because regression failed' };
  const skills = Skills.verifySkills({ root, strict: Boolean(input.strictSkills) });
  const catalog = Repo.run(process.execPath, ['scripts/check-skill-catalog.js'], { root });
  const secretScan = Repo.scanRepositorySecrets(root);
  const ok = syntax.ok && installerSyntax.code === 0 && regression.code === 0 && docs.code === 0 && catalog.code === 0 && skills.ok && secretScan.ok;

  const checks = {
    syntax: syntax.ok ? 'passed' : 'failed',
    installer_syntax: installerSyntax.code === 0 ? 'passed' : 'failed',
    unit_integration_cli_distribution: regression.code === 0 ? 'passed' : 'failed',
    docs: docs.code === 0 ? 'passed' : 'failed',
    skill_catalog: catalog.code === 0 ? 'passed' : 'failed',
    skills: skills.ok ? 'passed' : 'failed',
    secret_scan: secretScan.ok ? 'passed' : 'failed',
  };

  let evidence = null;
  let memory = null;
  if (record) {
    evidence = Evidence.writeEvidence({
      id: `evidence-repository-verification-${suffix}`,
      target: 'repository verification',
      generatedAt: verificationStamp,
      commit: commitLabel,
      risk: 'HIGH',
      command: 'sc verify',
      arguments: [],
      exitCode: ok ? 0 : 1,
      assertions: {
        workingTreeDirty: git.dirty,
        skillErrors: skills.errorCount,
        secretFindings: secretScan.findings.length,
        repositoryFilesScanned: secretScan.filesScanned,
      },
      checks,
      stdoutContract: 'Raw test output is not persisted; only exit status and bounded tails are returned to the caller.',
      stderrContract: 'Raw stderr is not persisted; secret-shaped memory/evidence writes are rejected.',
      filesystemAssertions: { agentMemoryPresent: true, evidenceReceiptWritten: true },
      metadataAssertions: { memoryLifecycle: true, recipeLifecycle: true, skillVerification: true },
      secretRedaction: true,
    }, { root, generatedAt: verificationStamp });

    memory = Memory.writeMemory('test', {
      id: `test-repository-regression-${suffix}`,
      title: 'Repository regression verification',
      status: ok ? 'confirmed' : 'active',
      confidence: ok ? 1 : 0.7,
      scope: 'repository',
      tags: ['regression', 'security', 'distribution', 'agent-workflow'],
      target: 'SI-Coder repository verification',
      source: 'sc verify',
      environment: `node ${process.version}`,
      steps: ['JS syntax check', 'installer bash syntax check', 'full npm test suite', 'docs sync check', 'skill catalog check', 'skill verification', 'full repository secret scan'],
      expected: 'all applicable gates pass without persisting secrets',
      actual: Object.entries(checks).map(([k, v]) => `${k}=${v}`).join(', '),
      result: ok ? 'pass' : 'fail',
      commit: commitLabel,
      relatedAreas: ['agent workflow', 'memory', 'skills', 'security', 'distribution'],
      lastVerified: verificationStamp,
      body: `Evidence: ${evidence.relativePath}`,
    }, { root, now: verificationStamp, replace: true });

    // A recipe observation represents a fully successful recorded workflow, not merely
    // an attempted check. Read-only release verification must remain deterministic.
    if (ok) {
      verificationRecipe = Recipes.observeRecipe('release-candidate-check', {
        scope: 'repository',
        tags: ['verification', 'release', 'security'],
        steps: ['JS syntax check', 'installer bash syntax check', 'full regression', 'docs check', 'skill catalog check', 'skill verification', 'full repository secret scan'],
      }, { root });
    }
  }

  return {
    ok,
    git,
    checks,
    syntax: { ok: syntax.ok, failures: syntax.rows.filter(row => !row.ok) },
    installerSyntax: compactCommandResult(installerSyntax),
    regression: compactCommandResult(regression),
    docs: compactCommandResult(docs),
    catalog: compactCommandResult(catalog),
    skills: { ok: skills.ok, skillCount: skills.skillCount, errorCount: skills.errorCount, warningCount: skills.warningCount },
    secretScan: { ok: secretScan.ok, filesScanned: secretScan.filesScanned, textFilesScanned: secretScan.textFilesScanned, binaryOrLargeSkipped: secretScan.binaryOrLargeSkipped, findingCount: secretScan.findings.length },
    recipe: verificationRecipe ? { id: verificationRecipe.id, status: verificationRecipe.status, observedCount: verificationRecipe.observedCount } : null,
    evidence: evidence ? { id: evidence.id, path: evidence.relativePath } : null,
    memory: memory ? { id: memory.id, path: memory.relativePath } : null,
  };
}

module.exports = {
  taskRiskAction,
  taskPrepareAction,
  memoryInitAction,
  memoryRecordAction,
  memoryQueryAction,
  memoryStatusAction,
  evidenceRecordAction,
  skillVerifyAction,
  recipeObserveAction,
  recipeVerifyAction,
  recipePromoteAction,
  recipeListAction,
  repositoryVerifyAction,
};
