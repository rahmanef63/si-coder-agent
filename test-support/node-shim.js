'use strict';
// Test-only helper: install.sh intentionally rejects Node majors outside the
// supported engines range (22/24/26; covered by SCPORT-10c). When the test
// runner itself is on an unsupported major (e.g. Node 20 CI/dev boxes), the
// installer-behaviour tests would fail for environmental reasons. This
// returns a PATH prefix whose `node` reports a supported major for the
// installer's version probe and delegates every other call to the real node.
const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED = new Set([22, 24, 26]);

function supportedNodePath(dir, basePath = process.env.PATH) {
  const major = Number(process.versions.node.split('.')[0]);
  if (SUPPORTED.has(major)) return basePath;
  const bin = path.join(dir, 'node-shim-bin');
  fs.mkdirSync(bin, { recursive: true });
  const real = process.execPath.replace(/'/g, `'\\''`);
  fs.writeFileSync(path.join(bin, 'node'), [
    '#!/bin/sh',
    `if [ "$1" = "-p" ] && [ "$2" = 'Number(process.versions.node.split(".")[0])' ]; then echo 22; exit 0; fi`,
    'if [ "$1" = "--version" ]; then echo v22.0.0-test-shim; exit 0; fi',
    `exec '${real}' "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  return `${bin}${path.delimiter}${basePath}`;
}

module.exports = { supportedNodePath };
