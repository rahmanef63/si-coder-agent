'use strict';

const { assertNoSecrets } = require('../agent/security');

const ALLOWED_USES = Object.freeze(new Set(['sc.fn', 'sc.cli', 'provider.mcp', 'flow']));

function assertAllowedUses(uses) {
  if (typeof uses !== 'string' || !uses.trim()) throw new Error('step.uses is required');
  if (!ALLOWED_USES.has(uses)) {
    throw new Error(`step.uses "${uses}" is not allowlisted (allowed: ${[...ALLOWED_USES].join(', ')})`);
  }
  return uses;
}

function assertFlowSecrets(value, label) {
  assertNoSecrets(value, label);
}

module.exports = {
  ALLOWED_USES,
  assertAllowedUses,
  assertFlowSecrets,
  assertNoSecrets,
};
