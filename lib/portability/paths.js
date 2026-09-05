'use strict';
const fs=require('node:fs'),path=require('node:path');const{CONFIG_DIR}=require('../config');
function safePath(file){
  const root=path.resolve(CONFIG_DIR),target=path.resolve(file),rel=path.relative(root,target);
  if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('invalid_store_path');
  let p=root,exists=false;for(const part of ['',...rel.split(path.sep).filter(Boolean)]){
    if(part)p=path.join(p,part);let st;try{st=fs.lstatSync(p)}catch(e){if(e.code==='ENOENT')return false;throw Error('unsafe_store_path')}
    if(st.isSymbolicLink()||(process.getuid&&st.uid!==process.getuid())||(st.mode&0o077))throw Error('unsafe_store_path');
    if(p!==target&&!st.isDirectory())throw Error('unsafe_store_path');exists=true;
  }
  return exists;
}
function safeState(){
  const P=require('../profiles'),C=require('../connections');
  for(const file of [C.CONNECTION_META,P.PROFILE_META]){
    if(!safePath(file))continue;try{const d=JSON.parse(fs.readFileSync(file,'utf8'));if(!d||typeof d!=='object'||Array.isArray(d))throw Error()}catch{throw Error('invalid_metadata_store')}
  }
  for(const user of P.listProfiles())safePath(P.profilePath(user));
  const meta=C.readMeta();for(const[user,row]of Object.entries(meta.users))for(const[provider,node]of Object.entries(row.providers||{}))for(const id of Object.keys(node.connections||{}))safePath(C.connectionPath(user,provider,id));
}
module.exports={safePath,safeState};
