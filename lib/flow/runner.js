'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { interpolate } = require('./template');
const { assertAllowedUses, assertFlowSecrets } = require('./security');
const { loadFlow, ROOT } = require('./load');

function nowIso() { return new Date().toISOString(); }

function spawnCapture(file, argv, { cwd, input, env, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, argv, {
      cwd,
      env: env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ code: 124, stdout, stderr: stderr + `\ntimeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', c => { stdout += c; if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(0, 2 * 1024 * 1024); });
    child.stderr.on('data', c => { stderr += c; if (stderr.length > 512 * 1024) stderr = stderr.slice(0, 512 * 1024); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: String(err.message || err) });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code === null ? 1 : code, stdout, stderr });
    });
    if (input !== undefined && input !== null) {
      child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
    } else {
      child.stdin.end();
    }
  });
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function parseStdoutJson(stdout) {
  const parsed = tryParseJson(stdout);
  if (parsed !== null) return parsed;
  // Prefer the last JSON object in mixed stdout.
  const match = String(stdout || '').match(/\{[\s\S]*\}\s*$/);
  if (match) {
    const again = tryParseJson(match[0]);
    if (again !== null) return again;
  }
  return { stdout: String(stdout || '') };
}

async function handleScFn(stepWith, { root, dryRun }) {
  const name = stepWith.name;
  if (typeof name !== 'string' || !name.trim()) throw new Error('sc.fn requires with.name');
  const input = stepWith.input === undefined ? {} : stepWith.input;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('sc.fn with.input must be an object when present');
  }
  assertFlowSecrets(input, `sc.fn:${name}:input`);
  const agent = path.join(root, 'scripts/sc-agent.js');
  if (dryRun) {
    return { dryRun: true, uses: 'sc.fn', name, input };
  }
  const result = await spawnCapture(process.execPath, [agent, name], {
    cwd: root,
    input,
  });
  const output = parseStdoutJson(result.stdout);
  if (result.code !== 0) {
    const err = result.stderr.trim() || (output && output.error) || `sc.fn ${name} exited ${result.code}`;
    const error = new Error(typeof err === 'string' ? err : JSON.stringify(err));
    error.output = output;
    error.code = result.code;
    throw error;
  }
  return output;
}

async function handleScCli(stepWith, { root, dryRun }) {
  let argv = stepWith.argv;
  if (!Array.isArray(argv) || !argv.length) throw new Error('sc.cli requires with.argv string array');
  argv = argv.map(x => {
    if (typeof x !== 'string') throw new Error('sc.cli argv entries must be strings');
    if (/[\s;$`|&<>]/.test(x)) throw new Error(`sc.cli rejects shell-metacharacter argv entry: ${JSON.stringify(x)}`);
    return x;
  });
  const entry = path.join(root, 'bin/sc-entry.js');
  if (dryRun) {
    return { dryRun: true, uses: 'sc.cli', argv };
  }
  const result = await spawnCapture(process.execPath, [entry, ...argv], { cwd: root });
  const output = parseStdoutJson(result.stdout);
  if (result.code !== 0) {
    const err = result.stderr.trim() || `sc.cli exited ${result.code}`;
    const error = new Error(err);
    error.output = output;
    error.code = result.code;
    throw error;
  }
  return output;
}

