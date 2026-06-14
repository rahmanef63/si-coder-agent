// lib/vercel.js — Vercel REST API client + deploy helpers
function makeClient({ token, teamId }) {
  if (!token) throw new Error('Vercel client needs token');
  const base = 'https://api.vercel.com';
  const tq = (sep) => (teamId ? `${sep}teamId=${encodeURIComponent(teamId)}` : '');

  async function call(endpoint, method = 'GET', body = null, { allow404 = false } = {}) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${base}${endpoint}${tq(sep)}`;
    const options = { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } };
    if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    const res = await fetch(url, options);
    const text = await res.text();
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
      // 409 = domain already assigned to this project; treat as present.
      if (/Vercel 409/.test(e.message)) return { name: host, alreadyExists: true };
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
    const labels = host.split('.');
    const isApex = labels.length <= 2; // example.com -> apex; app.example.com -> subdomain
    const pick = (arr) => (arr || []).slice().sort((a, b) => a.rank - b.rank)[0]?.value;
    const cnameVal = pick(cfg.recommendedCNAME);
    let recordType, value;
    if (cnameVal && !isApex) {
      // Prefer CNAME when Vercel recommends one and host is a subdomain.
      recordType = 'CNAME'; value = cnameVal;
    } else if (isApex) {
      recordType = 'A'; value = pick(cfg.recommendedIPv4) || '76.76.21.21';
    } else {
      recordType = 'CNAME'; value = cnameVal || 'cname.vercel-dns.com';
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
  function triggerDeploy({ projectId, name, ref = 'main', repoId, org, repo, prod }) {
    const gitSource = { type: 'github', ref };
    if (repoId) gitSource.repoId = repoId;
    else { gitSource.org = org; gitSource.repo = repo; }
    const body = { name, project: projectId, gitSource };
    if (prod) body.target = 'production';
    return call('/v13/deployments?forceNew=1&skipAutoDetectionConfirmation=1', 'POST', body);
  }

  const getDeployment = (idOrUrl) =>
    call(`/v13/deployments/${encodeURIComponent(idOrUrl)}`);

  const getLatestDeployment = (projectId) =>
    call(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1&target=production`);

  // ---- Teams ----
  const currentTeams = () => call('/v2/teams');

  return {
    call,
    findProject, createProject, findOrCreateProject,
    setEnvVars, setBuildCommand,
    addDomain, getProjectDomain, verifyDomain, getDomainConfig, getRequiredDns,
    triggerDeploy, getDeployment, getLatestDeployment,
    currentTeams,
  };
}

module.exports = { makeClient };
