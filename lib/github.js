// lib/github.js — GitHub REST + git push helpers
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function makeClient({ githubToken }) {
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
    const res = await fetch(url, options);
    const text = await res.text();
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

  function pushLocalRepo({ cwd = process.cwd(), repoUrl, force = true }) {
    const opts = { stdio: 'ignore', cwd };
    if (fs.existsSync(path.join(cwd, '.next'))) {
      console.log('🧹 clearing .next build cache...');
      execSync('rm -rf .next', { cwd });
    }
    execSync('git config --global init.defaultBranch main', { stdio: 'ignore' });
    try { execSync('git rev-parse --is-inside-work-tree', opts); }
    catch { execSync('git init', { cwd }); }
    try { execSync('git remote remove origin', opts); } catch {}
    execSync(`git remote add origin ${repoUrl}`, { cwd });
    execSync('git add .', { cwd });
    try { execSync('git commit -m "Auto-deploy commit"', opts); } catch {}
    let currentBranch = execSync('git branch --show-current', { cwd }).toString().trim();
    if (!currentBranch) currentBranch = 'main';
    const pushCmd = `git push -u origin ${currentBranch}${force ? ' --force' : ''}`;
    execSync(pushCmd, opts);
    return currentBranch;
  }

  return { call, currentUser, ensureRepo, pushLocalRepo };
}

module.exports = { makeClient };
