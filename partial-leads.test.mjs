import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartialLeadHandler,createIdleNotifier,IDLE_MS} from './lib/partial-leads.mjs';
import {MemoryStore} from './test-store.mjs';
const contact={nome:'Cliente fictício',email:'cliente@example.invalid',whatsapp:'(51) 99999-0000'},env={OPENAI_API_KEY:'mock-key',CONTEXT:'production'};
const request=(body,ticket,origin='https://example.invalid')=>new Request('https://example.invalid/.netlify/functions/partial-lead',{method:'POST',headers:{origin,'Content-Type':'application/json',...(ticket?{Authorization:'Bearer '+ticket}:{})},body:JSON.stringify({startId:'12345678-1234-4234-8234-123456789abc',...body})});
async function fixture(){
  const store=new MemoryStore();let time=1700000000000;const handler=createPartialLeadHandler({env,storeFactory:async()=>store,now:()=>time});
  const response=await handler(request({action:'start',contact}),{ip:'127.0.0.1'});assert.equal(response.status,201);const ticket=(await response.json()).ticket;
  const update=body=>handler(request(body,ticket));
  await update({action:'save',sequence:1,history:[{role:'user',content:'Preciso de 500 cartões.'}],files:['cartao.jpg']});
  return {store,handler,ticket,update,advance:n=>time+=n,now:()=>time};
}
test('contatos e mensagens ficam protegidos e não notificam ao salvar',async()=>{
  const f=await fixture();const r=await f.handler(request({action:'save',sequence:2,history:[],files:[]},f.ticket+'a'));assert.equal(r.status,403);
  assert.equal((await f.handler(request({action:'start',contact},null,'https://attacker.invalid'),{ip:'127.0.0.1'})).status,403);
  assert.equal((await f.handler(request({action:'start',contact:{...contact,email:'errado'}}),{ip:'127.0.0.1'})).status,400);
  assert.equal(f.store.values.get('drafts/'+f.ticket.split('.')[0]).data.notice,null);
});
test('mensagens atrasadas não apagam histórico mais recente nem contatos',async()=>{
  const f=await fixture();await f.update({action:'save',sequence:3,history:[{role:'user',content:'Nova mensagem'}],files:[]});await f.update({action:'save',sequence:2,history:[{role:'user',content:'Mensagem antiga'}],files:[]});
  const data=f.store.values.get('drafts/'+f.ticket.split('.')[0]).data;assert.equal(data.sequence,3);assert.equal(data.history[0].content,'Nova mensagem');assert.deepEqual(data.contact,contact);
});
test('avisa uma vez após 10 minutos, com contatos e conversa, sem anexar arquivo não enviado',async()=>{
  const f=await fixture(),calls=[];const worker=createIdleNotifier({env,storeFactory:async()=>f.store,now:f.now,fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({ok:true})}});
  f.advance(IDLE_MS-1);await worker();assert.equal(calls.length,0);f.advance(1);const report=await worker();assert.equal(report.notified,1);assert.equal(calls.length,2);
  assert.equal(calls[0].options.body.get('email'),contact.email);assert.match(calls[0].options.body.get('resumo'),/500 cartões/);assert.match(calls[0].options.body.get('resumo'),/ainda não enviados/);assert.equal(calls[0].options.body.get('arte'),null);
  await worker();assert.equal(calls.length,2);await f.update({action:'save',sequence:4,history:[{role:'user',content:'Voltei.'}],files:[]});f.advance(IDLE_MS);await worker();assert.equal(calls.length,2);
});
test('atividade reinicia o prazo e conclusão cancela o aviso',async()=>{
  const f=await fixture();let calls=0;const worker=createIdleNotifier({env,storeFactory:async()=>f.store,now:f.now,fetchImpl:async()=>{calls++;return Response.json({ok:true})}});
  f.advance(IDLE_MS-1);await f.update({action:'save',sequence:2,history:[{role:'user',content:'Mais uma pergunta.'}],files:[]});f.advance(2);await worker();assert.equal(calls,0);
  await f.update({action:'complete'});f.advance(IDLE_MS);await worker();assert.equal(calls,0);
});
test('envio final em curso e versão de teste não geram avisos parciais',async()=>{
  const f=await fixture();let calls=0;const dependencies={env,storeFactory:async()=>f.store,now:f.now,fetchImpl:async()=>{calls++;return Response.json({ok:true})}};
  f.advance(IDLE_MS);await f.update({action:'submitting'});f.advance(60000);await createIdleNotifier(dependencies)();assert.equal(calls,0);
  f.advance(IDLE_MS);await createIdleNotifier({...dependencies,env:{...env,CONTEXT:'deploy-preview'}})();assert.equal(calls,0);
  await f.update({action:'resume'});f.advance(IDLE_MS);await createIdleNotifier(dependencies)();assert.equal(calls,2);
});
test('execuções concorrentes e resposta incerta não duplicam aviso',async()=>{
  const f=await fixture();f.advance(IDLE_MS);let calls=0;const worker=createIdleNotifier({env,storeFactory:async()=>f.store,now:f.now,fetchImpl:async()=>{calls++;throw Error('Falha de rede')}});
  await Promise.all([worker(),worker()]);assert.equal(calls,2);await worker();assert.equal(calls,2);assert.equal(f.store.values.get('drafts/'+f.ticket.split('.')[0]).data.notice.state,'unconfirmed');
});
test('repetir o início após falha de rede mantém o mesmo atendimento e aviso único',async()=>{
  const f=await fixture();const r=await f.handler(request({action:'start',contact}),{ip:'127.0.0.1'});assert.equal(r.status,200);assert.equal((await r.json()).ticket,f.ticket);assert.equal([...f.store.values.keys()].filter(k=>k.startsWith('drafts/')).length,1);
});
test('retomar o atendimento exige o ticket e retorna somente histórico e estado público da prévia',async()=>{
  const f=await fixture(),key='drafts/'+f.ticket.split('.')[0],record=(await f.store.getWithMetadata(key)).data;record.artwork={state:'completed',responseId:'private-response',id:'private-claim'};await f.store.setJSON(key,record);
  const response=await f.update({action:'restore'}),data=await response.json();assert.equal(response.status,200);assert.equal(data.previewUsed,true);assert.equal(data.history[0].content,'Preciso de 500 cartões.');assert(!JSON.stringify(data).includes('private-response'));assert.equal((await f.handler(request({action:'restore'},f.ticket+'a'))).status,403);
});
