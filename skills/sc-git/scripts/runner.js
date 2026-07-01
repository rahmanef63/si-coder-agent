#!/usr/bin/env node
// runner.js — self-hosted GitHub Actions runner (host from $SC_GIT_VPS_HOST)
// Prints commands to run on VPS rather than auto-executing (safer + transparent)
const { parseArgs, ghApi, repoExists, OWNER, log, ok, err, warn } = require('./_shared');

const VPS_HOST = process.env.SC_GIT_VPS_HOST || '<your-vps-host>';
const VPS_LABEL = VPS_HOST.replace(/[^a-zA-Z0-9_-]/g, '') || 'runner'; // safe runner label derived from the host
const RUNNER_HOME = process.env.SC_GIT_RUNNER_HOME || '~/actions-runner';
const RUNNER_VERSION = process.env.SC_GIT_RUNNER_VERSION || '2.319.1';

function setupCmds() {
  return `# Run on VPS ${VPS_HOST} once to bootstrap runner host:
mkdir -p ${RUNNER_HOME} && cd ${RUNNER_HOME}
curl -o actions-runner.tar.gz -L \\
  https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz
tar xzf actions-runner.tar.gz
sudo ./bin/installdependencies.sh
# install as systemd service after first ./config.sh registration:
# sudo ./svc.sh install && sudo ./svc.sh start`;
}

function registerCmds(repo, token) {
  return `# Register runner for ${OWNER}/${repo} on VPS ${VPS_HOST}:
cd ${RUNNER_HOME}
./config.sh \\
  --url https://github.com/${OWNER}/${repo} \\
  --token ${token} \\
  --name vps-${repo} \\
  --labels self-hosted,linux,x64,vps-${VPS_LABEL} \\
  --work _work \\
  --unattended \\
  --replace
sudo ./svc.sh install && sudo ./svc.sh start`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (cmd === 'setup') {
    log('## Runner host bootstrap');
    log('```bash');
    log(setupCmds());
    log('```');
    return;
  }

  if (cmd === 'register') {
    const repo = args.repo;
    if (!repo) { err('--repo required'); process.exit(1); }
    if (!repoExists(repo)) { err(`repo ${OWNER}/${repo} not found`); process.exit(1); }
    const meta = ghApi(`repos/${OWNER}/${repo}`);
    if (!meta.private) {
      warn('repo is PUBLIC — self-hosted runner on public repo is a security risk (GitHub recommends against).');
      if (!args.force) { err('refused. re-run with --force if intentional.'); process.exit(1); }
    }
    const tokenRes = ghApi(`repos/${OWNER}/${repo}/actions/runners/registration-token`, { method: 'POST' });
    log(`## Register runner for ${OWNER}/${repo}`);
    log('```bash');
    log(registerCmds(repo, tokenRes.token));
    log('```');
    log(`\nToken expires: ${tokenRes.expires_at}`);
    log(`\nAfter registration, change workflow to:`);
    log('```yaml');
    log('runs-on: [self-hosted, linux, x64]');
    log('```');
    return;
  }

  if (cmd === 'list') {
    const repo = args.repo;
    if (repo) {
      const runners = ghApi(`repos/${OWNER}/${repo}/actions/runners`);
      console.table((runners.runners || []).map(r => ({ id: r.id, name: r.name, status: r.status, busy: r.busy, labels: (r.labels || []).map(l => l.name).join(',') })));
    } else {
      // org-level (works only if org)
      try {
        const runners = ghApi(`orgs/${OWNER}/actions/runners`);
        console.table((runners.runners || []).map(r => ({ id: r.id, name: r.name, status: r.status })));
      } catch (e) {
        warn('org-level list failed (user account, not org). pass --repo <name>.');
      }
    }
    return;
  }

  if (cmd === 'remove') {
    const repo = args.repo;
    const id = args.id;
    if (!repo || !id) { err('--repo + --id required'); process.exit(1); }
    ghApi(`repos/${OWNER}/${repo}/actions/runners/${id}`, { method: 'DELETE' });
    ok(`removed runner ${id} from ${repo}`);
    return;
  }

  err('Usage: runner.js setup|register|list|remove [--repo <name>] [--id <id>] [--force]');
  process.exit(1);
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
