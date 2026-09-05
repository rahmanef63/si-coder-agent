'use strict';

// Local-only, one-shot credential entry page. Keys are sent only to the selected
// provider for verification and the private store; never to UI responses or logs.
const http = require('http');
const crypto = require('crypto');
const { createCredentialSession } = require('./credential-session');

const MAX_BODY = 16 * 1024;
const MAX_ATTEMPTS = 8;
const LOOPBACK = '127.0.0.1';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(body));
}
function constantTime(a, b) {
  const aa = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function bearer(req) {
  const m = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || ''));
  return m ? m[1] : '';
}
function html(nonce) {
  // No user/provider strings are interpolated here: all UI data is set with textContent.
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credential setup</title><main><h1 id="heading">Credential setup</h1><p id="status">Preparing secure local setup…</p><form id="form" hidden><div id="fields"></div><button type="submit">Verify and save</button></form><section id="guidance"></section></main><style>body{font:16px system-ui;max-width:44rem;margin:3rem auto;padding:0 1rem}label,details{display:block;margin:1rem 0}input{display:block;width:100%;box-sizing:border-box;padding:.55rem}button{padding:.55rem .9rem}</style><script nonce="${nonce}">(function(){'use strict';const token=location.hash.slice(1),h={Authorization:'Bearer '+token};history.replaceState(null,'',location.pathname);const q=s=>document.querySelector(s),add=(p,t)=>{const e=document.createElement(t);p.appendChild(e);return e};function text(e,s){e.textContent=String(s||'')}fetch('/api/schema',{headers:h,cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw Error();text(q('#heading'),d.heading);const fields=q('#fields');for(const f of d.fields){const l=add(fields,'label');text(l,f.label+(f.required?' (required)':''));const i=add(l,'input');i.name=f.key;i.type=f.secret?'password':'text';i.autocomplete='off';i.maxLength=4096;i.required=f.required&&!f.stored;i.placeholder=f.stored?'Stored — leave blank to keep':'';if(f.secret){const b=add(l,'button');b.type='button';text(b,'Show');b.onclick=()=>{i.type=i.type==='password'?'text':'password';text(b,i.type==='password'?'Show':'Hide')}}}const g=q('#guidance');for(const x of d.guidance){const det=add(g,'details'),sum=add(det,'summary');text(sum,x.key);if(typeof x.url==='string'&&x.url.startsWith('https://')){const a=add(det,'a');a.href=x.url;a.target='_blank';a.rel='noopener noreferrer';text(a,'Open official setup page')}if(x.navigation&&x.navigation.length){const ol=add(det,'ol');for(const n of x.navigation){const li=add(ol,'li');text(li,n)}}if(x.note){const p=add(det,'p');text(p,x.note)}}q('#form').hidden=false;setTimeout(()=>{q('#form').hidden=true;for(const i of q('#fields').querySelectorAll('input'))i.value='';text(q('#status'),'Setup expired. Open a new session.')},Math.max(0,d.expiresAt-Date.now()));text(q('#status'),'Enter credentials. Existing blank fields are kept.')} ).catch(()=>text(q('#status'),'This setup link is unavailable.'));q('#form').onsubmit=async e=>{e.preventDefault();const button=q('#form button[type=submit]');button.disabled=true;try{const values={};for(const i of q('#fields').querySelectorAll('input'))values[i.name]=i.value;const r=await fetch('/api/save',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({values})});const d=await r.json().catch(()=>({}));text(q('#status'),d.status||'Unable to save.');if(r.ok){for(const i of q('#fields').querySelectorAll('input'))i.value='';q('#form').hidden=true}}catch{text(q('#status'),'Connection failed. Check the local setup server.')}finally{button.disabled=false}};})();</script>`;
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('too-large')); req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad-json')); } });
    req.on('error', reject);
  });
}

async function startCredentialWeb({ user, providerId, connectionId = null, authMethod = null, port = 0, ttlMs = 600000, check = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(18).toString('base64');
  const expires = Date.now() + Math.min(Math.max(Number(ttlMs) || 600000, 1), 600000);
  const session = createCredentialSession({ user, providerId, connectionId, authMethod, expiresAt: expires, check });
  let attempts = 0, busy = false, consumed = false, server, expiryTimer;
  const listener = async (req, res) => {
    const origin = `http://${LOOPBACK}:${server.address().port}`;
    const common = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` };
    if (req.headers.host !== `${LOOPBACK}:${server.address().port}` || (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { status: 'rejected' });
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html(nonce)); }
    const validToken = constantTime(bearer(req), token);
    if (req.method === 'GET' && req.url === '/api/schema') {
      if (!validToken || consumed || Date.now() > expires) return json(res, 401, { status: 'unavailable' });
      try { return json(res, 200, session.schema()); } catch { return json(res, 401, { status: 'unavailable' }); }
    }
    if (req.method === 'POST' && req.url === '/api/save') {
      if (!validToken || consumed || Date.now() > expires) return json(res, 401, { status: 'unavailable' });
      if (req.headers.origin !== origin || req.headers.host !== `${LOOPBACK}:${server.address().port}`) return json(res, 403, { status: 'rejected' });
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return json(res, 415, { status: 'rejected' });
      if (busy) return json(res, 409, { status: 'busy' });
      if (++attempts > MAX_ATTEMPTS) return json(res, 429, { status: 'unavailable' });
      if (Number(req.headers['content-length']) > MAX_BODY) return json(res, 413, { status: 'request-too-large' });
      busy = true;
      try {
        const body = await readJson(req);
        if (!body || Object.keys(body).some(k => !['values','allowUnverified'].includes(k))) throw new Error('invalid');
        const result = await session.save(body.values, { allowUnverified: body.allowUnverified === true });
        consumed = true;
        return json(res, 200, result);
      } catch (e) { return json(res, e.status || 422, { status: ['unverified','rejected','unavailable'].includes(e.message) ? e.message : 'rejected' }); } finally { busy = false; }
    }
    res.writeHead(404, common); res.end();
  };
  server = http.createServer((req, res) => { listener(req, res).catch(() => { if (!res.headersSent) json(res, 503, {status:'unavailable'}); else res.end(); }); });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: LOOPBACK, port }, () => { server.off('error', reject); resolve(); }); });
  const origin = `http://${LOOPBACK}:${server.address().port}`;
  const close = () => new Promise(resolve => { clearTimeout(expiryTimer); consumed = true; server.closeAllConnections(); server.close(resolve); });
  expiryTimer = setTimeout(close, Math.max(0, expires - Date.now()) + 30000); expiryTimer.unref();
  return { server, origin, url: `${origin}/#${token}`, close };
}
module.exports = { startCredentialWeb };
