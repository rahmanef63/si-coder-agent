const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-web-test-'));
process.env.SC_CONFIG_DIR = path.join(dir, 'config');
const P = require('../lib/profiles');
const C = require('../lib/connections');
const { startCredentialWeb } = require('../lib/credential-web');
let counter = 0;
const SECRET = 'opaque-synthetic-project-key-for-tests';
async function session(t, options = {}) {
  const user = `web-test-${++counter}`; P.writeProfile(user, {});
  const s = await startCredentialWeb({ user, providerId:'composio', check:async()=>({ok:true}), ...options });
  t.after(()=>s.close());
  const token = new URL(s.url).hash.slice(1);
  return { ...s, user, token, headers:{Authorization:`Bearer ${token}`, Origin:s.origin, 'Content-Type':'application/json'} };
}
const save = (s, values, extra = {}) => fetch(s.origin+'/api/save',{method:'POST',headers:{...s.headers,...extra},body:JSON.stringify({values})});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
test('web setup is loopback-only and public HTML has a functional restrictive CSP',async t=>{
  const s=await session(t);assert.equal(s.server.address().address,'127.0.0.1');
  const r=await fetch(s.origin);const html=await r.text();assert.equal(r.status,200);
  assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.ok(!html.includes(s.token));assert.ok(!html.includes(SECRET));
  const script=html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)[1];assert.doesNotThrow(()=>new Function(script));
});
test('schema requires a capability and never returns stored values',async t=>{
  const s=await session(t);assert.equal((await fetch(s.origin+'/api/schema')).status,401);
  const r=await fetch(s.origin+'/api/schema',{headers:s.headers});const schema=await r.json();assert.equal(r.status,200);
  assert.equal(schema.fields.length,1);assert.equal(schema.fields[0].key,'COMPOSIO_API_KEY');assert.equal(schema.fields[0].required,true);
  assert.ok(schema.guidance[0].navigation.length);assert.ok(!JSON.stringify(schema).includes(s.token));
});
test('wrong Origin, token, unexpected field, and cross-provider targets cannot write',async t=>{
  const s=await session(t);
  assert.equal((await save(s,{COMPOSIO_API_KEY:SECRET},{Origin:'https://evil.invalid'})).status,403);
  assert.equal((await save(s,{COMPOSIO_API_KEY:SECRET},{Authorization:'Bearer invalid'})).status,401);
  assert.equal((await save(s,{HOSTINGER_API_TOKEN:SECRET})).status,422);
  assert.equal(C.list(s.user,'composio').length,0);
});
test('failed live validation leaves credentials and metadata untouched',async t=>{
  const s=await session(t,{check:async()=>({ok:false,detail:SECRET})});
  const r=await save(s,{COMPOSIO_API_KEY:SECRET});assert.equal(r.status,422);assert.ok(!(await r.text()).includes(SECRET));
  assert.equal(C.list(s.user,'composio').length,0);
});
test('successful verified save is private, trims edge whitespace, and cannot be replayed',async t=>{
  const s=await session(t);const r=await save(s,{COMPOSIO_API_KEY:'  '+SECRET+'  '});assert.equal(r.status,200);assert.ok(!(await r.text()).includes(SECRET));
  const conn=C.selected(s.user,'composio');assert.equal(C.readValues(s.user,'composio',conn.id).COMPOSIO_API_KEY,SECRET);
  assert.equal(fs.statSync(C.connectionPath(s.user,'composio',conn.id)).mode & 0o777,0o600);
  assert.equal((await save(s,{COMPOSIO_API_KEY:SECRET})).status,401);
});
test('missing required values, oversized bodies, and expired sessions are refused',async t=>{
  const s=await session(t);assert.equal((await save(s,{})).status,422);
  assert.equal((await save(s,{COMPOSIO_API_KEY:'x'.repeat(17000)})).status,413);
  const expired=await session(t,{ttlMs:20});await new Promise(r=>setTimeout(r,25));assert.equal((await save(expired,{COMPOSIO_API_KEY:SECRET})).status,401);
});
test('all providers get default direct methods and correct required fields',async t=>{
  const s=await session(t,{providerId:'hostinger'});const r=await fetch(s.origin+'/api/schema',{headers:s.headers});const schema=await r.json();assert.equal(r.status,200);
  assert.ok(schema.fields.some(f=>f.key==='HOSTINGER_API_TOKEN'&&f.required));
});
test('Composio organization method cannot accept a project field',async t=>{
  const s=await session(t,{authMethod:'organization-token'});
  assert.equal((await save(s,{COMPOSIO_API_KEY:SECRET})).status,422);
  assert.equal((await save(s,{COMPOSIO_ORG_API_KEY:SECRET})).status,200);
});

test('CLI refuses to emit private setup capabilities through non-interactive output',()=>{
  const {spawnSync}=require('node:child_process');
  const r=spawnSync(process.execPath,[path.join(__dirname,'../bin/sc.js'),'setup','--web','--provider','composio','--user','web-test'],{env:process.env,encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stdout+r.stderr,/terminal-only/);assert.doesNotMatch(r.stdout+r.stderr,/127\.0\.0\.1:\d+\/#/);
});
