'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const P = require('./profiles');
const C = require('./connections');
const UC = require('./user-control');
const CC = require('./composio-connections');
const { PROVIDERS } = require('./providers');
const { credentialGuide } = require('./credential-guidance');
const { createCredentialSession, CredentialError } = require('./credential-session');
const { renderHub } = require('./credential-manager-ui');
const MAX_BODY = 16 * 1024;
function safeConnections(user, provider) {
  return UC.connectionsStatus(user, provider).map(c => ({ id:c.id, label:c.label, source:c.source, sourceLabel:c.sourceLabel, authMethod:c.authMethod, scope:c.scope, isDefault:c.isDefault, state:c.state, stored:c.stored, total:c.total, external:c.external, externalRef:c.externalRef ? { toolkit:c.externalRef.toolkit, alias:c.externalRef.alias, connectedAccountId:c.externalRef.connectedAccountId, authConfigId:c.externalRef.authConfigId, status:c.externalRef.lastKnownStatus } : null }));
}
function catalog() {
  return { users:P.listProfiles(), activeUser:P.resolveProfile().profile, providers:PROVIDERS.map(p => ({ id:p.id, title:p.title, description:p.blurb, status:p.status, sources:C.sourceOptions(p).map(source => ({ id:source.id, label:source.label, description:source.description, reference:source.reference, methods:C.authOptions(p,source.id).map(m => ({ id:m.id,label:m.label,scheme:m.scheme,scope:m.scope,fields:(m.fields||[]).map(key => { const g=credentialGuide(key,{override:m.guidance?.[key]});return {key,url:g.createAt,steps:g.navigation,note:g.note,command:g.createCommand}; }) })) })) })) };
}
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')) throw new CredentialError('json-required',415);
  if(Number(req.headers['content-length'])>MAX_BODY) throw new CredentialError('request-too-large',413);
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw new CredentialError('request-too-large',413);chunks.push(chunk);}
  try{const value=JSON.parse(Buffer.concat(chunks).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw new CredentialError('invalid-json',400);}
}
async function startCredentialHub({user=null,providerId=null,connectionId=null,authMethod=null,port=0,ttlMs=600000,check=null,authorize=CC.authorize,sync=CC.sync}={}) {
  if(user&&!P.profileExists(user))throw new CredentialError('profile-not-found',404);
  const token=crypto.randomBytes(32).toString('base64url'),digest=crypto.createHash('sha256').update(token).digest(),nonce=crypto.randomBytes(18).toString('base64');
  const expiresAt=Date.now()+Math.min(Math.max(Number(ttlMs)||600000,1),600000),forms=new Map();let server,timer,publicAccess=null;
  const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'};
  const reply=(res,status,data)=>{res.writeHead(status,{...headers,'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  const auth=req=>{const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');return bearer&&crypto.timingSafeEqual(crypto.createHash('sha256').update(bearer[1]).digest(),digest)&&Date.now()<expiresAt;};
  let mutations=0,windowAt=Date.now();
  async function handle(req,res){
    const origin=`http://127.0.0.1:${server.address().port}`;
    const allowedOrigins=new Set([origin,...(publicAccess?[publicAccess.origin]:[])]);
    const allowedHosts=new Set([...allowedOrigins].map(value=>new URL(value).host));
    if(!allowedHosts.has(String(req.headers.host||''))||(req.headers.origin&&!allowedOrigins.has(req.headers.origin)))return reply(res,403,{error:'origin-not-allowed'});
    const rawPath=new URL(req.url||'/',origin).pathname;
    const route=publicAccess?.basePath&&rawPath.startsWith(publicAccess.basePath)?(rawPath.slice(publicAccess.basePath.length)||'/'):rawPath;
    const requestOrigin=req.headers.origin||origin;
    if(req.method==='GET'&&route==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`});res.end(renderHub(nonce));return;}
    if(!auth(req))return reply(res,401,{error:'session-expired'});
    if(req.method==='GET'&&route==='/api/catalog')return reply(res,200,{...catalog(),initial:{user,providerId,connectionId,authMethod},expiresAt});
    if(req.method==='POST'&&route==='/api/transfer'){if(req.headers.origin!==requestOrigin)return reply(res,403,{error:'origin-required'});if(++mutations>100)return reply(res,429,{error:'rate-limited'});return require('./portability/http').transfer(req,res,{authorized:true,origin:requestOrigin});}
    if(req.method!=='POST'||route!=='/api/action')return reply(res,404,{error:'not-found'});
    if(req.headers.origin!==requestOrigin)return reply(res,403,{error:'origin-required'});
    if(Date.now()-windowAt>60000){windowAt=Date.now();mutations=0;}if(++mutations>100)return reply(res,429,{error:'rate-limited'});
    let body=await readBody(req);const originalAction=body.action;
    const aliases={select:'begin','user-create':'userAdd','connection-create':'connectionAdd','connection-rename':'rename','connection-default':'default','connection-delete':'remove','external-authorize':'authorize','external-sync':'sync'};
    req.legacy=Boolean(aliases[originalAction]||(originalAction==='save'&&body.sessionId));
    if(originalAction==='select'){
      const selection=body.selection;
      if(Object.keys(body).some(k=>!['action','selection'].includes(k))||!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(k=>!['user','providerId','connectionId','authMethod','source','newConnection','label'].includes(k)))throw new CredentialError('invalid-fields',400);
      if(selection.source&&selection.source!=='sc')throw new CredentialError('external-authorization-required');
      body={action:'begin',user:selection.user,provider:selection.providerId,connection:selection.connectionId,auth:selection.authMethod,newConnection:selection.newConnection,label:selection.label};
    }else if(aliases[originalAction]){
      const allowed=['action','user','owner','provider','connection','label','source','authMethod','confirmation'];
      if(Object.keys(body).some(k=>!allowed.includes(k)))throw new CredentialError('invalid-fields',400);
      body={...body,action:aliases[originalAction]};
      if('authMethod' in body){body.auth=body.authMethod;delete body.authMethod;}
      if(originalAction==='connection-delete'){
        const row=C.get(body.user,body.provider,body.connection);
        if(body.confirmation!==row.label)throw new CredentialError('confirmation-required',400);
        body.confirm=row.id;delete body.confirmation;
      }
    }
    const action=body.action;
    // Each action has an exact schema. Never echo submitted bodies on failure.
    const schemas={connections:['user','provider'],begin:['user','provider','connection','auth','label','newConnection','setDefault'],save:['session','sessionId','values','allowUnverified','confirmation'],userAdd:['user','owner'],connectionAdd:['user','provider','label','source','auth'],rename:['user','provider','connection','label'],default:['user','provider','connection'],remove:['user','provider','connection','confirm'],authorize:['user','provider','connection','authConfigId','brokerConnection'],sync:['user','provider','connection']};
    if(!schemas[action]||Object.keys(body).some(k=>k!=='action'&&!schemas[action].includes(k)))throw new CredentialError('invalid-action',400);
    if(action==='save'){if(body.session&&body.sessionId&&body.session!==body.sessionId)throw new CredentialError('invalid-fields',400);const form=forms.get(body.session||body.sessionId);if(!form)throw new CredentialError('form-expired',body.sessionId?400:401);const result=await form.save(body.values,{allowUnverified:body.allowUnverified===true&&body.confirmation==='SAVE UNVERIFIED'});return reply(res,200,{...result,status:result.verified?'verified_and_saved':'saved_unverified'});}
    if(typeof body.user!=='string')throw new CredentialError('choose-user',400);P.assertName(body.user);
    if(action==='userAdd'){if(P.profileExists(body.user))throw new CredentialError('user-exists',409);const owner=P.assertOwner(body.owner||body.user);P.writeProfile(body.user,{});P.setProfileOwner(body.user,owner);return reply(res,200,{ok:true,user:body.user});}
    if(!P.profileExists(body.user))throw new CredentialError('profile-not-found',404);
    const provider=PROVIDERS.find(p=>p.id===body.provider);if(!provider)throw new CredentialError('unknown-provider',404);
    if(action==='connections')return reply(res,200,{connections:safeConnections(body.user,body.provider)});
    if(action==='begin'){
      if(forms.size>=24)throw new CredentialError('too-many-forms',429);
      const form=createCredentialSession({user:body.user,providerId:body.provider,connectionId:body.connection||null,authMethod:body.auth||null,label:body.label||'Browser setup',newConnection:body.newConnection===true,setDefault:body.setDefault===true,expiresAt,check});
      const id=crypto.randomUUID();forms.set(id,form);return reply(res,200,{session:id,sessionId:id,schema:form.schema(),setup:form.schema()});
    }
    if(action==='connectionAdd'){
      const source=C.sourceOption(provider,body.source),method=C.authOption(provider,source.id,body.auth);
      const row=C.create(body.user,body.provider,{label:body.label,source:source.id,authMethod:method.id,scope:method.scope,setDefault:false});return reply(res,200,{connection:row.id});
    }
    const conn=C.get(body.user,body.provider,body.connection);
    if(action==='rename')C.setLabel(body.user,body.provider,conn.id,body.label);
    if(action==='default')C.setDefault(body.user,body.provider,conn.id);
    if(action==='remove'){if(body.confirm!==conn.id)throw new CredentialError('confirmation-required',400);C.remove(body.user,body.provider,conn.id);}
    if(action==='authorize'){
      if(conn.source!=='composio')throw new CredentialError('external-method-not-supported');
      let result;try{result=await authorize(body.user,body.provider,conn.id,{authConfigId:body.authConfigId||null,brokerConnection:body.brokerConnection||null});}catch{throw new CredentialError('configure-composio-project-and-auth-config');}
      const url=new URL(result.redirectUrl);if(url.protocol!=='https:'||!['connect.composio.dev','backend.composio.dev','platform.composio.dev'].includes(url.hostname)||url.username||url.password)throw new CredentialError('unsafe-provider-link');
      return reply(res,200,{redirectUrl:url.href,status:result.status,expiresAt:result.expiresAt});
    }
    if(action==='sync'){let result;try{result=await sync(body.user,body.provider,conn.id);}catch{throw new CredentialError('authorization-status-unavailable');}return reply(res,200,{status:result.status});}
    return reply(res,200,{ok:true});
  }
  server=http.createServer((req,res)=>handle(req,res).catch(error=>{const map={'unverified':'verification_unavailable','rejected':'credential_rejected','invalid-fields':'invalid_fields','confirmation-required':'confirmation_required','unavailable':'session_expired','form-expired':'unknown_form'};const code=error instanceof CredentialError?error.message:'request-rejected';return reply(res,error instanceof CredentialError?error.status:400,{error:req.legacy?(map[code]||code):code})}));
  server.headersTimeout=10000;server.requestTimeout=20000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
  const close=()=>new Promise(resolve=>{clearTimeout(timer);forms.clear();server.closeAllConnections();server.close(resolve);});
  const addPublicAccess=access=>{if(!access||typeof access.origin!=='string'||typeof access.basePath!=='string')throw new Error('invalid public access');const url=new URL(access.origin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/')throw new Error('public access must be an HTTPS origin');if(!/^\/sc-[a-f0-9]{16}$/.test(access.basePath))throw new Error('invalid public access path');publicAccess={origin:url.origin,basePath:access.basePath};return publicAccess;};
  timer=setTimeout(close,Math.max(0,expiresAt-Date.now())+20000);timer.unref();
  return{server,url:`http://127.0.0.1:${server.address().port}/#${token}`,origin:`http://127.0.0.1:${server.address().port}`,token,addPublicAccess,close};
}
module.exports={startCredentialHub,startCredentialManager:startCredentialHub,catalog};
