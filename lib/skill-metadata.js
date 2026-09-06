'use strict';

const fs = require('fs');

const AUTO_TAG_VERSION = 'auto-v1';
const MAX_INDEX_BODY = 12_000;

const STOPWORDS = new Set([
  'the','and','for','with','from','into','when','where','what','this','that','these','those','then','than','your','you','user','users','use','using','used','skill','skills','coder','si','sc','agent','agents','work','works','working','task','tasks','project','projects','current','existing','new','make','create','build','change','changes','update','manage','management','support','supports','should','must','can','will','only','also','other','more','less','before','after','through','without','within','while','across','about','against','between','under','over','same','normal','default','explicit','specific','general','available','required','request','requested','result','results','verify','verification','quality','system','workflow','workflows','tool','tools','host','hosts','compatible','standalone','implementation','instructions','purpose','do','does','not','or','a','an','of','to','in','on','is','are','be','as','it','its','by','if','at','we','they','their','our','all'
]);

const TAG_RULES = [
  ['ui', ['ui','user interface','visual interface','visual design','styling','typography','spacing','layout','component states']],
  ['ux', ['ux','user experience','usability','user flow','interaction design','navigation flow']],
  ['frontend', ['frontend','front end','react','next.js','nextjs','svelte','css','tailwind','responsive interface','sc-fe']],
  ['design-system', ['design system','design-system','tokens','component library','visual consistency']],
  ['accessibility', ['accessibility','a11y','wcag','screen reader','keyboard navigation','contrast']],
  ['developer-experience', ['developer experience','dx','developer ergonomics','devex','sc-dx']],
  ['agent-experience', ['agent experience','ax','agent ergonomics','tool calling','sc-ax']],
  ['deployment', ['deploy','deployment','publish','production','hosting','release']],
  ['vercel', ['vercel']],
  ['dokploy', ['dokploy']],
  ['convex', ['convex']],
  ['database', ['database','schema','query','queries','migration','data layer']],
  ['dns', ['dns','domain','domains','nameserver','record','records']],
  ['cloudflare', ['cloudflare','sc-cf']],
  ['provider', ['provider','providers','integration','integrations','credential','credentials']],
  ['auth', ['auth','authentication','authorization','oauth','login','sign in','signin']],
  ['email', ['email','mail','transactional email','smtp']],
  ['resend', ['resend']],
  ['automation', ['automation','automate','workflow automation','n8n']],
  ['n8n', ['n8n']],
  ['git', ['git','github','repository','repo','pull request','commit']],
  ['ci-cd', ['ci/cd','ci cd','continuous integration','continuous delivery','github actions','pipeline']],
  ['security', ['security','secret','secrets','credential safety','threat','permission','permissions']],
  ['performance', ['performance','latency','bundle size','web vitals','speed']],
  ['seo', ['seo','search engine','metadata','sitemap','robots.txt']],
  ['pwa', ['pwa','progressive web app','service worker','manifest']],
  ['mobile', ['mobile','responsive','touch','phone','android','ios']],
  ['desktop', ['desktop','workbench','shell layout','wide screen']],
  ['testing', ['test','tests','testing','regression','e2e','playwright','unit test']],
  ['monitoring', ['monitoring','observability','health check','telemetry','logging']],
  ['api', ['api','endpoint','endpoints','rest','graphql','webhook']],
  ['mcp', ['mcp','model context protocol','tool server']],
  ['sync', ['sync','synchronization','transfer','portable','portability']],
  ['onboarding', ['onboarding','setup','first run','configuration']],
  ['skills', ['skill registry','skill discovery','slash skill','slash skills','agent skills']],
  ['cli', ['cli','command line','terminal command']],
  ['tui', ['tui','terminal ui','terminal interface','finder']],
];

