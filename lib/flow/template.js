'use strict';

function getByPath(obj, path) {
  if (path === '' || path == null) return obj;
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (!(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function resolveToken(expr, ctx) {
  const raw = String(expr || '').trim();
  if (!raw) throw new Error('empty template token');
  const optional = raw.endsWith('?');
  const path = optional ? raw.slice(0, -1) : raw;

  let value;
  if (path.startsWith('props.')) value = getByPath(ctx.props, path.slice(6));
  else if (path === 'props') value = ctx.props;
  else if (path.startsWith('steps.')) value = getByPath(ctx.steps, path.slice(6));
  else if (path === 'steps') value = ctx.steps;
  else throw new Error(`unsupported template root in "${raw}" (use props.* or steps.*)`);

  if (value === undefined) {
    if (optional) return undefined;
    throw new Error(`template path not found: ${path}`);
  }
  return value;
}

/**
 * Interpolate {{props...}} / {{steps...}} tokens.
 * If the entire string is a single token and the resolved value is non-string,
 * return the raw value so arrays/objects can pass through.
 */
function interpolate(value, ctx) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => interpolate(v, ctx));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, ctx);
    return out;
  }
  if (typeof value !== 'string') return value;

  const whole = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  if (whole) {
    const resolved = resolveToken(whole[1], ctx);
    return resolved === undefined ? undefined : resolved;
  }

  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, expr) => {
    const resolved = resolveToken(expr, ctx);
    if (resolved === undefined) return '';
    if (resolved === null) return 'null';
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved);
  });
}

module.exports = { getByPath, resolveToken, interpolate };
