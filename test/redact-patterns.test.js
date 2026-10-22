'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scrubSecrets } = require('../lib/redact-env');
const E = {};
const fake = (...p) => p.join('');

test('REDACT-P1: bearer and key=value shapes are scrubbed without env', () => {
  const out = scrubSecrets(`401: Authorization: Bearer ${fake('abcDEF', '123456789xyz')} ; api_key=${fake('zz', 'yy11223344')}`, E);
  assert.ok(!out.includes('abcDEF123456789xyz'));
  assert.ok(!out.includes('zzyy11223344'));
  assert.match(out, /Bearer \[redacted\]/);
});

test('REDACT-P2: well-known token prefixes are scrubbed', () => {
  for (const t of [fake('ghp_', 'A'.repeat(36)), fake('github_pat_', 'B'.repeat(40)), fake('sk_live_', 'C'.repeat(24)),
    fake('sk-', 'D'.repeat(30)), fake('xoxb-', '1234567890-abc'), fake('eyJ', 'hbGciOiJI', '.', 'eyJzdWIiOjE', '.', 'c2lnbmF0dXJl')]) {
    assert.strictEqual(scrubSecrets(`x ${t} y`, E), 'x [redacted] y', t.slice(0, 4));
  }
});

test('REDACT-P3: PEM private keys are scrubbed', () => {
  const pem = ['-----BEGIN', 'PRIVATE KEY-----\nMIIfake\n-----END', 'PRIVATE KEY-----'].join(' ');
  assert.strictEqual(scrubSecrets(`k=${pem}.`, E).includes('MIIfake'), false);
});

test('REDACT-P4: benign output (SHAs, ids, AUTHOR) is untouched', () => {
  const s = 'commit 3091ce4f2a9b8c7d6e5f40312a1b2c3d4e5f6a7b by AUTHOR=si-coder deployment dpl_8kq2abcd tokens: 12';
  assert.strictEqual(scrubSecrets(s, E), s);
});
