// onboarding-domains.js — compatibility view over lib/providers.js.
//
// The registry itself now lives in lib/providers.js, where every var carries its own
// required/secret/source/validator inline. The three maps below used to be maintained by hand
// side by side and had drifted in BOTH directions (vars read by code but never collected;
// vars collected but read by nothing). They are derived now, so that class of drift is gone.
//
// Every export here keeps its original name and shape — scan-env.js, bin/onboard.js, the
// wizard, and test/onboarding-sources.test.js all keep working unchanged.
const path = require('path');
const { readShellRc, parseEnvString } = require(path.resolve(__dirname, '../../../lib/env'));
const {
  DOMAIN_VARS, VALIDATORS, SECRET_SOURCES, DOMAIN_BLURBS, PROVIDERS, TARGET_PROVIDERS,
} = require(path.resolve(__dirname, '../../../lib/providers'));

// Default to SECRET when a var is not registered: a brand-new credential added to the registry
// but somehow missing a source entry is hidden rather than accidentally echoed.
function isSecret(key) {
  const s = SECRET_SOURCES[key];
  return s ? s.secret !== false : true;
}

// One-line "where to get it" string for a key, or '' when there is nothing to add.
function sourceLine(key) {
  const s = SECRET_SOURCES[key];
  if (!s) return '';
  const where = s.url ? `get it at: ${s.url}` : (s.cmd ? `find it with: ${s.cmd}` : '');
  if (where && s.note) return `${where}  (${s.note})`;
  if (where) return where;
  return s.note || '';
}

// Parse ~/.bashrc into a plain KEY->value map, stripping the leading `export `
// so the result is comparable to process.env.
function readShellRcEnv() {
  const env = parseEnvString(readShellRc().replace(/^\s*export\s+/gm, ''));
  // Reverse the POSIX single-quote escaping that shSingleQuote/appendExportToShellRc emit:
  // a literal ' is written as '\'' inside the quoted value (bash decodes it on `source`),
  // so undo it for the JS readback (presence + redacted-preview display).
  for (const k of Object.keys(env)) env[k] = env[k].replace(/'\\''/g, "'");
  return env;
}

module.exports = {
  DOMAIN_VARS, VALIDATORS, SECRET_SOURCES, DOMAIN_BLURBS, PROVIDERS, TARGET_PROVIDERS,
  isSecret, sourceLine, readShellRcEnv,
};
