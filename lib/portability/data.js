'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {CONFIG_DIR}=require('../config');
const codec=require('./codec'),P=require('../profiles'),C=require('../connections');
const {PROVIDERS}=require('../providers');const {withStateLock}=require('./state-lock');
const {collectMetadata}=require('./data-export');
async function exportData(options={}){
  const bundle=collectMetadata(options);
  return options.includeSecrets===true?codec.seal(bundle,options.passphrase):bundle;
}

function destination(){
  require("./paths").safeState();
  for(const file of [C.CONNECTION_META,P.PROFILE_META]){
    if(!fs.existsSync(file))continue;const st=fs.lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||st.size>2*1024*1024||(st.mode&0o077))throw Error('unsafe_metadata_store');
    try{JSON.parse(fs.readFileSync(file,'utf8'))}catch{throw Error('invalid_metadata_store')}
  }
  return {users:P.listProfiles(),meta:C.readMeta(),profiles:P.readProfileMeta()};
}
function plan(bundle,options,state){
  const prefix=options.prefix||'',policy=options.policy||'skip';
  if(!['skip','error'].includes(policy)||typeof prefix!=='string'||(prefix&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(prefix)))throw Error('invalid_import_options');
  const users=[],rows=[],warnings=[],pending=[];
  for(const u of bundle.users){
    const user=codec.id(prefix+u.id);if(!state.users.includes(user))users.push({id:user,label:u.label});
    for(const c of u.connections){
      const provider=PROVIDERS.find(p=>p.id===(c.provider==='cloudflare'?'cf':c.provider));
      const source=c.source==='direct'?'sc':c.source;let method;
      if(provider)try{method=C.authOption(provider,source,c.authMethod==='provider-oauth'?'dcr-oauth':c.authMethod)}catch{}
      const ref={user,provider:provider?.id||c.provider,connection:c.id,label:c.label};let reason=null;
      if(!provider||!method)reason='unsupported_provider_or_method';
      if(!C.ID_RE.test(c.id))reason='unsupported_connection_id';
      const node=state.meta.users[user]?.providers?.[provider?.id];
      if(!reason&&(node?.connections?.[c.id]||Object.values(node?.connections||{}).some(x=>x.label?.toLowerCase()===c.label.toLowerCase())))reason='existing_connection_preserved';
      if(!reason&&require('./paths').safePath(C.connectionPath(user,provider.id,c.id)))reason='orphan_destination_preserved';
      if(reason){rows.push({...ref,status:'skip',reason});warnings.push({...ref,reason});continue;}
      const allowed=new Set(method.fields||[]),omitted=c.fields.filter(f=>!allowed.has(f.key)).map(f=>f.key);
      if(omitted.length)warnings.push({...ref,reason:'unsupported_fields_omitted',fields:omitted});
      if(source!=='sc')warnings.push({...ref,reason:'external_authorization_required'});
      const values=Object.fromEntries(Object.entries(c.values||{}).filter(([k])=>allowed.has(k)));
      rows.push({...ref,status:'create',source,authMethod:method.id,credentialFields:Object.keys(values).length});
      pending.push({user,c,provider,method,source,values});
    }
  }
  const planId=crypto.createHash('sha256').update(JSON.stringify([bundle,prefix,policy,state])).digest('hex');
  return {preview:{planId,mode:bundle.mode,producer:bundle.producer.name,createUsers:users,connections:rows,warnings,canApply:policy!=='error'||!rows.some(r=>r.status==='skip'),requiresWarningAcceptance:warnings.length>0,defaultsChanged:false,folderBindingsImported:false,verified:false},pending};
}
async function importData(document,options={}){
  const bundle=await codec.open(document,options.passphrase);
  return withStateLock(()=>{
    const state=destination(),{preview,pending}=plan(bundle,options,state);
    if(options.apply!==true)return preview;
    if(options.confirm!==preview.planId)throw Error('preview_required_or_destination_changed');
    if(!preview.canApply)throw Error('import_conflicts');
    if(preview.requiresWarningAcceptance&&options.acceptWarnings!==true)throw Error('review_and_accept_import_warnings');
    const createdUsers=[],createdConnections=[],transactionId=crypto.randomUUID();
    const journal=path.join(CONFIG_DIR,'.import-journal-'+transactionId+'.json');
    const receipt={version:1,status:'prepared',createdUsers:preview.createUsers.map(u=>u.id),connections:pending.map(r=>({user:r.user,provider:r.provider.id,connection:r.c.id})),previousMetadata:state.meta,previousProfiles:state.profiles};
    fs.writeFileSync(journal,JSON.stringify(receipt),{mode:0o600,flag:'wx'});
    try{
      for(const u of preview.createUsers){P.writeProfile(u.id,{});createdUsers.push(u.id);P.setProfileOwner(u.id,u.label);}
      for(const row of pending){createdConnections.push({user:row.user,provider:row.provider.id,id:row.c.id});const c=C.create(row.user,row.provider.id,{id:row.c.id,label:row.c.label,source:row.source,authMethod:row.method.id,scope:row.method.scope||row.c.scope,setDefault:false,origin:'portable-import:'+transactionId});if(row.source==='sc')C.writeValues(row.user,row.provider.id,c.id,row.values);}
      const next=C.readMeta();for(const user of Object.keys(next.users))for(const[provider,node]of Object.entries(next.users[user].providers||{}))node.default=state.meta.users[user]?.providers?.[provider]?.default||null;
      C.writeMeta(next);
      receipt.status='committed';fs.writeFileSync(journal,JSON.stringify(receipt),{mode:0o600});
      return {...preview,applied:true,created:createdConnections.length,journal:path.basename(journal)};
    }catch{
      const failures=[];const attempt=fn=>{try{fn()}catch{failures.push(true)}};
      for(const c of createdConnections.reverse())attempt(()=>{const row=C.list(c.user,c.provider).find(r=>r.id===c.id);if(row?.origin==='portable-import:'+transactionId)C.remove(c.user,c.provider,c.id)});
      for(const u of createdUsers.reverse())attempt(()=>P.deleteProfile(u));
      attempt(()=>C.writeMeta(state.meta));attempt(()=>P.writeProfileMeta(state.profiles));
      receipt.status=failures.length?'recovery-required':'rolled-back';attempt(()=>fs.writeFileSync(journal,JSON.stringify(receipt),{mode:0o600}));
      throw Error(failures.length?'import_recovery_required':'import_rolled_back');
    }
  });
}
module.exports={exportData,importData};
