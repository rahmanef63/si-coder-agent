// lib/github.js — GitHub REST + git push helpers
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Accept SSH (git@github.com:owner/repo.git) or https github URLs only.
const REPO_URL_RE = /^(git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git|https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?)$/;
function assertRepoUrl(repoUrl) {
  if (!repoUrl || !REPO_URL_RE.test(repoUrl)) {
    throw new Error(`refusing unsafe repoUrl: ${repoUrl}`);
  }
  return repoUrl;
}

function makeClient({ githubToken, timeoutMs = 15000 }) {
  if (!githubToken) throw new Error('GitHub client needs githubToken');

  async function call(endpoint, method = 'GET', body = null) {
    const url = `https://api.github.com${endpoint}`;
    const options = {
      method,
      headers: {
        Authorization: `token ${githubToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'SICoder-Agent',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
    }
    // Bound the request so a hung GitHub API socket can't hang currentUser/ensureRepo
    // forever. Mirrors lib/tls.js / lib/hostinger.js: timer armed across the body read so
    // a backend that sends headers then stalls the body still hits the timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res, text;
    try {
      res = await fetch(url, { ...options, signal: controller.signal });
      text = await res.text();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`GitHub timeout after ${timeoutMs}ms ${endpoint}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`GitHub ${res.status} ${endpoint}: ${typeof data === 'object' ? JSON.stringify(data) : data}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const currentUser = () => call('/user');

  async function ensureRepo({ owner, name, isPrivate = true, description }) {
    try {
      await call(`/repos/${owner}/${name}`);
      return { created: false };
    } catch (e) {
      if (e.status === 404) {
        await call('/user/repos', 'POST', {
          name, private: isPrivate, description: description || `Auto-generated repo for ${name}`,
        });
        return { created: true };
      }
      throw e;
    }
  }

  function pushLocalRepo({ cwd = process.cwd(), repoUrl, force = false }) {
    assertRepoUrl(repoUrl);
    const git = (args, extra = {}) => execFileSync('git', args, { stdio: 'ignore', cwd, ...extra });
    if (fs.existsSync(path.join(cwd, '.next'))) {
      console.log('🧹 clearing .next build cache...');
      fs.rmSync(path.join(cwd, '.next'), { recursive: true, force: true });
    }
    git(['config', '--global', 'init.defaultBranch', 'main']);
    try { git(['rev-parse', '--is-inside-work-tree']); }
    catch { git(['init']); }
    try { git(['remote', 'remove', 'origin']); } catch {}
    git(['remote', 'add', 'origin', repoUrl]);
    git(['add', '.']);
    try { git(['commit', '-m', 'Auto-deploy commit']); } catch {}
    let currentBranch = execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim();
    if (!currentBranch) currentBranch = 'main';
    const pushArgs = ['push', '-u', 'origin', currentBranch];
    if (force) pushArgs.push('--force');
    git(pushArgs);
    return currentBranch;
  }

  return { call, currentUser, ensureRepo, pushLocalRepo };
}

module.exports = { makeClient };