const ALIAS_RULES = {
  ui: ['interface','visual','styling','polish'],
  ux: ['usability','flow','interaction','journey'],
  frontend: ['web-ui','client-side','front-end'],
  'design-system': ['components','tokens','design-language'],
  accessibility: ['a11y','wcag','keyboard','screen-reader'],
  'developer-experience': ['dx','devex','developer-ergonomics'],
  'agent-experience': ['ax','agent-ergonomics','tooling'],
  deployment: ['deploy','publish','hosting','production'],
  provider: ['integration','connector','credentials'],
  auth: ['authentication','oauth','login'],
  automation: ['automate','workflow'],
  git: ['github','repo','repository'],
  'ci-cd': ['pipeline','actions'],
  performance: ['speed','web-vitals'],
  skills: ['slash','capability','extension'],
  cli: ['command-line','terminal'],
  tui: ['finder','terminal-ui'],
};

function decodeScalar(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function splitList(value) {
  if (Array.isArray(value)) return value.map(String).map(x => x.trim()).filter(Boolean);
  return String(value || '').split(/[;,]/).map(x => x.trim()).filter(Boolean);
}

function specSkillName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s.]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

function readFrontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
  const normalized = text.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return {};
  const out = {};
  let section = null;
  for (const line of normalized.slice(4, end).split('\n')) {
    const nested = line.match(/^\s{2,}([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (nested && section === 'metadata') {
      out.metadata ||= {};
      out.metadata[nested[1]] = decodeScalar(nested[2]);
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    section = match[1] === 'metadata' && !String(match[2] || '').trim() ? 'metadata' : null;
    if (section === 'metadata') {
      out.metadata ||= {};
      continue;
    }
    out[match[1]] = decodeScalar(match[2]);
  }
  return out;
}

function skillBody(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (!text.startsWith('---\n')) return text.slice(0, MAX_INDEX_BODY);
  const end = text.indexOf('\n---\n', 4);
  return (end >= 0 ? text.slice(end + 5) : text).slice(0, MAX_INDEX_BODY);
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[_/]+/g, ' ').replace(/[^a-z0-9.+#-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywordCandidates(text) {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const counts = new Map();
  for (const word of words) {
    const clean = word.replace(/^[.-]+|[.-]+$/g, '');
    if (!clean || STOPWORDS.has(clean)) continue;
    if (clean.length < 3 && !['ui','ux','dx','ax','api','dns','seo','pwa','mcp','git'].includes(clean)) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([word]) => word);
}

function deriveTags(input = {}) {
  const source = normalizeText([input.name, input.description, input.useWhen, input.body].filter(Boolean).join(' '));
  const tags = [];
  for (const [tag, terms] of TAG_RULES) {
    if (terms.some(term => source.includes(normalizeText(term)))) tags.push(tag);
  }
  const nameTokens = normalizeText(input.name).split(/[-\s]+/).filter(Boolean).filter(x => x !== 'sc');
  for (const token of nameTokens) if (!tags.includes(token) && token.length >= 2) tags.push(token);
  for (const token of keywordCandidates([input.description, input.useWhen].filter(Boolean).join(' '))) {
    if (tags.length >= 12) break;
    if (!tags.includes(token)) tags.push(token);
  }
  return tags.slice(0, 12);
}

function deriveAliases(tags, input = {}) {
  const aliases = [];
  for (const tag of tags || []) for (const alias of ALIAS_RULES[tag] || []) if (!aliases.includes(alias)) aliases.push(alias);
  const name = normalizeText(input.name).replace(/\s+/g, '-');
  if (name.startsWith('sc-')) {
    const short = name.slice(3);
    if (short && !aliases.includes(short)) aliases.unshift(short);
  }
  return aliases.slice(0, 12);
}

function metadataForSkill(file, fallback = {}) {
  const meta = readFrontmatter(file);
  const body = skillBody(file);
  const explicitTags = splitList(meta.metadata?.['sc.tags']);
  const explicitAliases = splitList(meta.metadata?.['sc.aliases']);
  const tags = explicitTags.length ? explicitTags : deriveTags({
    name: meta.name || fallback.name,
    description: meta.description || fallback.description,
    useWhen: meta.use_when || fallback.useWhen,
    body,
  });
  const aliases = explicitAliases.length ? explicitAliases : deriveAliases(tags, { name: meta.name || fallback.name });
  return {
    meta,
    body,
    tags,
    aliases,
    tagsSource: meta.metadata?.['sc.tags-source'] || (explicitTags.length ? 'declared' : AUTO_TAG_VERSION),
  };
}

function quote(value) { return JSON.stringify(String(value)); }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function upsertScMetadata(text, fields = {}) {
  const normalized = String(text).replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) throw new Error('SKILL.md must start with YAML frontmatter');
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('SKILL.md frontmatter is not closed');
  const lines = normalized.slice(4, end).split('\n');
  let metadataIndex = lines.findIndex(line => /^metadata:\s*$/.test(line));
  const inlineMetadata = lines.findIndex(line => /^metadata:\s*\S+/.test(line));
  // Preserve an inline metadata mapping authored by another client. Search still gets
  // derived runtime metadata; SC only writes sc.* keys when a normal metadata block exists.
  if (metadataIndex < 0 && inlineMetadata >= 0) return normalized;
  if (metadataIndex < 0) {
    metadataIndex = lines.length;
    lines.push('metadata:');
  }
  let metadataEnd = metadataIndex + 1;
  while (metadataEnd < lines.length && /^\s+/.test(lines[metadataEnd])) metadataEnd++;
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const fullKey = `sc.${key}`;
    const rendered = Array.isArray(value) ? value.join(', ') : String(value);
    const pattern = new RegExp(`^\\s{2,}${escapeRegExp(fullKey)}:`);
    const existing = lines.findIndex((line, idx) => idx > metadataIndex && idx < metadataEnd && pattern.test(line));
    const next = `  ${fullKey}: ${quote(rendered)}`;
    if (existing >= 0) lines[existing] = next;
    else {
      lines.splice(metadataEnd, 0, next);
      metadataEnd++;
    }
  }
  return `---\n${lines.join('\n')}\n---\n${normalized.slice(end + 5)}`;
}

function frontmatterValue(front, key) {
  const match = front.match(new RegExp(`^\\s{2,}sc\\.${escapeRegExp(key)}:\\s*(.*)$`, 'm'));
  return match ? decodeScalar(match[1]) : '';
}

function ensureAutoMetadata(text, options = {}) {
  const temp = String(text).replace(/\r\n/g, '\n');
  const start = temp.startsWith('---\n') ? 4 : -1;
  const end = start >= 0 ? temp.indexOf('\n---\n', 4) : -1;
  if (end < 0) return temp;
  const front = temp.slice(4, end);
  const name = (front.match(/^name:\s*(.+)$/m)?.[1] || options.name || '').replace(/^['"]|['"]$/g, '');
  const descriptionRaw = front.match(/^description:\s*(.+)$/m)?.[1] || options.description || '';
  const description = decodeScalar(descriptionRaw);
  const useWhen = decodeScalar(front.match(/^use_when:\s*(.+)$/m)?.[1] || '');
  const body = temp.slice(end + 5, end + 5 + MAX_INDEX_BODY);
  const existingTags = splitList(frontmatterValue(front, 'tags'));
  const existingAliases = splitList(frontmatterValue(front, 'aliases'));
  const existingSource = frontmatterValue(front, 'tags-source');
  const manual = existingSource === 'manual';
  const preserveManual = manual && !options.retag && !options.tags?.length && !options.aliases?.length;
  const shouldRegenerate = Boolean(options.retag) || existingSource === AUTO_TAG_VERSION || !existingTags.length;

  let tags;
  if (options.tags?.length) tags = options.tags;
  else if (preserveManual) tags = existingTags;
  else if (shouldRegenerate) tags = deriveTags({ name, description, useWhen, body });
  else tags = existingTags;

  let aliases;
  if (options.aliases?.length) aliases = options.aliases;
  else if (preserveManual && existingAliases.length) aliases = existingAliases;
  else aliases = deriveAliases(tags, { name });

  const tagsSource = options.tags?.length || options.aliases?.length
    ? 'manual'
    : preserveManual
      ? 'manual'
      : AUTO_TAG_VERSION;

  return upsertScMetadata(temp, { tags, aliases, 'tags-source': tagsSource });
}

module.exports = {
  AUTO_TAG_VERSION,
  TAG_RULES,
  decodeScalar,
  splitList,
  specSkillName,
  readFrontmatter,
  skillBody,
  normalizeText,
  deriveTags,
  deriveAliases,
  metadataForSkill,
  upsertScMetadata,
  ensureAutoMetadata,
};
