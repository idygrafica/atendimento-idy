import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='https://atendimento-idy.netlify.app/',expected={"netlify/functions/creative-preview.js":"aa312c4a094d3a7d76be8eae8cc6d7d40cf14f0e","netlify/functions/chat.js":"7b974789df0075e558b9f1040bb57b671297956f","netlify/functions/panel-api.mjs":"e9c2972404628ed4fdd0ce8588aa41ee40a205ee","netlify/functions/artwork.mjs":"85087fd194747dec3022cc1e606323d695f87cf5","netlify/functions/partial-lead.mjs":"3951916ed03919846a996460fd41e7370f3cb88c","netlify/functions/notify-idy-whatsapp.js":"64ccd3f77c88a79dba4cf90163434fb3137ff3f3","netlify/functions/health.js":"fb8543c0ba0abf641dcf6f6231b2533f6ce9aebc","netlify/functions/idle-leads.mjs":"1d0082706e0e6f0dae7ecd0011e3eb33176b8e99","netlify/functions/whatsapp-webhook.mjs":"81b5dc38e5038da2d3d0f6ca81b9e13810a12715","netlify/functions/conversation-store.mjs":"84909fe90149daca0d1d38a515f4633022129d43","lib/print-quote.cjs":"3bdadffd1138c92003564bffebd32b2ddeaf7cb0","clientScript":"24558b239ebb8fcbb26bcbe53f8e49c3dc6aa7bc56ac2e8b6e5f049c8a375031"};
const report={commit:"85406bda84db2e144e5e60a18199962a8bb11d8d",publicUrl:base,observedAt:new Date().toISOString(),published:false,realWhatsAppMessagesSent:0,realFormsWritten:0};
const hash=s=>createHash('sha256').update(s).digest('hex');
await fs.mkdir('publication-check',{recursive:true});
async function save(){await fs.writeFile('publication-check/report.json',JSON.stringify(report,null,2));}
async function get(path){return fetch(new URL(path,base),{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Cache-Control':'no-cache'}});}
let found=false;
for(let attempt=0;attempt<24;attempt++){
 try{const r=await get('?publication='+report.commit+'&attempt='+attempt);const html=await r.text(),script=html.split('<script>')[1]?.split('</script>')[0]?.trim();if(r.ok&&script&&hash(script)===expected.clientScript){found=true;report.homeStatus=r.status;break;}}
 catch{}
 await new Promise(resolve=>setTimeout(resolve,10000));
}
if(!found){report.pending='A versão pública ainda não contém o commit integrado; verificar o deploy da main no projeto existente.';await save();console.log(JSON.stringify(report));process.exit(2);}
try{
 report.sourceChecks=[];
 for(const [path,digest] of Object.entries(expected)){
  if(path==='clientScript')continue;
  const r=await get(path);assert(r.ok,'Fonte pública indisponível: '+path);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(createHash('sha1').update('blob '+bytes.length+String.fromCharCode(0)).update(bytes).digest('hex'),digest,'Versão divergente: '+path);report.sourceChecks.push({path,matched:true});
 }
 async function chat(messages){const r=await fetch(base+'.netlify/functions/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages}),signal:AbortSignal.timeout(20000)});assert.equal(r.status,200);return r.json();}
 const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
 const scenarios=[
  {name:'3 A3 somente frente',messages:[u('Quero 3 cópias A3 coloridas somente frente')],total:900},
  {name:'100 A3 frente e verso',messages:[u('Quero 100 cópias A3 coloridas frente e verso')],total:60000},
  {name:'Cor anterior ao formato',messages:[u('Colorida'),a('Qual formato?'),u('A3'),a('Quantas folhas?'),u('3, somente frente')],total:900},
  {name:'Resposta curta cores',messages:[u('3 cópias A3 somente frente'),a('Colorida ou preto e branco?'),u('Cores')],total:900},
  {name:'Anexo não altera pedido',messages:[u('3 cópias A3 coloridas somente frente'),{role:'user',kind:'attachment',content:'O cliente selecionou uma arte/arquivo chamado A4 preto e branco.pdf.'},u('Qual o total?')],total:900}
 ];
 report.quotes=[];
 for(const s of scenarios){const body=await chat(s.messages);assert.equal(body.quote?.totalCents,s.total,s.name);assert.equal(body.quote.pricePerFaceCents,300);assert(!/colorida ou|preto e branco\?/i.test(body.answer));report.quotes.push({scenario:s.name,totalCents:body.quote.totalCents});}
 const unit=await chat([u('Quanto custa uma cópia A3 colorida?')]);assert.match(unit.answer,/R\$ 3,00.*R\$ 6,00/);assert.match(unit.answer,/sulfite comum/);
 const human=await chat([u('Quero falar com um humano')]);assert.equal(human.handoff,true);report.humanHandoffAvailable=true;
 const panel=await get('painel.html');assert.equal(panel.status,200);await panel.body?.cancel();report.panelPageStatus=panel.status;
 report.endpoints=[];
 for(const [name,status] of [['panel-api',401],['notify-idy-whatsapp',405],['whatsapp-webhook',403],['partial-lead',405],['creative-preview',405]]){
  const r=await get('.netlify/functions/'+name);assert.equal(r.status,status,name);await r.body?.cancel();report.endpoints.push({name,status:r.status});
 }
 const health=await get('.netlify/functions/health');assert.equal(health.status,200);const h=await health.json();assert.equal(h.hasKey,true);report.healthOk=true;
 report.published=true;report.observedAt=new Date().toISOString();await save();console.log(JSON.stringify(report));
}catch(error){report.verificationError=String(error.message).slice(0,240);await save();console.log(JSON.stringify(report));process.exitCode=1;}
