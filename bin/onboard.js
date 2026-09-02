#!/usr/bin/env node
'use strict';

// Compatibility entry point for the historical `si-coder-onboard` command.
// Fresh onboarding is connection-scoped now, so this command delegates to `sc setup`
// instead of writing credentials into ~/.bashrc. The old shell-export wizard remains
// available explicitly as bin/onboard-legacy.js for existing automation only.
const path = require('path');
const { spawnSync } = require('child_process');

const sc = path.resolve(__dirname, 'sc.js');
const raw = process.argv.slice(2);
const args = ['setup'];
for (let i = 0; i < raw.length; i++) {
  const arg = raw[i];
  if (arg === '--domains') args.push('--providers');
  else if (arg.startsWith('--domains=')) args.push('--providers', arg.slice('--domains='.length));
  else args.push(arg);
}

const result = spawnSync(process.execPath, [sc, ...args], { stdio: 'inherit', env: process.env });
if (result.error) {
  console.error(`❌ failed to start sc setup: ${result.error.message}`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status === null ? 1 : result.status;
}
