#!/usr/bin/env node
'use strict';

const AgentActions = require('../lib/agent/actions');

const record = process.argv.includes('--record');
const out = AgentActions.repositoryVerifyAction({ record, strictSkills: true });
const result = {
  ok: out.ok,
  syntax: out.checks.syntax === 'passed' ? 'pass' : 'fail',
  installerSyntax: out.checks.installer_syntax === 'passed' ? 'pass' : 'fail',
  tests: out.checks.unit_integration_cli_distribution === 'passed' ? 'pass' : 'fail',
  docs: out.checks.docs === 'passed' ? 'pass' : 'fail',
  catalog: out.checks.skill_catalog === 'passed' ? 'pass' : 'fail',
  distribution: out.checks.unit_integration_cli_distribution === 'passed' ? 'pass' : 'fail',
  skills: out.checks.skills === 'passed' ? 'pass' : 'fail',
  secretScan: out.checks.secret_scan === 'passed' ? 'pass' : 'fail',
  installerSyntaxCheck: out.installerSyntax,
  regression: out.regression,
  docsCheck: out.docs,
  catalogCheck: out.catalog,
  skillSummary: out.skills,
  secretScanSummary: out.secretScan,
  recipe: out.recipe,
  evidence: out.evidence,
  memory: out.memory,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = out.ok ? 0 : 1;
