const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { askHidden } = require('../lib/prompt');
const { VALIDATORS, PROVIDERS } = require('../lib/providers');
function tty() {
  const input = new EventEmitter();
  Object.assign(input, { isTTY:true, isRaw:false, setRawMode(v){this.isRaw=v;}, resume(){}, pause(){} });
  const output = { text:'', write(t){this.text+=t;} };
  return { input,output };
}
for (const chunks of [
  ['\x1b[200~opaque-project-key-example\x1b[201~\r'],
  ['\x1b','[20','0~opaque-project-key-example','\x1b[2','01~','\r'],
  ['\x1b[200~',' opaque-project-key-example\r\n','\x1b[201~','\r'],
]) test('credential paste strips complete/split wrappers and never echoes data: '+chunks.length,async()=>{
  const {input,output}=tty(); const result=askHidden('Key: ',{input,output,escapeCancels:true});
  for(const chunk of chunks) input.emit('data',Buffer.from(chunk));
  assert.equal(await result,'opaque-project-key-example');
  assert.doesNotMatch(output.text,/opaque-project|200|201/); assert.equal(input.isRaw,false);
});
test('a pasted newline does not submit before explicit Enter',async()=>{
  const {input,output}=tty(); let done=false;
  const result=askHidden('Key: ',{input,output,escapeCancels:true}).then(v=>{done=true;return v;});
  input.emit('data',Buffer.from('\x1b[200~opaque-project-key-example\n\x1b[201~'));
  await new Promise(r=>setImmediate(r));assert.equal(done,false);
  input.emit('data',Buffer.from('\r'));assert.equal(await result,'opaque-project-key-example');
});
test('bare Escape still cancels and releases listeners',async()=>{
  const {input,output}=tty(); const result=askHidden('Key: ',{input,output,escapeCancels:true});
  input.emit('data',Buffer.from('\x1b'));assert.equal(await result,null);assert.equal(input.listenerCount('data'),0);
});
test('Composio project keys are opaque; malformed/oversized data is rejected',()=>{
  assert.equal(VALIDATORS.COMPOSIO_API_KEY('opaque-project-key-example'),true);
  assert.equal(VALIDATORS.COMPOSIO_API_KEY('ak_example_project_key'),true);
  for(const bad of ['', 'short','some credential with spaces','opaque-project-key\nexample','x'.repeat(4097),'123456789012345\x00']) assert.equal(VALIDATORS.COMPOSIO_API_KEY(bad),false);
});
test('Composio project and organization checks use distinct headers and endpoints',async(t)=>{
  const original=global.fetch; t.after(()=>{global.fetch=original;}); const calls=[];
  global.fetch=async(url,options)=>{calls.push({url,headers:options.headers});return {ok:true,status:200,json:async()=>({}),headers:new Headers()};};
  const p=PROVIDERS.find(p=>p.id==='composio');
  assert.equal((await p.check({COMPOSIO_API_KEY:'opaque-project-key-example'})).ok,true);
  assert.equal((await p.check({COMPOSIO_ORG_API_KEY:'organization-key-example'})).ok,true);
  assert.match(calls[0].url,/\/tools\?limit=1$/);assert.deepEqual(Object.keys(calls[0].headers),['x-api-key']);
  assert.match(calls[1].url,/\/org\/project\/list$/);assert.deepEqual(Object.keys(calls[1].headers),['x-org-api-key']);
});

test('organization keys reject malformed or oversized values before provider requests',()=>{
  assert.equal(VALIDATORS.COMPOSIO_ORG_API_KEY('synthetic_organization_token'),true);
  for(const value of ['', 'short', 'organization token with whitespace', '1234567890123456\nsecret','x'.repeat(4097)]) assert.equal(VALIDATORS.COMPOSIO_ORG_API_KEY(value),false);
});
test('transport errors cannot echo credentials through provider diagnostics',async t=>{
  const original=global.fetch;t.after(()=>{global.fetch=original});
  const secret='synthetic_credential_for_redaction_test';
  global.fetch=async()=>{throw new TypeError('invalid header value: '+secret)};
  const result=await PROVIDERS.find(p=>p.id==='composio').check({COMPOSIO_API_KEY:secret});
  assert.equal(result.ok,false);assert.ok(!JSON.stringify(result).includes(secret));
  assert.match(result.detail,/network request failed/);
});
