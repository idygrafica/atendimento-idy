import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base='https://atendimento-idy.netlify.app/';
const out='preview/production-audit';
const paths=['index.html','painel.html','package.json','netlify/functions/chat.js','netlify/functions/health.js','netlify/functions/health.mjs','netlify/functions/notify-idy-whatsapp.js','netlify/functions/panel-api.mjs','netlify/functions/whatsapp-webhook.mjs','netlify/functions/conversation-store.mjs','netlify/functions/creative-preview.js','netlify/functions/creative-preview.mjs','netlify/functions/artwork.mjs','netlify/functions/partial-lead.mjs','netlify/functions/idle-leads.mjs','lib/artwork.mjs','lib/partial-leads.mjs'];
const report={observedAt:new Date().toISOString(),readOnly:true,files:[],runtime:[],authoritativeInventoryConfirmed:false};
await fs.mkdir(out,{recursive:true});
for(let offset=0;offset<paths.length;offset+=4){
 await Promise.all(paths.slice(offset,offset+4).map(async path=>{
  try{
   const r=await fetch(new URL(path,base),{signal:AbortSignal.timeout(20000),redirect:'error'});
   const entry={path,status:r.status};report.files.push(entry);
   if(!r.ok){await r.body?.cancel();return;}
   const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>2000000)throw Error();
   const text=bytes.toString('utf8');
   entry.sha256=createHash('sha256').update(bytes).digest('hex');
   entry.html=/^\s*(?:<!doctype html|<html)/i.test(text);
   // Store only public source, never runtime responses, configuration secrets or customer records.
   if((path.endsWith('.html')||!entry.html)&&!/(?:sk-[A-Za-z0-9_-]{25,}|gh[pousr]_[A-Za-z0-9]{25,}|Bearer\s+eyJ[A-Za-z0-9_-]{20,})/.test(text)){
    await fs.mkdir(out+'/source/'+path.split('/').slice(0,-1).join('/'),{recursive:true});
    await fs.writeFile(out+'/source/'+path,bytes);entry.saved=true;
   }else entry.saved=false;
  }catch{report.files.push({path,requestFailed:true});}
 }));
}
for(const name of ['chat','notify-idy-whatsapp','panel-api','whatsapp-webhook']){
 try{const r=await fetch(base+'.netlify/functions/'+name,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});report.runtime.push({name,status:r.status});await r.body?.cancel();}catch{report.runtime.push({name,requestFailed:true});}
}
report.files.sort((a,b)=>a.path.localeCompare(b.path));
await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
