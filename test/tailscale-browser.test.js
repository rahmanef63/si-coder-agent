const test=require('node:test'),assert=require('node:assert/strict');
const {parseStatus,handlerExists}=require('../lib/tailscale-browser');
test('Tailscale browser discovery prefers online MagicDNS rather than a bare 100.x address',()=>{
  const out=parseStatus(JSON.stringify({BackendState:'Running',Self:{Online:true,DNSName:'srv.example.ts.net.',TailscaleIPs:['100.64.1.2','fd7a::1']}}));
  assert.deepEqual(out,{running:true,dnsName:'srv.example.ts.net',ipv4:'100.64.1.2'});
});
test('Tailscale browser discovery fails closed when node is offline or malformed',()=>{
  assert.equal(parseStatus('{}').running,false);assert.equal(parseStatus('{').running,false);
  assert.equal(parseStatus(JSON.stringify({BackendState:'Running',Self:{Online:false,DNSName:'srv.example.ts.net.'}})).running,false);
});
test('Serve status verification requires the exact session path and loopback target',()=>{
  const state={Web:{'srv.example.ts.net:443':{Handlers:{'/sc-0123456789abcdef':{Proxy:'http://127.0.0.1:49152'}}}}};
  assert.equal(handlerExists(state,'srv.example.ts.net','/sc-0123456789abcdef',49152),true);
  assert.equal(handlerExists(state,'srv.example.ts.net','/sc-deadbeefdeadbeef',49152),false);
  assert.equal(handlerExists(state,'srv.example.ts.net','/sc-0123456789abcdef',49153),false);
});
