'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scrubSecrets, scrubDeep, secretValues } = require('../lib/redact-env');

const env = {
  GH_PAT_DEMO: 'ghp_fakefakefake1234',
  COMPOSIO_KEY_DEMO: 'ck_fake_abcdefgh',
  CONVEX_DEPLOY_KEY: 'prod:x|fakefakefakekey',
  HOME: '/home/someone-long-path',
  SHORT_TOKEN: 'abc',
};

test('REDACT-1: secret-named env values are scrubbed from text', () => {
  const out = scrubSecrets(`a ghp_fakefakefake1234 b ck_fake_abcdefgh c prod:x|fakefakefakekey`, env);
  assert.strictEqual(out, 'a [redacted] b [redacted] c [redacted]');
});

test('REDACT-2: non-secret names and short values are left alone', () => {
  assert.strictEqual(scrubSecrets('/home/someone-long-path abc', env), '/home/someone-long-path abc');
  assert.ok(!secretValues(env).includes('abc'));
});

test('REDACT-3: scrubDeep walks nested objects/arrays', () => {
  const out = scrubDeep({ a: ['x ghp_fakefakefake1234'], b: { c: 'ck_fake_abcdefgh' }, n: 3 }, env);
  assert.deepStrictEqual(out, { a: ['x [redacted]'], b: { c: '[redacted]' }, n: 3 });
});

test('REDACT-4: sc-mcp wires the scrubber into tool output', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'sc-mcp.js'), 'utf8');
  assert.match(src, /scrubSecrets\(\(r\.stdout/);
  assert.match(src, /scrubSecrets\(\(r\.stderr/);
});
