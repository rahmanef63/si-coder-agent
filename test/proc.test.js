'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const cpPath = require.resolve('child_process');
const procPath = require.resolve('../lib/proc');

// Install a stub child_process in require.cache, force-reload lib/proc to bind it,
// run fn(run, dockerExec), then restore the real modules.
function withStub(cpExports, fn) {
  const savedCp = require.cache[cpPath];
  const savedProc = require.cache[procPath];

  const stubMod = new Module(cpPath, module);
  stubMod.filename = cpPath;
  stubMod.loaded = true;
  stubMod.exports = cpExports;
  require.cache[cpPath] = stubMod;
  delete require.cache[procPath];

  try {
    return fn(require('../lib/proc'));
  } finally {
    if (savedCp) require.cache[cpPath] = savedCp; else delete require.cache[cpPath];
    if (savedProc) require.cache[procPath] = savedProc; else delete require.cache[procPath];
  }
}

// ---------------------------------------------------------------------------
// Group A: run() invariants
// ---------------------------------------------------------------------------

test('run(): shell:false is pinned — caller { shell:true } is overridden', () => {
  let captured;
  withStub({
    execFileSync: (file, args, opts) => { captured = opts; return 'out'; },
    spawnSync: () => {},
  }, ({ run }) => {
    run('echo', ['hi'], { shell: true });
  });
  assert.equal(captured.shell, false);
});

test('run(): encoding:utf8 is pinned — caller { encoding:latin1 } is overridden', () => {
  let captured;
  withStub({
    execFileSync: (file, args, opts) => { captured = opts; return ''; },
    spawnSync: () => {},
  }, ({ run }) => {
    run('echo', ['hi'], { encoding: 'latin1' });
  });
  assert.equal(captured.encoding, 'utf8');
});

test('run(): legitimate opts (cwd, env) pass through unchanged', () => {
  let captured;
  withStub({
    execFileSync: (file, args, opts) => { captured = opts; return ''; },
    spawnSync: () => {},
  }, ({ run }) => {
    run('git', ['--version'], { cwd: '/tmp', env: { PATH: '/usr/bin' } });
  });
  assert.equal(captured.cwd, '/tmp');
  assert.deepEqual(captured.env, { PATH: '/usr/bin' });
  assert.equal(captured.shell, false);
});

test('run(): returns the stdout string from execFileSync', () => {
  let result;
  withStub({
    execFileSync: () => 'hello\n',
    spawnSync: () => {},
  }, ({ run }) => {
    result = run('echo', ['hello']);
  });
  assert.equal(result, 'hello\n');
});

test('run(): propagates throws from execFileSync', () => {
  withStub({
    execFileSync: () => { throw new Error('ENOENT'); },
    spawnSync: () => {},
  }, ({ run }) => {
    assert.throws(() => run('missing', []), /ENOENT/);
  });
});

// ---------------------------------------------------------------------------
// Group B: dockerExec() option invariants
// ---------------------------------------------------------------------------

test('dockerExec(): shell:false is pinned — caller { shell:true } is overridden', () => {
  let captured;
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '1';
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => { captured = opts; return { status: 0, stdout: 'ok', stderr: '', error: null }; },
    }, ({ dockerExec }) => {
      dockerExec('mycontainer', ['ls'], { shell: true });
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(captured.shell, false);
});

test('dockerExec(): encoding:utf8 is pinned — caller { encoding:latin1 } is overridden', () => {
  let captured;
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '1';
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => { captured = opts; return { status: 0, stdout: '', stderr: '', error: null }; },
    }, ({ dockerExec }) => {
      dockerExec('mycontainer', ['ls'], { encoding: 'latin1' });
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(captured.encoding, 'utf8');
});

test('dockerExec(): maxBuffer is pinned — caller { maxBuffer:1 } cannot shrink it', () => {
  let captured;
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '1';
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => { captured = opts; return { status: 0, stdout: '', stderr: '', error: null }; },
    }, ({ dockerExec }) => {
      dockerExec('mycontainer', ['ls'], { maxBuffer: 1 });
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(captured.maxBuffer, 16 * 1024 * 1024);
});

// ---------------------------------------------------------------------------
// Group C: dockerExec() behavior paths
// ---------------------------------------------------------------------------

