'use strict';
const fs=require('node:fs'),path=require('node:path');const codec=require('./codec');const data=require('./data');
async function cli(args,{askHidden,isInteractive}={}){
  const action=args._[1],allowed=['_','out','file','user','include-secrets','apply','confirm','prefix','policy','accept-warnings'];
  if(Object.keys(args).some(k=>!allowed.includes(k)))throw Error('unknown_data_flag: passphrases cannot be supplied as arguments');
  if(!['export','import'].includes(action)){console.log('sc data export --out FILE.json [--user ID] [--include-secrets]\nsc data import --file FILE.json [--prefix imported-] [--policy skip|error]\nsc data import --file FILE.json --apply --confirm PREVIEW_ID [--accept-warnings]\nUse the browser hub for file upload/download: sc setup --web');return;}
  let passphrase;
  const hidden=async confirm=>{
    if(!isInteractive())throw Error('encrypted transfers require a local interactive terminal or secure browser form');
    const first=await askHidden('Transfer passphrase (at least 12 characters): ',{escapeCancels:true});if(!first)throw Error('cancelled');
    if(confirm&&first!==await askHidden('Confirm transfer passphrase: ',{escapeCancels:true}))throw Error('passphrase_mismatch');return first;
  };
  if(action==='export'){
    if(typeof args.out!=='string')throw Error('choose --out FILE.json; output is never printed to the chat');
    if(args['include-secrets'])passphrase=await hidden(true);
    try{const bundle=await data.exportData({users:args.user?[args.user]:undefined,includeSecrets:args['include-secrets']===true,passphrase});
      fs.writeFileSync(path.resolve(args.out),JSON.stringify(bundle,null,2)+'\n',{mode:0o600,flag:'wx'});
      console.log(JSON.stringify({ok:true,file:path.resolve(args.out),encrypted:bundle.format===codec.ENCRYPTED,format:bundle.format,version:1}));
    }finally{passphrase=undefined}return;
  }
  if(typeof args.file!=='string')throw Error('choose --file FILE.json');
  const fd=fs.openSync(path.resolve(args.file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let document;
  try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>codec.MAX_BYTES)throw Error('invalid_or_oversized_import_file');document=codec.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd)}
  if(document.format===codec.ENCRYPTED)passphrase=await hidden(false);
  try{const result=await data.importData(document,{passphrase,prefix:args.prefix,policy:args.policy,apply:args.apply===true,confirm:args.confirm,acceptWarnings:args['accept-warnings']===true});console.log(JSON.stringify(result,null,2));}finally{passphrase=undefined}
}
async function machine(action,input){
  const allowed=action==='export'?['out','user','confirm']:['file','prefix','policy','apply','confirm','planId','acceptWarnings'];
  if(Object.keys(input).some(k=>!allowed.includes(k)))throw Error('unexpected_machine_data_field');
  const {askHidden}=require('../prompt');
  if(action==='export')return cli({_ :['data','export'],out:input.out,...(input.user?{user:input.user}:{})},{askHidden,isInteractive:()=>false});
  if(action==='import')return cli({_ :['data','import'],file:input.file,...(input.prefix?{prefix:input.prefix}:{}),...(input.policy?{policy:input.policy}:{}),...(input.apply?{apply:true,confirm:input.planId}:{}),...(input.acceptWarnings?{'accept-warnings':true}:{})},{askHidden,isInteractive:()=>false});
  throw Error('unknown_data_action');
}
module.exports={cli,machine};
