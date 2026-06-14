// lib/proc.js — no-shell exec helpers (argv form) + docker exec with sudo fallback
const { execFileSync, spawnSync } = require('child_process');

// Run a binary with an argv array (NO shell). Returns stdout string.
function run(file, args, opts = {}) {
  return execFileSync(file, args, { encoding: 'utf8', ...opts });
}

// Run `docker exec <container> <cmd...>`. Tries the docker group first
// (plain `docker`), falls back to `sudo -n docker` only if docker is not
// permitted. SC_DOCKER_SUDO=1 forces sudo; SC_DOCKER_SUDO=0 forbids it.
function dockerExec(containerName, cmdArgs, opts = {}) {
  if (!containerName) throw new Error('containerName required');
  const force = process.env.SC_DOCKER_SUDO;
  const baseArgs = ['exec', containerName, ...cmdArgs];
  const tryRun = (file, args) =>
    spawnSync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...opts });

  let res;
  if (force === '1') {
    res = tryRun('sudo', ['-n', 'docker', ...baseArgs]);
  } else {
    res = tryRun('docker', baseArgs);
    const denied = res.error
      || (res.status !== 0 && /permission denied|cannot connect to the docker daemon/i.test(res.stderr || ''));
    if (denied && force !== '0') {
      res = tryRun('sudo', ['-n', 'docker', ...baseArgs]);
    }
  }
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`docker exec ${containerName} failed (${res.status}): ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

module.exports = { run, dockerExec };
