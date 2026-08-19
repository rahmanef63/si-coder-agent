// lib/output-styles.js — Owner-selectable output token-savers for the si-coder agent.
//
// Ported from the MSO project (rahmanef63/mso, app/api/assistant/route.ts, OsConfig.tokenSaver),
// which appends one of these to the assistant's system prompt. The si-coder skills are consumed
// BY an agent (Claude Code / the "si-coder" agent), so here the same idea is an env-selected
// instruction the agent adopts for its sc-* output: SC_OUTPUT_STYLE=off|caveman|ponytail.
//
// These change only OUTPUT phrasing. They never change what a skill DOES — deploy behaviour,
// idempotency, and the "secrets via env only" rules are unaffected.
const STYLES = {
  off: '',
  // Terse. Strip everything that isn't substance; keep code and errors exact.
  caveman:
    'Output style — terse like a smart caveman: drop articles/filler/pleasantries, ' +
    'fragments OK, short synonyms. Keep ALL technical substance and exact code/errors verbatim.',
  // Minimal. The shortest thing that works, code first, almost no prose.
  ponytail:
    'Output style — lazy senior dev: the shortest solution that works, no unrequested ' +
    'abstractions or boilerplate. Code first, then at most three short lines of explanation.',
};

const STYLE_NAMES = Object.keys(STYLES);

// One-line description per style for `--list` and docs.
const STYLE_BLURBS = {
  off: 'default — no output-style instruction added',
  caveman: 'terse: drop filler, keep all technical substance + verbatim code/errors',
  ponytail: 'lazy senior dev: shortest working solution, code first, ≤3 lines of prose',
};

// Resolve a raw value (from SC_OUTPUT_STYLE or a flag) to a known style name.
// Unknown / empty / whitespace → 'off' (fail-safe: never inject a garbage instruction).
function resolveStyle(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return STYLE_NAMES.includes(v) ? v : 'off';
}

// The prompt snippet to append for a given value, or '' when off/unknown.
function stylePrompt(raw) {
  return STYLES[resolveStyle(raw)];
}

module.exports = { STYLES, STYLE_NAMES, STYLE_BLURBS, resolveStyle, stylePrompt };
