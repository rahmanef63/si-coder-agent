// lib/dokploy.js — Dokploy REST API client + CRUD helpers
const { parseEnvString, mergeEnvString } = require('./env');

function makeClient({ apiUrl, apiKey, timeoutMs = 15000 }) {
  if (!apiUrl || !apiKey) throw new Error('Dokploy client needs apiUrl + apiKey');
  const baseUrl = apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;

  async function call(endpoint, method = 'GET', body = null) {
    const url = `${baseUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body) options.body = JSON.stringify(body);

    // Bound every call so a hung Dokploy backend can't stall a zero-human run (audit.js
    // fires an N×M sequential sweep of these). Mirrors lib/hostinger.js: keep the abort
    // timer armed across the body read so a backend that sends headers then stalls the
    // body still hits the timeout (the signal must cover .text(), not just connect).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const text = await res.text();
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
      if (!res.ok) {
        throw new Error(`Dokploy ${res.status} ${endpoint}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`Dokploy timeout after ${timeoutMs}ms ${endpoint}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Projects ----
  const listProjects = () => call('/project.all');
  const createProject = (name) => call('/project.create', 'POST', { name });
  async function findOrCreateProject(name) {
    const projects = await listProjects();
    let p = projects.find(x => x.name === name);
    if (!p) {
      await createProject(name);
      const refreshed = await listProjects();
      p = refreshed.find(x => x.name === name);
      if (!p) throw new Error(`Failed to create project ${name}`);
    }
    return p;
  }

  // ---- Compose ----
  const getCompose = (composeId) => call(`/compose.one?composeId=${composeId}`);
  const updateCompose = (payload) => call('/compose.update', 'POST', payload);
  const deployCompose = (composeId) => call('/compose.deploy', 'POST', { composeId });
  const deployComposeTemplate = (environmentId, templateId) => call('/compose.deployTemplate', 'POST', { environmentId, id: templateId });

  async function updateComposeEnv(composeId, updates) {
    const current = await getCompose(composeId);
    const nextEnv = mergeEnvString(current.env || '', updates);
    await updateCompose({ composeId, env: nextEnv });
    return parseEnvString(nextEnv);
  }

  // ---- Applications ----
  const getApplication = (applicationId) => call(`/application.one?applicationId=${applicationId}`);
  const createApplication = (payload) => call('/application.create', 'POST', payload);
  const updateApplication = (payload) => call('/application.update', 'POST', payload);
  const deployApplication = (applicationId) => call('/application.deploy', 'POST', { applicationId });
  const saveApplicationGithubProvider = (payload) => call('/application.saveGithubProvider', 'POST', payload);

  // ---- GitHub provider (Dokploy-side) ----
  async function getGithubProvider() {
    const providers = await call('/github.githubProviders');
    if (!Array.isArray(providers) || providers.length === 0) return null;
    return providers[0];
  }

  // ---- Domains ----
  const createDomain = (payload) => call('/domain.create', 'POST', payload);
  const deleteDomain = (domainId) => call('/domain.delete', 'POST', { domainId });

  function selectDomainsToDelete(domains = [], desiredHosts = []) {
    const desired = new Set(desiredHosts.filter(Boolean));
    const kept = new Set();
    const deletions = [];
    for (const d of domains) {
      const host = d.host;
      const isDesired = desired.has(host);
      const isTraefik = typeof host === 'string' && host.endsWith('.traefik.me');
      if (isDesired) {
        if (kept.has(host)) deletions.push(d);
        else kept.add(host);
        continue;
      }
      if (isTraefik || desired.size > 0) deletions.push(d);
    }
    return deletions;
  }

  async function cleanupComposeDomains(composeId, desiredHosts = []) {
    const current = await getCompose(composeId);
    const deletions = selectDomainsToDelete(current.domains || [], desiredHosts);
    for (const d of deletions) {
      try { await deleteDomain(d.domainId); console.log(`🧹 removed compose domain ${d.host}`); }
      catch (e) { console.warn(`⚠️ failed to remove ${d.host}: ${e.message}`); }
    }
  }

  async function cleanupApplicationDomains(applicationId, desiredHosts = []) {
    const current = await getApplication(applicationId);
    const deletions = selectDomainsToDelete(current.domains || [], desiredHosts);
    for (const d of deletions) {
      try { await deleteDomain(d.domainId); console.log(`🧹 removed app domain ${d.host}`); }
      catch (e) { console.warn(`⚠️ failed to remove ${d.host}: ${e.message}`); }
    }
  }

  return {
    call,
    // projects
    listProjects, createProject, findOrCreateProject,
    // compose
    getCompose, updateCompose, deployCompose, deployComposeTemplate, updateComposeEnv,
    // applications
    getApplication, createApplication, updateApplication, deployApplication, saveApplicationGithubProvider,
    getGithubProvider,
    // domains
    createDomain, deleteDomain, selectDomainsToDelete,
    cleanupComposeDomains, cleanupApplicationDomains,
  };
}

module.exports = { makeClient };
