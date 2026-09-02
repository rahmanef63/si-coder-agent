'use strict';

const HIGH = [
  ['credential handling', /\bcredential(s)?\b|\bsecret(s)?\b|\btoken(s)?\b|\bpassword(s)?\b/i],
  ['auth', /\bauth\b|\boauth\b|\blogin\b/i],
  ['metadata migration', /\bmigration\b|\bmigrate\b|metadata version/i],
  ['provider abstraction', /provider abstraction|provider architecture|source routing/i],
  ['MCP/tool schema', /\bmcp\b|tool schema|function schema|machine function/i],
  ['destructive change', /\bdelete\b|\bdestructive\b|\bpurge\b|drop table/i],
  ['installer/distribution', /installer|distribution|package artifact|release packaging/i],
  ['security-sensitive path', /security|permission|chmod|private key|secret scan/i],
  ['broad shared refactor', /broad refactor|shared refactor|cross-cutting refactor/i],
];

const MEDIUM = [
  ['new CLI capability', /new cli|cli command|command surface/i],
  ['provider UX', /provider ux|provider flow|connection ux/i],
  ['contained feature', /feature|capability/i],
  ['skill behavior', /\bskill\b|trigger contract/i],
];

const LOW = [
  ['documentation', /\bdocs?\b|documentation|readme|typo/i],
  ['formatting', /formatting|copy change|wording/i],
  ['isolated test', /trivial test|small test|test wording/i],
  ['isolated bug', /isolated bug|small bug|one-line bug/i],
];

function matchReasons(text, rules) {
  const reasons = [];
  for (const [label, re] of rules) if (re.test(text)) reasons.push(label);
  return reasons;
}

function classifyTask(input = {}) {
  const text = [input.intent, input.title, input.description, ...(Array.isArray(input.areas) ? input.areas : [])].filter(Boolean).join(' ');
  const high = matchReasons(text, HIGH);
  const medium = matchReasons(text, MEDIUM);
  const low = matchReasons(text, LOW);
  let risk = 'LOW';
  let reasons = low.length ? low : ['small/local change by default'];
  if (medium.length) { risk = 'MEDIUM'; reasons = medium; }
  if (high.length) { risk = 'HIGH'; reasons = high; }
  const verification = risk === 'HIGH'
    ? ['targeted tests', 'full relevant regression', 'machine/MCP schema when applicable', 'secret scan', 'docs/distribution/migration checks when applicable', 'git diff review']
    : risk === 'MEDIUM'
      ? ['targeted tests', 'integration/CLI checks for touched surface', 'git diff review']
      : ['targeted verification'];
  return {
    risk,
    isolationRequired: risk === 'HIGH',
    isolationRecommended: risk === 'MEDIUM',
    directMainAllowedAfterVerification: risk === 'LOW',
    reasons,
    verification,
  };
}

module.exports = { classifyTask };
