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
const SECRET_KEY_RE = /KEY|SECRET|TOKEN|PASS|URL|URI|DSN|CONN|CREDENTIAL|PRIVATE|AUTH|SK|PAT|SALT|SIGN|HMAC|JWT|RESEND|STRIPE|CLERK|WEBHOOK|ADMIN|API/i;
const SECRET_VALUE_RE = /^[A-Za-z0-9_+/=.|-]{24,}$/;        // long, spaceless, base64/hex/key-ish
const URL_USERINFO_RE = /:\/\/[^/@\s]+:[^/@\s]+@/;          // scheme://user:pass@host

function isSecretEnv(key, value) {
  const v = value == null ? '' : String(value);
  return SECRET_KEY_RE.test(key) || URL_USERINFO_RE.test(v) || (!/\s/.test(v) && SECRET_VALUE_RE.test(v));
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
// Redact a Dokploy app/compose object for safe `show` inspection (SCD-SEC-2).
function redactObject(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (SECRET_FIELDS.has(k)) out[k] = typeof v === 'string' ? redactValue(v) : (v == null ? v : '‹redacted›');
    else if (URL_FIELDS.has(k) && typeof v === 'string') out[k] = maskUrlUserinfo(v);
    else if (typeof v === 'string' && isSecretEnv(k, v)) out[k] = redactValue(v);
    else out[k] = v;
  }
  return out;
}

module.exports = {
  getClient, parseArgs, findProject, allApplications, allCompose,
  isSecretEnv, redactValue, maskUrlUserinfo, redactObject,
};
