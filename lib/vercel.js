// lib/vercel.js — Vercel REST API client + deploy helpers

// Bound every Vercel API call so a hung connection can't stall a zero-human run; without
// this, deploy.js step 10's 15-min poll cap (re-checked only BETWEEN awaits) is never
// reached when an await hangs. Mirrors lib/hostinger.js: keep the abort timer armed across
// the body read so a backend that sends headers then stalls the body still hits the
// timeout. Returns a thin envelope {ok,status,text} with the body already consumed under
// the live signal. Node 22 global fetch (undici) has no default request timeout.
const VERCEL_TIMEOUT_MS = 15000;
async function fetchWithTimeout(url, init = {}, timeoutMs = VERCEL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`Vercel timeout after ${timeoutMs}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function makeClient({ token, teamId, timeoutMs = VERCEL_TIMEOUT_MS }) {
  if (!token) throw new Error('Vercel client needs token');
  const base = 'https://api.vercel.com';
  const tq = (sep) => (teamId ? `${sep}teamId=${encodeURIComponent(teamId)}` : '');

  async function call(endpoint, method = 'GET', body = null, { allow404 = false } = {}) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${base}${endpoint}${tq(sep)}`;
    const options = { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } };
    if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    const res = await fetchWithTimeout(url, options, timeoutMs);
    const text = res.text;
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) throw new Error(`Vercel ${res.status} ${endpoint}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
    return data;
  }

  // ---- Projects ----
  const findProject = (idOrName) =>
    call(`/v9/projects/${encodeURIComponent(idOrName)}`, 'GET', null, { allow404: true });

  function createProject({ name, gitRepo, framework = 'nextjs' }) {
    const body = { name, framework };
    if (gitRepo) body.gitRepository = { type: 'github', repo: gitRepo };
    return call('/v11/projects', 'POST', body);
  }

  async function findOrCreateProject({ name, gitRepo, framework = 'nextjs' }) {
    const existing = await findProject(name);
    if (existing) return existing;
    return createProject({ name, gitRepo, framework });
  }

  // ---- Env vars ----
  function setEnvVars(projectId, vars = [], targets = ['production', 'preview', 'development']) {
    const body = vars.map(v => ({
      key: v.key,
      value: v.value,
      type: v.type || 'encrypted',
      target: v.target || targets,
    }));
    return call(`/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`, 'POST', body);
  }

  // ---- Build command ----
  const setBuildCommand = (projectId, cmd) =>
    call(`/v9/projects/${encodeURIComponent(projectId)}`, 'PATCH', { buildCommand: cmd });

  // ---- Domains ----
  async function addDomain(projectId, host) {
    try {
      return await call(`/v10/projects/${encodeURIComponent(projectId)}/domains`, 'POST', { name: host });
    } catch (e) {
      // Vercel returns 409 for BOTH 'domain already on THIS project' (benign) and
      // 'domain owned by ANOTHER project/team' (must surface). Disambiguate by asking
      // THIS project for the domain: if it's here, it's benign; otherwise it's owned
      // elsewhere and we must NOT silently swallow it.
      if (/Vercel 409\b/.test(e.message)) {
        let pd = null;
        try { pd = await getProjectDomain(projectId, host); } catch { pd = null; }
        if (pd) return { name: host, alreadyExists: true };
        return { name: host, conflict: true };
      }
      throw e;
    }
  }

  const getProjectDomain = (projectId, host) =>
    call(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(host)}`, 'GET', null, { allow404: true });

  const verifyDomain = (projectId, host) =>
    call(`/v10/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(host)}/verify`, 'POST', {});

  const getDomainConfig = (host, projectId) =>
    call(`/v6/domains/${encodeURIComponent(host)}/config?projectIdOrName=${encodeURIComponent(projectId)}`);

  // Resolve the exact DNS record the host wants for `host`, based on apex vs subdomain.
  // Apex (e.g. example.com) cannot CNAME -> use A to recommendedIPv4[rank=1].value.
  // Subdomain (e.g. app.example.com) -> CNAME to recommendedCNAME[rank=1].value.
  // §16.6: prefer CNAME when recommendedCNAME is non-empty, else fall back to label-count.
  // Returns { recordType:'A'|'CNAME', value, misconfigured, txt? } where txt is the
  // ownership challenge if unverified.
  async function getRequiredDns(projectId, host) {
    const cfg = await getDomainConfig(host, projectId);
    // SCV-1: a recommended record's `.value` can be a STRING or an ARRAY of candidate
    // targets (Vercel returns multiple IPv4s for some apexes). Normalize to a single
    // scalar string so a raw array can't be written as a broken A/CNAME record.
    const pick = (arr) => {
      let v = (arr || []).slice().sort((a, b) => a.rank - b.rank)[0]?.value;
      if (Array.isArray(v)) v = v[0];
      if (v && typeof v === 'object') v = v.value ?? (Array.isArray(v.values) ? v.values[0] : undefined);
      return v == null ? undefined : String(v);
    };
    const cnameVal = pick(cfg.recommendedCNAME);
    const ipv4Val = pick(cfg.recommendedIPv4);
    // Apex zones cannot CNAME and need an A record. The naive `labels.length <= 2` heuristic
    // misclassifies apexes on multi-label public suffixes (e.g. example.co.uk = 3 labels),
    // so prefer Vercel's own signal: no recommended CNAME + a recommended IPv4 means apex.
    // Fall back to label-count only when Vercel gives no usable signal.
    const labels = host.split('.');
    const isApex = (!cnameVal && !!ipv4Val) || labels.length <= 2;
    let recordType, value;
    if (cnameVal && !isApex) {
      // Prefer CNAME when Vercel recommends one and host is a subdomain.
      recordType = 'CNAME'; value = cnameVal;
    } else if (isApex) {
      recordType = 'A'; value = ipv4Val || '76.76.21.21';
    } else {
      recordType = 'CNAME'; value = cnameVal || 'cname.vercel-dns.com';
    }
    // SCV-1: never hand the DNS writer a non-IPv4 A target (would emit a broken record).
    // Octets are range-checked (0-255) so a CNAME-shaped or out-of-range string is rejected.
    const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
    if (recordType === 'A' && !IPV4_RE.test(value || '')) {
      throw new Error(`Vercel returned an unexpected A-record target for ${host}: ${JSON.stringify(value)} (expected a dotted-quad IPv4).`);
    }
    // ownership TXT (only when domain not yet verified)
    let txt;
    const pd = await getProjectDomain(projectId, host).catch(() => null);
    if (pd && pd.verified === false && Array.isArray(pd.verification)) {
      const t = pd.verification.find(v => v.type === 'TXT');
      if (t) txt = { name: t.domain, value: t.value };
    }
    return { recordType, value, misconfigured: cfg.misconfigured, txt };
  }

  // ---- Deployments ----
  function triggerDeploy({ projectId, name, ref = 'main', org, repo, prod }) {
    const gitSource = { type: 'github', ref, org, repo };
    const body = { name, project: projectId, gitSource };
    if (prod) body.target = 'production';
    return call('/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1', 'POST', body);
  }

  const getDeployment = (idOrUrl) =>
    call(`/v13/deployments/${encodeURIComponent(idOrUrl)}`);

  return {
    call,
    findProject, createProject, findOrCreateProject,
    setEnvVars, setBuildCommand,
    addDomain, getProjectDomain, verifyDomain, getDomainConfig, getRequiredDns,
    triggerDeploy, getDeployment,
  };
}

module.exports = { makeClient };