async function handleProviderMcp(stepWith, { dryRun }) {
  const provider = stepWith.provider;
  const user = stepWith.user;
  const connection = stepWith.connection;
  const tool = stepWith.tool;
  const toolArgs = stepWith.arguments === undefined ? {} : stepWith.arguments;
  const confirm = stepWith.confirm;

  if (typeof provider !== 'string' || !provider.trim()) throw new Error('provider.mcp requires with.provider');
  if (typeof user !== 'string' || !user.trim()) throw new Error('provider.mcp requires with.user');
  if (typeof connection !== 'string' || !connection.trim()) throw new Error('provider.mcp requires with.connection');
  if (typeof tool !== 'string' || !tool.trim()) throw new Error('provider.mcp requires with.tool');
  if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
    throw new Error('provider.mcp with.arguments must be an object');
  }
  if (confirm !== true) throw new Error('provider.mcp requires with.confirm=true');
  assertFlowSecrets({ user, connection, tool, arguments: toolArgs }, 'provider.mcp');

  if (dryRun) {
    return { dryRun: true, uses: 'provider.mcp', provider, user, connection, tool, arguments: toolArgs, confirm: true };
  }

  if (provider === 'doku') {
    const C = require('../connections');
    const D = require('../doku-mcp');
    const conn = C.get(user, 'doku', connection);
    if (conn.source !== 'sc' || conn.authMethod !== 'mcp-api-key') {
      throw new Error('DOKU MCP requires source=sc auth method mcp-api-key');
    }
    const values = C.readValues(user, 'doku', conn.id);
    const response = await D.call(values, tool, toolArgs);
    return { provider, user, connection: conn.id, tool, environment: response.environment, result: response.result };
  }

  if (provider === 'hostinger') {
    const H = require('../hostinger-mail');
    if (tool === 'orders') return { provider, user, connection, tool, result: await H.orders(user, connection) };
    if (tool === 'list') {
      return {
        provider, user, connection, tool,
        result: await H.list(user, connection, toolArgs.resource, toolArgs.orderId, toolArgs.page),
      };
    }
    if (tool === 'logs') {
      return {
        provider, user, connection, tool,
        result: await H.logs(user, connection, toolArgs.kind, toolArgs.orderId, toolArgs.page),
      };
    }
    if (tool === 'mutate') {
      return {
        provider, user, connection, tool,
        result: await H.mutate(user, connection, toolArgs.operation, toolArgs.arguments || toolArgs),
      };
    }
    throw new Error(`unsupported hostinger mail tool "${tool}" (orders|list|logs|mutate)`);
  }

  throw new Error(`unsupported provider.mcp provider "${provider}" (supported: doku, hostinger)`);
}

async function handleFlow(stepWith, opts) {
  const flowId = stepWith.flow;
  if (typeof flowId !== 'string' || !flowId.trim()) throw new Error('flow step requires with.flow');
  const props = stepWith.props === undefined ? {} : stepWith.props;
  if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('flow with.props must be an object');
  if (opts.dryRun) {
    return { dryRun: true, uses: 'flow', flow: flowId, props, depth: opts.depth + 1 };
  }
  const childDoc = loadFlow(flowId, { root: opts.root });
  const result = await runFlow(childDoc, {
    props,
    parallel: opts.parallel,
    dryRun: opts.dryRun,
    root: opts.root,
    depth: opts.depth + 1,
    maxDepth: opts.maxDepth,
  });
  if (!result.ok) {
    const error = new Error(result.error || result.steps && Object.values(result.steps).find(s => s && s.error)?.error || `subflow ${flowId} failed`);
    error.output = result;
    throw error;
  }
  return result;
}

async function runStep(step, ctx, opts) {
  assertAllowedUses(step.uses);
  const interpolated = interpolate(step.with || {}, ctx);
  assertFlowSecrets(interpolated, `step:${step.id}:with`);

  if (opts.dryRun && step.uses !== 'flow') {
    // Still dispatch so handlers return dry-run payloads consistently.
  }

  switch (step.uses) {
    case 'sc.fn': return handleScFn(interpolated, opts);
    case 'sc.cli': return handleScCli(interpolated, opts);
    case 'provider.mcp': return handleProviderMcp(interpolated, opts);
    case 'flow': return handleFlow(interpolated, opts);
    default: throw new Error(`unsupported uses: ${step.uses}`);
  }
}

function truthyWhen(when, ctx) {
  if (when === undefined || when === null || when === '') return true;
  // MVP stub: interpolate and treat non-empty / non-falsey strings as true.
  const value = interpolate(when, ctx);
  if (value === false || value === 0 || value === 'false' || value === '0' || value === '' || value == null) return false;
  return true;
}

