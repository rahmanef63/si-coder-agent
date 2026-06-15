// _shared.js — common bootstrapping for sc-dokploy CLI scripts
const path = require('path');
const { makeClient } = require(path.resolve(__dirname, '../../../lib/dokploy'));

function getClient() {
  const apiUrl = process.env.DOKPLOY_API_URL;
  const apiKey = process.env.DOKPLOY_API_KEY;
  if (!apiUrl || !apiKey) {
    console.error('Missing DOKPLOY_API_URL / DOKPLOY_API_KEY in env');
    process.exit(1);
  }
  return makeClient({ apiUrl, apiKey });
}

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const n = argv[i + 1];
      if (!n || n.startsWith('--')) o[k] = true;
      else { o[k] = n; i++; }
    } else {
      o._.push(a);
    }
  }
  return o;
}

async function findProject(dokploy, name) {
  const projects = await dokploy.listProjects();
  const p = projects.find(x => x.name === name);
  if (!p) throw new Error(`project '${name}' not found`);
  return p;
}

// Centralize the environment-index assumption. Previously every script hardcoded
// `environments?.[0]`, so apps/compose living in any non-first environment
// (e.g. staging) were invisible to list/show/deploy AND silently un-audited.
// These helpers flatten across ALL environments and warn once per project when
// there is more than one, so the magic index lives in a single place.
const _warnedMultiEnv = new Set();
function warnMultiEnv(project) {
  const envs = project?.environments || [];
  if (envs.length > 1 && project?.projectId && !_warnedMultiEnv.has(project.projectId)) {
    _warnedMultiEnv.add(project.projectId);
    console.warn(`⚠️ project '${project.name}' has ${envs.length} environments; scanning all of them.`);
  }
}

function allApplications(project) {
  warnMultiEnv(project);
  return (project?.environments || []).flatMap(e => e.applications || []);
}

function allCompose(project) {
  warnMultiEnv(project);
  return (project?.environments || []).flatMap(e => e.compose || []);
}

// ---- Secret redaction (SCD-SEC-1/2): shared by the env + show inspection commands ----
// Policy: redact-by-default. Print a value only when nothing flags it as secret.
const SECRET_VALUE_RE = /^[A-Za-z0-9_+/=.|-]{24,}$/;        // long, spaceless, base64/hex/key-ish
const URL_USERINFO_RE = /:\/\/[^/@\s]+:[^/@\s]+@/;          // scheme://user:pass@host
// Unambiguous secret indicators — substring match is safe.
const STRONG_KEY_RE = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|SIGNING|WEBHOOK)/i;
// Short/ambiguous indicators — matched ONLY as whole `_`/camelCase segments so they don't
// false-positive inside ordinary words (PAT ⊄ "mountPath", SK ⊄ "task", API ⊄ "rapid").
const SHORT_KEY_TOKENS = new Set(['SK', 'PAT', 'PWD', 'DSN', 'URI', 'URL', 'CONN', 'API', 'ADMIN', 'JWT', 'HMAC', 'SALT', 'AUTH', 'PASS', 'SIGN', 'STRIPE', 'CLERK', 'RESEND', 'SSH']);
function keyLooksSecret(key) {
  if (!key) return false;
  if (STRONG_KEY_RE.test(key)) return true;
  return String(key).split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean)
    .some(s => SHORT_KEY_TOKENS.has(s.toUpperCase()));
}
// env subcommand: redact when the key looks secret, the value carries URL userinfo, or it's
// a long spaceless high-entropy token under an arbitrary key.
function isSecretEnv(key, value) {
  const v = value == null ? '' : String(value);
  return keyLooksSecret(key) || URL_USERINFO_RE.test(v) || (!/\s/.test(v) && SECRET_VALUE_RE.test(v));
}
function redactValue(value) {
  const v = value == null ? '' : String(value);
  return `‹redacted ${v.length} chars›`;
}
// Strip credentials embedded in a URL's userinfo: scheme://user:pass@host -> scheme://***@host
function maskUrlUserinfo(s) {
  return String(s).replace(/(\w+:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@');
}
// Fields on a Dokploy app/compose object (besides env) that carry credentials in cleartext.
const SECRET_FIELDS = new Set(['env', 'customGitSSHKey', 'registryPassword', 'dockerAuth', 'githubToken', 'gitlabToken']);
const URL_FIELDS = new Set(['customGitUrl', 'registryUrl']);
// SCD-SEC-3: credential-bearing field NAMES that appear NESTED in the Dokploy object
// (e.g. github.githubPrivateKey, gitlab.appPassword, mounts[].content file bodies).
const SECRET_FIELD_RE = /privatekey|private_key|password|passwd|secret|token|sshkey|ssh_key|dockerauth|credential|content/i;

// Redact a Dokploy app/compose object for safe `show` inspection (SCD-SEC-2 + SCD-SEC-3).
// Recurses into nested objects/arrays so credentials below the top level (github relation,
// mounts[].content, …) can't leak. Depth-capped against pathological/cyclic structures.
function redactObject(value, key, depth = 0) {
  if (depth > 8) return '‹redacted (max depth)›';
  if (Array.isArray(value)) return value.map(v => redactObject(v, key, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactObject(v, k, depth + 1);
    return out;
  }
  if (typeof value === 'string') {
    // Redact by field name (incl. nested github/gitlab private keys + mounts[].content) and
    // secret-looking env-style keys; mask URL userinfo anywhere. Deliberately NOT redacting
    // by value-shape here, so non-secret IDs (applicationId, composeId) stay visible in `show`.
    if (key && URL_FIELDS.has(key)) return maskUrlUserinfo(value); // show the repo, hide creds
    if (key && (SECRET_FIELDS.has(key) || SECRET_FIELD_RE.test(key) || keyLooksSecret(key))) return redactValue(value);
    if (URL_USERINFO_RE.test(value)) return maskUrlUserinfo(value);
  }
  return value;
}

module.exports = {
  getClient, parseArgs, findProject, allApplications, allCompose,
  isSecretEnv, redactValue, maskUrlUserinfo, redactObject,
};
