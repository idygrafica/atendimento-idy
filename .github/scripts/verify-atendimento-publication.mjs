import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base='https://atendimento-idy.netlify.app/',expected={"netlify/functions/creative-preview.js":"14916d45888c08c2d079a55cd08545ea11a981ada605fb51a334353d6a623253","netlify/functions/chat.js":"24a5b5206d45e101c783a8778f664dac3900b0866995dbacda2ba8822b602cdb","netlify/functions/panel-api.mjs":"f47fe03a266971b78583b1794b2acb6d46b7a3c22be1f1a316ac4907e4d31191","netlify/functions/artwork.mjs":"af723fc251c182685cddbde92895fcf4977e540300120dc64b76de7c97a80ae5","netlify/functions/partial-lead.mjs":"7671effb749a105dbdf2af5e196599dea4a3fbe97e78b02c772f6477ca6101f6","netlify/functions/notify-idy-whatsapp.js":"df13b5ee447f9f1a50667a74b6cd9f40e2d1d2dcaee6cb694498882403d91e5b","netlify/functions/health.js":"b0e3c13902ce9f493bce9684ca3c402d9cad3c295848c90f8b74e7734f2991f0","netlify/functions/idle-leads.mjs":"3c73a44b5cc93a5b013540f04047ab25619fb1fbbee166a195cbb05a8d0fe18e","netlify/functions/whatsapp-webhook.mjs":"93f28acedbb3c16de79275a367ef2a007a1b2894aaeb18fb3ede684ce74cfa60","netlify/functions/conversation-store.mjs":"8728c373bc4c082f7dc246a363b634ac8bd208eab5d34e1198b06ebf79e3a35d","lib/print-quote.cjs":"73de4de6a6ff793a4980c945fe69f86d31008efece813c4befc9ec691bc69d7c","clientScript":"24558b239ebb8fcbb26bcbe53f8e49c3dc6aa7bc56ac2e8b6e5f049c8a375031"};
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
  const r=await get(path);assert(r.ok,'Fonte pública indisponível: '+path);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(hash(bytes),digest,'Versão divergente: '+path);report.sourceChecks.push({path,matched:true});
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