async function runFlow(doc, {
  props = {},
  parallel = 4,
  dryRun = false,
  root = ROOT,
  depth = 0,
  maxDepth = 5,
} = {}) {
  if (depth > maxDepth) {
    throw new Error(`flow recursion exceeded maxDepth=${maxDepth}`);
  }
  if (!props || typeof props !== 'object' || Array.isArray(props)) {
    throw new Error('props must be an object');
  }
  assertFlowSecrets(props, 'flow.props');

  // Apply simple defaults from JSON Schema props.properties.*.default
  const mergedProps = { ...props };
  const schemaProps = doc.props && doc.props.properties && typeof doc.props.properties === 'object'
    ? doc.props.properties
    : {};
  for (const [key, schema] of Object.entries(schemaProps)) {
    if (mergedProps[key] === undefined && schema && Object.prototype.hasOwnProperty.call(schema, 'default')) {
      mergedProps[key] = schema.default;
    }
  }

  const startedAt = nowIso();
  const steps = {};
  const pending = new Map(doc.steps.map(s => [s.id, s]));
  const running = new Map();
  const limit = Math.max(1, Math.min(32, Number(parallel) || 4));
  let failed = false;
  let fatalError = null;

  const ctx = () => ({ props: mergedProps, steps });

  function readyIds() {
    const out = [];
    for (const [id, step] of pending) {
      const needs = step.needs || [];
      const ready = needs.every(n => steps[n] && (steps[n].ok || steps[n].continued));
      if (ready) out.push(id);
    }
    return out;
  }

  async function launch(id) {
    const step = pending.get(id);
    pending.delete(id);
    const t0 = Date.now();
    const promise = (async () => {
      try {
        if (!truthyWhen(step.when, ctx())) {
          steps[id] = { ok: true, skipped: true, ms: Date.now() - t0, output: { skipped: true } };
          return;
        }
        const output = await runStep(step, ctx(), { props: mergedProps, parallel: limit, dryRun, root, depth, maxDepth });
        steps[id] = { ok: true, ms: Date.now() - t0, output };
      } catch (e) {
        const entry = {
          ok: false,
          ms: Date.now() - t0,
          output: e.output || null,
          error: String(e.message || e),
        };
        if (step.continueOnError === true) {
          entry.continued = true;
          steps[id] = entry;
        } else {
          steps[id] = entry;
          failed = true;
          fatalError = e;
          // Cancel launching more; in-flight continue but new ready steps stop.
        }
      }
    })();
    running.set(id, promise);
    try { await promise; }
    finally { running.delete(id); }
  }

  while (pending.size || running.size) {
    if (failed) {
      // Wait for in-flight only; do not start new work.
      if (!running.size) break;
      await Promise.race([...running.values()]);
      continue;
    }
    const ready = readyIds().filter(id => !running.has(id));
    while (running.size < limit && ready.length) {
      const id = ready.shift();
      // fire and track without awaiting individually here
      launch(id);
    }
    if (!running.size && pending.size) {
      // Deadlock: remaining steps depend on failed/missing parents.
      failed = true;
      fatalError = fatalError || new Error('flow stalled: remaining steps cannot become ready');
      for (const [id] of pending) {
        steps[id] = { ok: false, ms: 0, output: null, error: 'not started (dependency failure or stall)' };
      }
      pending.clear();
      break;
    }
    if (running.size) await Promise.race([...running.values()]);
  }

  const finishedAt = nowIso();
  const ok = !failed && Object.values(steps).every(s => s.ok || s.continued);
  const result = {
    id: doc.id,
    ok,
    dryRun: Boolean(dryRun),
    props: mergedProps,
    steps,
    startedAt,
    finishedAt,
  };
  if (!ok && fatalError) result.error = String(fatalError.message || fatalError);
  return result;
}

module.exports = { runFlow };
