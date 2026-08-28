'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveBuildCommand } = require('../skills/sc-vercel/scripts/build-command');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-vercel-build-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('uses repository vercel.json buildCommand as the coupled SSOT', () => {
  const dir = fixture({
    'vercel.json': { buildCommand: 'bun run build:auto' },
    'package.json': { engines: { bun: '>=1.2' } },
    'bun.lock': '',
  });
  try {
    assert.deepEqual(resolveBuildCommand({ cwd: dir }), {
      command: 'bun run build:auto',
      source: 'vercel.json',
    });
  } finally { cleanup(dir); }
});

test('bun fallback uses bun for both Convex and the app build', () => {
  const dir = fixture({ 'package.json': { packageManager: 'bun@1.3.0' }, 'bun.lock': '' });
  try {
    assert.deepEqual(resolveBuildCommand({ cwd: dir }), {
      command: "bunx convex deploy --cmd 'bun run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL",
      source: 'bun fallback',
    });
  } finally { cleanup(dir); }
});

test('decoupled mode stays frontend-only even when vercel.json couples deployment', () => {
  const dir = fixture({
    'vercel.json': { buildCommand: 'bun run build:auto' },
    'package.json': { engines: { bun: '>=1.2' } },
  });
  try {
    assert.deepEqual(resolveBuildCommand({ cwd: dir, decoupled: true }), {
      command: 'bun run build',
      source: 'bun fallback',
    });
  } finally { cleanup(dir); }
});

test('explicit build command wins without shell interpolation by the resolver', () => {
  const dir = fixture({ 'vercel.json': { buildCommand: 'npm run build' } });
  try {
    assert.deepEqual(resolveBuildCommand({ cwd: dir, explicit: '  bun run release  ' }), {
      command: 'bun run release',
      source: '--build-command',
    });
  } finally { cleanup(dir); }
});
