// Output-style resolver tests. Guards the fail-safe (unknown → off) and the invariant
// that a non-off style always carries a non-empty prompt.
const test = require('node:test');
const assert = require('node:assert');
const {
  STYLES, STYLE_NAMES, STYLE_BLURBS, resolveStyle, stylePrompt,
} = require('../lib/output-styles');

test('OS-1: the three documented styles exist', () => {
  assert.deepStrictEqual(STYLE_NAMES, ['off', 'caveman', 'ponytail']);
});

test('OS-2: unknown / empty / whitespace resolves to off (fail-safe)', () => {
  for (const bad of [undefined, null, '', '   ', 'CAVEMANN', 'terse', 'ponytale', '42']) {
    assert.strictEqual(resolveStyle(bad), 'off', `resolveStyle(${JSON.stringify(bad)})`);
  }
});

test('OS-3: resolution is case- and whitespace-insensitive', () => {
  assert.strictEqual(resolveStyle('  CaveMan '), 'caveman');
  assert.strictEqual(resolveStyle('PONYTAIL'), 'ponytail');
});

test('OS-4: off yields an empty prompt; the others do not', () => {
  assert.strictEqual(stylePrompt('off'), '');
  assert.strictEqual(stylePrompt(undefined), '');
  assert.ok(stylePrompt('caveman').length > 0);
  assert.ok(stylePrompt('ponytail').length > 0);
});

test('OS-5: every non-off style has a prompt and a blurb (no drift)', () => {
  for (const name of STYLE_NAMES) {
    assert.ok(name in STYLES, `${name} missing from STYLES`);
    assert.ok(STYLE_BLURBS[name], `${name} missing a blurb`);
    if (name !== 'off') assert.ok(STYLES[name].length > 0, `${name} has an empty prompt`);
  }
});

test('OS-6: prompts keep the substance-preserving intent (caveman ≠ drop technical content)', () => {
  // A guard against a future edit that turns "terse" into "drop details" — caveman must
  // still promise to keep technical substance/code verbatim.
  assert.match(stylePrompt('caveman'), /verbatim|substance/i);
  assert.match(stylePrompt('ponytail'), /shortest|code first/i);
});
