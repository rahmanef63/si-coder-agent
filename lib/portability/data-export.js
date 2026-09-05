'use strict';
const codec=require('./codec'),P=require('../profiles'),C=require('../connections');
const {PROVIDERS}=require('../providers');const {withStateLock}=require('./state-lock');
function collectMetadata(options={}){
  return withStateLock(()=>{
    require("./paths").safeState();
    const selected=options.users||P.listProfiles();if(!Array.isArray(selected)||selected.some(u=>!P.profileExists(codec.id(u))))throw Error('unknown_export_user');
    const users=[...new Set(selected)].map(user=>{
      const connections=[];
      function record(provider,c,stored,fields){connections.push({id:c.id,label:c.label,provider:provider.id==='cf'?'cloudflare':provider.id,source:c.source==='sc'?'direct':c.source,authMethod:c.authMethod,scope:c.scope||'account',fields:fields.map(f=>({key:f.key,secret:f.secret!==false,configured:Boolean(stored[f.key])})),...(options.includeSecrets===true&&c.source==='sc'?{values:Object.fromEntries(fields.filter(f=>stored[f.key]!==undefined).map(f=>[f.key,stored[f.key]]))}:{})});}
      for(const c of C.list(user)){
        const provider=PROVIDERS.find(p=>p.id===c.provider);if(!provider)throw Error('unknown_source_provider_requires_review');
        record(provider,c,c.source==='sc'?C.readValues(user,c.provider,c.id):{},C.connectionFields(provider,c));
      }
      const legacy=P.readProfile(user);
      for(const provider of PROVIDERS)for(const method of C.authOptions(provider,'sc')){
        const fields=provider.vars.filter(f=>(method.fields||[]).includes(f.key));if(!fields.some(f=>legacy[f.key]!==undefined))continue;
        const base=('legacy-'+method.id).slice(0,58);let id=base,index=2;while(connections.some(c=>c.provider===(provider.id==='cf'?'cloudflare':provider.id)&&c.id===id))id=base+'-'+index++;
        record(provider,{id,label:'Legacy '+provider.title+' '+method.id,source:'sc',authMethod:method.id,scope:method.scope},legacy,fields);
      }
      return{id:user,label:P.profileOwner(user),connections};
    });
    return codec.payload({name:'si-coder',version:require('../../package.json').version},users,options.includeSecrets===true?'secrets':'metadata');
  });
}
module.exports={collectMetadata};
