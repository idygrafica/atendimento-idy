import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtworkNotifications,quoteFields} from './lib/artwork-notification.mjs';
import {MemoryStore} from './test-store.mjs';
import {readFile} from 'node:fs/promises';

const env={WHATSAPP_ACCESS_TOKEN:'mock-secret-never-a-real-token',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_ARTWORK_TEMPLATE_NAME:'idy_previa_arte_responsavel'},id='12345678-1234-4234-8234-123456789abc';
const image='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,1]).toString('base64');
async function setup({fetchImpl,configuration=env}={}){
  const store=new MemoryStore(),calls=[];let stamp=Date.parse('2026-10-12T14:00:00Z');
  const envData={...configuration};const api=createArtworkNotifications({env:envData,storeFactory:async()=>store,now:()=>stamp,fetchImpl:async(url,options)=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options,calls):Response.json(url.endsWith('/media')?{id:'123123'}:{messages:[{id:'wamid.accepted'}]});}});
  await api.enqueue({attendanceId:id,responseId:'resp_example',image,contact:{nome:'Cliente fictício',whatsapp:'(51) 99999-0000'},history:[{role:'user',content:'Quero 500 cartões de visita.'},{role:'assistant',content:'Total: R$ 85,00'}]});
  return {api,store,calls,envData,advance:ms=>stamp+=ms,job:()=>store.values.get('notifications/'+id).data};
}
test('envia a imagem como cabeçalho do template e sete campos, usando o número automatizado da Meta e o responsável como destino fixo',async()=>{
  const f=await setup();assert.equal(await f.api.process(id),'accepted');assert.equal(f.calls.length,2);const message=JSON.parse(f.calls[1].options.body);
  assert.equal(message.messaging_product,'whatsapp');assert.equal(message.type,'template');assert.equal(message.template.name,env.WHATSAPP_ARTWORK_TEMPLATE_NAME);assert.equal(message.template.language.code,'pt_BR');assert.equal(message.to,'5551981687562');assert.equal(message.template.components[1].parameters.length,7);assert.equal(message.biz_opaque_callback_data,'idy-art:'+id);assert.equal(f.job().image,null);
});
test('processamentos concorrentes e repetidos mandam no máximo uma mensagem',async()=>{
  const f=await setup();await Promise.all(Array.from({length:10},()=>f.api.process(id)));await f.api.process(id);assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,1);assert.equal(f.job().state,'accepted');
});
test('ausência de template não tenta envio livre fora de janela e permite enviar depois da configuração',async()=>{
  const f=await setup({configuration:{WHATSAPP_ACCESS_TOKEN:env.WHATSAPP_ACCESS_TOKEN,WHATSAPP_PHONE_NUMBER_ID:env.WHATSAPP_PHONE_NUMBER_ID}});assert.equal(await f.api.process(id),'configuration_required');assert.equal(f.calls.length,0);assert.equal(f.job().attempts,0);
  f.envData.WHATSAPP_ARTWORK_TEMPLATE_NAME=env.WHATSAPP_ARTWORK_TEMPLATE_NAME;assert.equal(await f.api.process(id),'accepted');
});
test('rejeição por janela ou template é registrada sem expor a resposta ou o token',async()=>{
  const f=await setup({fetchImpl:async url=>url.endsWith('/media')?Response.json({id:'123123'}):Response.json({error:{code:131047,message:env.WHATSAPP_ACCESS_TOKEN}},{status:400})});assert.equal(await f.api.process(id),'configuration_required');assert.equal(f.job().errorCode,'META_131047');assert(!JSON.stringify(f.job()).includes(env.WHATSAPP_ACCESS_TOKEN));
});
test('rejeição temporária confirmada pode repetir mensagem sem re-upload da imagem',async()=>{
  let messages=0;const f=await setup({fetchImpl:async url=>url.endsWith('/media')?Response.json({id:'123123'}):++messages===1?Response.json({error:{code:130429}},{status:429}):Response.json({messages:[{id:'wamid.accepted'}]})});assert.equal(await f.api.process(id),'retry');assert.equal(await f.api.process(id),'retry');f.advance(60000);assert.equal(await f.api.process(id),'accepted');assert.equal(f.calls.filter(c=>c.url.endsWith('/media')).length,1);assert.equal(messages,2);
});
test('timeout ou resposta ambígua no envio não repete notificação possivelmente já recebida',async()=>{
  for(const result of [async()=>{throw Error('Timeout')},async()=>Response.json({messages:[]}),async()=>new Response('Instável',{status:500})]){
    const f=await setup({fetchImpl:async url=>url.endsWith('/media')?Response.json({id:'123123'}):result()});assert.equal(await f.api.process(id),'unconfirmed');f.advance(600000);await f.api.process(id);assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,1);
  }
});
test('falha de upload permite repetição segura e ainda não envia a mensagem',async()=>{
  let uploads=0;const f=await setup({fetchImpl:async url=>url.endsWith('/media')&&++uploads===1?new Response('Instável',{status:500}):Response.json(url.endsWith('/media')?{id:'123123'}:{messages:[{id:'wamid.accepted'}]})});assert.equal(await f.api.process(id),'retry');assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,0);f.advance(60000);assert.equal(await f.api.process(id),'accepted');
});
test('rejeições temporárias ficam limitadas a três tentativas de envio',async()=>{
  const f=await setup({fetchImpl:async url=>url.endsWith('/media')?Response.json({id:'123123'}):Response.json({error:{code:130429}},{status:429})});for(let i=0;i<4;i++){await f.api.process(id);f.advance(180000);}assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,3);assert.equal(f.job().state,'failed');
});
test('processamento interrompido vira resultado incerto e não provoca envio duplicado',async()=>{
  const f=await setup();const job=f.job();job.state='processing';job.leaseUntil=0;await f.store.setJSON('notifications/'+id,job);assert.equal(await f.api.process(id),'unconfirmed');assert.equal(f.calls.length,0);
});
test('worker processa avisos pendentes e ignora os já aceitos',async()=>{
  const f=await setup();assert.equal((await f.api.processPending()).accepted,1);await f.api.processPending();assert.equal(f.calls.filter(c=>c.url.endsWith('/messages')).length,1);
});
test('campos não definidos não são inventados; valor unitário e preços ambíguos não viram total',()=>{
  const a=quoteFields({},[],id,Date.parse('2026-10-12T02:30:00Z'));assert.equal(a.phone,'Não informado');assert.equal(a.value,'A confirmar');assert.match(a.date,/11\/10\/2026.*23:30:00/);
  for(const text of ['Cada cartão fica por R$ 0,17.','Podemos fazer por R$ 85,00 ou R$ 120,00.'])assert.equal(quoteFields({},[{role:'assistant',content:text}],id,0).value,'A confirmar');
});
test('imagem inválida ou maior que 5 MB não é enviada nem registrada',async()=>{
  const f=await setup();await assert.rejects(f.api.enqueue({attendanceId:'outro',responseId:'resp_other',image:'data:image/png;base64,AAAA'}));assert.equal(f.calls.length,0);
});
test('não mistura preço de cartões com um pedido novo de panfletos e identifica quantidade de site',()=>{
  const fields=quoteFields({},[{role:'assistant',content:'500 cartões custam R$ 85,00.'},{role:'user',content:'Agora preciso de 1000 panfletos.'}],id,0);assert.equal(fields.product,'Panfletos');assert.equal(fields.quantity,'1000');assert.equal(fields.value,'A confirmar');
  const site=quoteFields({},[{role:'user',content:'Preciso de 1 site.'},{role:'assistant',content:'O site tem valor total: R$ 500,00.'}],id,0);assert.equal(site.quantity,'1');assert.equal(site.value,'R$ 500,00');
});
test('definição preparada para aprovação da Meta tem imagem, sete variáveis e rodapé compatíveis com o envio',async()=>{
  const template=JSON.parse(await readFile(new URL('WHATSAPP_PREVIA_TEMPLATE.json',import.meta.url),'utf8'));
  assert.equal(template.name,env.WHATSAPP_ARTWORK_TEMPLATE_NAME);assert.equal(template.language,'pt_BR');assert.equal(template.components.find(c=>c.type==='HEADER').format,'IMAGE');
  const body=template.components.find(c=>c.type==='BODY'),footer=template.components.find(c=>c.type==='FOOTER');assert.deepEqual([...body.text.matchAll(/\{\{(\d)\}\}/g)].map(m=>m[1]),['1','2','3','4','5','6','7']);assert.equal(body.example.body_text[0].length,7);assert(body.text.length<=1024);assert(footer.text.length<=60);assert.match(footer.text,/aprovação humana/);
});
