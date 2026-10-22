'use strict';
// MCP tool contract helpers (adopted from MSO lib/mcp tool-contract: every tool carries
// readOnly/destructive/idempotent/openWorld hints; and from connectors-gateway: validate
// arguments against the registry schema before anything executes).
const READ_ONLY = /\.(list|show|which|status|doctor|version|check|plan|risk|query|tools|orders|logs|observe|validate|interview|export)$|\.(credentials\.status|credential\.status|connections\.list|providers\.list|recipe\.list|flow\.list|flow\.show|update\.check)$/;
const DESTRUCTIVE = /\.(delete|unmap|key-remove|mutate|import|rename|update)$|^sc\.update$|^sc\.flow\.run$/;
const OPEN_WORLD = /(verify|doctor|update|hostinger|doku|flow\.run|deploy|connection\.request|credential\.request)/;

function annotationsFor(fn) {
  const name = fn.name;
  const readOnlyHint = READ_ONLY.test(name) && !/^sc\.update$/.test(name);
  const destructiveHint = !readOnlyHint && DESTRUCTIVE.test(name);
  return {
    readOnlyHint,
    destructiveHint,
    idempotentHint: readOnlyHint,
    openWorldHint: OPEN_WORLD.test(name),
    ...(fn.annotations || {}),
  };
}

const TYPE_OK = {
  string: v => typeof v === 'string',
  boolean: v => typeof v === 'boolean',
  integer: v => Number.isInteger(v),
  number: v => typeof v === 'number' && Number.isFinite(v),
  array: v => Array.isArray(v),
  object: v => v !== null && typeof v === 'object' && !Array.isArray(v),
};

// Shallow JSON-schema check: top-level type, required, additionalProperties:false,
// per-property type/enum/maxLength/min/max. Returns list of problems (empty = valid).
function validateArgs(schema, args) {
  const errs = [];
  if (!TYPE_OK.object(args)) return ['arguments must be an object'];
  const props = schema?.properties || {};
  for (const k of schema?.required || []) if (!(k in args)) errs.push(`missing required "${k}"`);
  for (const [k, v] of Object.entries(args)) {
    const p = props[k];
    if (!p) { if (schema?.additionalProperties === false) errs.push(`unknown argument "${k}"`); continue; }
    const types = Array.isArray(p.type) ? p.type : (p.type ? [p.type] : []);
    if (types.length && !types.some(t => (TYPE_OK[t] || (() => v === null))(v))) { errs.push(`"${k}" must be ${types.join('|')}`); continue; }
    if (p.enum && !p.enum.includes(v)) errs.push(`"${k}" must be one of ${p.enum.join(', ')}`);
    if (typeof v === 'string' && Number.isFinite(p.maxLength) && v.length > p.maxLength) errs.push(`"${k}" exceeds maxLength ${p.maxLength}`);
    if (typeof v === 'number' && Number.isFinite(p.minimum) && v < p.minimum) errs.push(`"${k}" below minimum ${p.minimum}`);
    if (typeof v === 'number' && Number.isFinite(p.maximum) && v > p.maximum) errs.push(`"${k}" above maximum ${p.maximum}`);
  }
  return errs;
}

module.exports = { annotationsFor, validateArgs };
