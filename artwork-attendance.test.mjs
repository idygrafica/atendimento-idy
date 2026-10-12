import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtworkHandler} from './lib/artwork.mjs';
import {MemoryStore,testAttendance} from './test-store.mjs';

const image=Buffer.from([137,80,78,71,13,10,26,10,0,1]).toString('base64');
const env={OPENAI_API_KEY:'mock-openai',WHATSAPP_ACCESS_TOKEN:'mock-meta',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_ARTWORK_TEMPLATE_NAME:'idy_previa_arte_responsavel'};
const request=(method,body,ticket)=>new Request('https://example.invalid/.netlify/functions/artwork',{method,headers:{Origin:'https://example.invalid','Content-Type':'application/json',...(ticket?{Authorization:'Bearer '+ticket}:{})},...(body?{body:JSON.stringify(body)}:{})});
async function setup({provider,configuration=env,whatsappFetch,clock=Date.parse('2026-10-12T14:00:00Z')}={}){
  const quota=new MemoryStore(),attendance=new MemoryStore(),notifications=new MemoryStore(),calls=[],meta=[];let stamp=clock;
  const attendanceTicket=await testAttendance(attendance,env.OPENAI_API_KEY,{now:stamp,history:[{role:'user',content:'Preciso de 500 cartões de visita.'},{role:'assistant',content:'500 cartões, frente e verso. Valor total: R$ 85,00. Prazo de 5 dias úteis.'}]});
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});if(provider)return provider(url,options,calls);
    return Response.json(options.method==='POST'?{id:'resp_example'}:options.method==='DELETE'?{deleted:true}:{status:'completed',output:[{type:'image_generation_call',result:image}]});
  };
  const whatsappFetchImpl=async(url,options)=>{meta.push({url,options});return whatsappFetch?whatsappFetch(url,options,meta):Response.json(url.endsWith('/media')?{id:'123123'}:{messages:[{id:'wamid.accepted'}]});};
  const handler=createArtworkHandler({env:configuration,fetchImpl,whatsappFetchImpl,storeFactory:async()=>quota,attendanceStoreFactory:async()=>attendance,notificationStoreFactory:async()=>notifications,now:()=>stamp});
  const post=(body={},context={ip:'ip-a'})=>handler(request('POST',{mode:'create',brief:'Crie uma arte moderna para o meu cartão.',attendanceTicket,...body}),context);
  const poll=(ticket,context={})=>handler(request('GET',null,ticket),context);
  return {handler,post,poll,quota,attendance,notifications,attendanceTicket,calls,meta,setTime:v=>stamp=Date.parse(v)};
}
async function complete(f,context){const r=await f.post();assert.equal(r.status,202);const ticket=(await r.json()).ticket;const result=await f.poll(ticket,context);assert.equal(result.status,200);return {ticket,result:await result.json()};}