test('dockerExec(): plain docker path calls spawnSync with correct argv', () => {
  const calls = [];
  const orig = process.env.SC_DOCKER_SUDO;
  delete process.env.SC_DOCKER_SUDO;
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => { calls.push({ file, args }); return { status: 0, stdout: 'result', stderr: '', error: null }; },
    }, ({ dockerExec }) => {
      const out = dockerExec('mycontainer', ['ls', '-la']);
      assert.equal(out, 'result');
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'docker');
  assert.deepEqual(calls[0].args, ['exec', 'mycontainer', 'ls', '-la']);
});

test('dockerExec(): SC_DOCKER_SUDO=1 forces sudo path', () => {
  const calls = [];
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '1';
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => { calls.push({ file, args }); return { status: 0, stdout: '', stderr: '', error: null }; },
    }, ({ dockerExec }) => {
      dockerExec('mycontainer', ['ps']);
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'sudo');
  assert.deepEqual(calls[0].args, ['-n', 'docker', 'exec', 'mycontainer', 'ps']);
});

test('dockerExec(): SC_DOCKER_SUDO=0 forbids sudo fallback on permission denied', () => {
  const calls = [];
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '0';
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => {
        calls.push(file);
        return { status: 1, stdout: '', stderr: 'permission denied', error: null };
      },
    }, ({ dockerExec }) => {
      assert.throws(() => dockerExec('mycontainer', ['ls']), /docker exec mycontainer failed/);
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0], 'docker');
});

test('dockerExec(): falls back to sudo on "permission denied" when SC_DOCKER_SUDO unset', () => {
  const calls = [];
  const orig = process.env.SC_DOCKER_SUDO;
  delete process.env.SC_DOCKER_SUDO;
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => {
        calls.push(file);
        if (file === 'docker') return { status: 1, stdout: '', stderr: 'permission denied', error: null };
        return { status: 0, stdout: 'sudo-result', stderr: '', error: null };
      },
    }, ({ dockerExec }) => {
      const out = dockerExec('mycontainer', ['ls']);
      assert.equal(out, 'sudo-result');
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'docker');
  assert.equal(calls[1], 'sudo');
});

test('dockerExec(): falls back to sudo on "cannot connect to the docker daemon"', () => {
  const calls = [];
  const orig = process.env.SC_DOCKER_SUDO;
  delete process.env.SC_DOCKER_SUDO;
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: (file, args, opts) => {
        calls.push(file);
        if (file === 'docker') return { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', error: null };
        return { status: 0, stdout: 'ok', stderr: '', error: null };
      },
    }, ({ dockerExec }) => {
      dockerExec('mycontainer', ['ls']);
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
  assert.deepEqual(calls, ['docker', 'sudo']);
});

// ---------------------------------------------------------------------------
// Group D: dockerExec() error paths
// ---------------------------------------------------------------------------

test('dockerExec(): throws containerName required for empty string', () => {
  withStub({ execFileSync: () => {}, spawnSync: () => {} }, ({ dockerExec }) => {
    assert.throws(() => dockerExec('', ['ls']), /containerName required/);
  });
});

test('dockerExec(): throws containerName required for null', () => {
  withStub({ execFileSync: () => {}, spawnSync: () => {} }, ({ dockerExec }) => {
    assert.throws(() => dockerExec(null, ['ls']), /containerName required/);
  });
});

test('dockerExec(): throws containerName required for undefined', () => {
  withStub({ execFileSync: () => {}, spawnSync: () => {} }, ({ dockerExec }) => {
    assert.throws(() => dockerExec(undefined, ['ls']), /containerName required/);
  });
});

test('dockerExec(): rethrows res.error from spawnSync (e.g. ENOENT)', () => {
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '1';
  const err = new Error('ENOENT: no such file');
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: () => ({ error: err, status: null, stdout: '', stderr: '' }),
    }, ({ dockerExec }) => {
      assert.throws(() => dockerExec('mycontainer', ['ls']), (e) => e === err);
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
});

test('dockerExec(): throws with stderr message on non-zero exit status', () => {
  const orig = process.env.SC_DOCKER_SUDO;
  process.env.SC_DOCKER_SUDO = '1';
  try {
    withStub({
      execFileSync: () => {},
      spawnSync: () => ({ error: null, status: 1, stdout: '', stderr: 'No such container: mycontainer' }),
    }, ({ dockerExec }) => {
      assert.throws(
        () => dockerExec('mycontainer', ['ls']),
        /docker exec mycontainer failed \(1\): No such container: mycontainer/,
      );
    });
  } finally {
    if (orig === undefined) delete process.env.SC_DOCKER_SUDO; else process.env.SC_DOCKER_SUDO = orig;
  }
});
