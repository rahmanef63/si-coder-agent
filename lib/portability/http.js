'use strict';
const {MAX_BYTES}=require('./codec');const{exportData,importData}=require('./data');
const COMMON={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
let active=0;
async function transfer(req,res,context){
  const reply=(status,body)=>{res.writeHead(status,{...COMMON,'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(!context?.authorized||req.headers.origin!==context.origin)return reply(401,{error:'authenticated_local_session_required'});
  if(active>=2)return reply(429,{error:'transfer_busy'});active++;
  let timer;
  try{
    timer=setTimeout(()=>req.destroy(new Error('request_timeout')),5000);
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw Error('json_required');
    let length=0;const chunks=[];for await(const c of req){length+=c.length;if(length>MAX_BYTES+16384)throw Error('bundle_too_large');chunks.push(c);}
    const b=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','document','users','includeSecrets','passphrase','prefix','policy','apply','confirm','acceptWarnings'].includes(k)))throw Error('invalid_transfer_request');
    clearTimeout(timer);
    for(const k of ['apply','includeSecrets','acceptWarnings'])if(b[k]!==undefined&&typeof b[k]!=='boolean')throw Error('invalid_transfer_request');
    for(const k of ['passphrase','confirm','prefix','policy'])if(b[k]!==undefined&&typeof b[k]!=='string')throw Error('invalid_transfer_request');
    if(b.action==='export'){const bundle=await exportData(b);return reply(200,{bundle});}
    if(b.action!=='import')throw Error('invalid_transfer_action');
    const result=await importData(b.document,b);return reply(200,result);
  }catch(e){const code=/^[a-z][a-z0-9_]+$/.test(e.message)?e.message:'transfer_failed';if(!res.destroyed)return reply(400,{error:code});}finally{clearTimeout(timer);active--;}
}
module.exports={transfer};
