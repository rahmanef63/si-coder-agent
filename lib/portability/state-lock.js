'use strict';
const fs=require('node:fs'),path=require('node:path');const {CONFIG_DIR,ensureConfigDir}=require('../config');
let depth=0;
function withStateLock(fn){
  if(depth)return fn();if(fs.existsSync(CONFIG_DIR)&&fs.lstatSync(CONFIG_DIR).isSymbolicLink())throw Error("unsafe_state_directory");ensureConfigDir();const dir=path.join(CONFIG_DIR,'.state-write.lock');
  try{fs.mkdirSync(dir,{mode:0o700})}catch{throw new Error('state_busy: another SC write or interrupted write needs review');}
  const owner=path.join(dir,'owner.json');
  try{fs.writeFileSync(owner,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{mode:0o600,flag:'wx'})}catch(e){fs.rmdirSync(dir);throw e}
  depth++;try{return fn()}finally{depth--;fs.unlinkSync(owner);fs.rmdirSync(dir)}
}
module.exports={withStateLock};
