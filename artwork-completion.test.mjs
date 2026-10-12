import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtworkHandler} from './lib/artwork.mjs';
import {createArtworkCompletion} from './lib/artwork-completion.mjs';
import {MemoryStore,testAttendance} from './test-store.mjs';

const image=Buffer.from([137,80,78,71,13,10,26,10,0,1]).toString('base64'),completed={status:'completed',output:[{type:'image_generation_call',result:image}]};
async function setup(){
  const quota=new MemoryStore(),attendance=new MemoryStore(),notifications=new MemoryStore(),env={OPENAI_API_KEY:'mock-openai',WHATSAPP_ACCESS_TOKEN:'mock-meta',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_ARTWORK_TEMPLATE_NAME:'idy_previa_arte_responsavel'};
  let stamp=Date.parse('2026-10-12T14:00:00Z'),messages=0,posts=0,status=completed;
  const dependencies={env,now:()=>stamp,quotaStoreFactory:async()=>quota,storeFactory:async()=>quota,attendanceStoreFactory:async()=>attendance,notificationStoreFactory:async()=>notifications,
    fetchImpl:async(url,options={})=>Response.json(options.method==='POST'?{id:'resp_job'+(++posts)}:status),
    whatsappFetchImpl:async url=>Response.json(url.endsWith('/media')?{id:'123123'}:{messages:[{id:'wamid.mock'+(++messages)}]})};
  const handler=createArtworkHandler(dependencies),monitor=createArtworkCompletion(dependencies);
  const ticket=await testAttendance(attendance,env.OPENAI_API_KEY,{now:stamp,history:[{role:'user',content:'500 cartões de visita.'},{role:'assistant',content:'Total: R$ 85,00.'}]});
  const request=(method,artTicket)=>new Request('https://example.invalid/.netlify/functions/artwork',{method,headers:{Origin:'https://example.invalid','Content-Type':'application/json',...(artTicket?{Authorization:'Bearer '+artTicket}:{})},...(method==='POST'?{body:JSON.stringify({mode:'create',brief:'Crie uma arte moderna para os cartões.',attendanceTicket:ticket})}:{})});
  return {monitor,handler,request,quota,attendance,notifications,ticket,messages:()=>messages,posts:()=>posts,setStatus:v=>status=v,advance:n=>stamp+=n};
}
test('imagem concluída é notificada mesmo se o cliente fechar a página sem consultar o resultado',async()=>{
  const f=await setup();assert.equal((await f.handler(f.request('POST'),{ip:'ip-test'})).status,202);assert.equal(f.messages(),0);
  const report=await f.monitor.processPending();assert.equal(report.generated,true);assert.equal(report.notification,'accepted');assert.equal(f.messages(),1);assert.equal((await f.handler(f.request('POST'),{ip:'ip-test'})).status,409);assert.equal(f.posts(),1);
});
test('monitor não notifica trabalho em preparação e devolve a prévia em falha confirmada',async()=>{
  const f=await setup();await f.handler(f.request('POST'),{ip:'ip-test'});f.setStatus({status:'in_progress'});assert.equal((await f.monitor.processPending()).generated,false);assert.equal(f.messages(),0);
  f.advance(60000);f.setStatus({status:'failed',output:[]});assert.equal((await f.monitor.processPending()).failed,true);assert.equal(f.messages(),0);assert.equal((await f.handler(f.request('POST'),{ip:'ip-test'})).status,202);assert.equal(f.posts(),2);
});
test('monitor e consulta do cliente em paralelo não duplicam o aviso',async()=>{
  const f=await setup(),response=await f.handler(f.request('POST'),{ip:'ip-test'}),ticket=(await response.json()).ticket;
  await Promise.all([f.monitor.processPending(),f.handler(f.request('GET',ticket))]);assert.equal(f.messages(),1);assert.equal(f.posts(),1);
});
test('notificação conserva os dados do orçamento da geração, mesmo se a conversa mudar depois',async()=>{
  const f=await setup();await f.handler(f.request('POST'),{ip:'ip-test'});const key='drafts/'+f.ticket.split('.')[0],row=(await f.attendance.getWithMetadata(key)).data;row.history=[{role:'user',content:'Agora preciso de 1000 panfletos.'},{role:'assistant',content:'Os panfletos custam R$ 120,00.'}];await f.attendance.setJSON(key,row);
  await f.monitor.processPending();const job=[...f.notifications.values.entries()].find(([key])=>key.startsWith('notifications/'))[1].data;assert.equal(job.fields.product,'Cartões de visita');assert.equal(job.fields.quantity,'500');assert.equal(job.fields.value,'R$ 85,00');
});