test('uma única prévia por atendimento, com notificação automática após gerar e sem autorização humana prévia',async()=>{
  const f=await setup(),{result}=await complete(f);assert(result.image.startsWith('data:image/png;base64,'));assert.equal(result.notification.state,'accepted');
  assert.equal(f.meta.length,2);assert(f.meta[0].url.endsWith('/123456/media'));assert(f.meta[1].url.endsWith('/123456/messages'));
  const file=f.meta[0].options.body.get('file');assert.equal(file.type,'image/png');assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.from(image,'base64'));
  const message=JSON.parse(f.meta[1].options.body);assert.equal(message.to,'5551981687562');assert.equal(message.template.components[0].parameters[0].image.id,'123123');
  const fields=message.template.components[1].parameters.map(p=>p.text);assert.deepEqual(fields.slice(0,5),['Cliente fictício','(51) 99999-0000','Cartões de visita','500','R$ 85,00']);assert.equal(fields[5],f.attendanceTicket.split('.')[0]);assert.match(fields[6],/12\/10\/2026.*11:00:00.*America\/Sao_Paulo/);
  const second=await f.post();assert.equal(second.status,409);const blocked=await second.json();assert.equal(blocked.errorCode,'ARTWORK_ALREADY_USED');assert.match(blocked.humanUrl,/wa.me\/5551981687562/);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(f.meta.length,2);
});
test('bloqueio da segunda geração vale para edição, outro IP e outro dia no mesmo atendimento',async()=>{
  const f=await setup();await complete(f);f.setTime('2026-10-13T14:00:00Z');
  const r=await f.post({mode:'edit',image:'data:image/png;base64,'+image},{ip:'ip-diferente'});assert.equal((await r.json()).errorCode,'ARTWORK_ALREADY_USED');assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
});
test('falha confirmada de início não consome a prévia única nem envia notificação',async()=>{
  let posts=0;const f=await setup({provider:async(url,options)=>options.method==='POST'&&++posts===1?Response.json({error:'Falha simulada'},{status:400}):Response.json(options.method==='POST'?{id:'resp_retry'}:{status:'completed',output:[{type:'image_generation_call',result:image}]})});
  assert.equal((await f.post()).status,502);assert.equal(f.meta.length,0);await complete(f);assert.equal(posts,2);assert.equal(f.meta.length,2);assert.equal((await f.post()).status,409);
});
test('falha assíncrona confirmada libera a prévia para nova tentativa no mesmo atendimento',async()=>{
  let posts=0;const f=await setup({provider:async(url,options)=>options.method==='POST'?Response.json({id:'resp_job'+(++posts)}):Response.json(posts===1?{status:'failed',output:[]}:{status:'completed',output:[{type:'image_generation_call',result:image}]})});
  const ticket=(await (await f.post()).json()).ticket;assert.equal((await f.poll(ticket)).status,502);assert.equal(f.meta.length,0);await complete(f);assert.equal(posts,2);
});
test('chamadas simultâneas no mesmo atendimento iniciam só uma geração',async()=>{
  const f=await setup();const responses=await Promise.all(Array.from({length:8},()=>f.post()));assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert(responses.some(r=>r.status===202));assert(responses.every(r=>[202,409].includes(r.status)));
});
test('novo pedido enquanto a prévia está em preparação retoma o mesmo trabalho sem nova cobrança',async()=>{
  const f=await setup();const a=await(await f.post()).json(),b=await(await f.post()).json();assert.equal(b.resumed,true);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(JSON.parse(Buffer.from(a.ticket.split('.')[0],'base64url')).id,JSON.parse(Buffer.from(b.ticket.split('.')[0],'base64url')).id);
});
test('consultas repetidas e concorrentes não duplicam a notificação ao responsável',async()=>{
  const f=await setup(),ticket=(await(await f.post()).json()).ticket;const responses=await Promise.all(Array.from({length:8},()=>f.poll(ticket)));assert(responses.every(r=>r.status===200));assert.equal(f.meta.filter(c=>c.url.endsWith('/messages')).length,1);
});
test('configuração de WhatsApp ausente não impede entregar a imagem nem libera segunda geração',async()=>{
  const f=await setup({configuration:{OPENAI_API_KEY:env.OPENAI_API_KEY}}),{result}=await complete(f);assert(result.image);assert.equal(result.notification.state,'configuration_required');assert.equal(f.meta.length,0);assert.equal((await f.post()).status,409);
});
test('context.waitUntil entrega a imagem sem esperar a notificação e registra o trabalho para continuar',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const f=await setup({whatsappFetch:async url=>{await wait;return Response.json(url.endsWith('/media')?{id:'123123'}:{messages:[{id:'wamid.accepted'}]})}});
  const work=[],{result}=await complete(f,{waitUntil:promise=>work.push(promise)});assert(result.image);assert.equal(work.length,1);assert.equal(result.notification.state,'pending');release();await Promise.all(work);assert.equal([...f.notifications.values.values()][0].data.state,'accepted');
});
test('ticket de atendimento adulterado ou ausente não permite gastar com geração',async()=>{
  const f=await setup();assert.equal((await f.post({attendanceTicket:''})).status,403);assert.equal((await f.post({attendanceTicket:f.attendanceTicket+'a'})).status,403);assert.equal(f.calls.length,0);assert.equal(f.quota.values.size,0);
});
test('falha incerta mantém a proteção por atendimento e não permite gerar outra imagem automaticamente',async()=>{
  const f=await setup({provider:async()=>{throw Error('Timeout')}});assert.equal((await f.post()).status,504);assert.equal((await(await f.post()).json()).errorCode,'ARTWORK_PENDING');assert.equal(f.calls.length,1);assert.equal(f.meta.length,0);
});
