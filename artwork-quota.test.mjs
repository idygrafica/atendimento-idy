import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createArtworkHandler} from './lib/artwork.mjs';
import {createQuota,quotaLimits,dayWindow} from './lib/artwork-quota.mjs';
import {MemoryStore} from './test-store.mjs';

const env={OPENAI_API_KEY:'mock-key'},png=Buffer.from([137,80,78,71,13,10,26,10,0,1]).toString('base64');
const completed={status:'completed',output:[{type:'image_generation_call',result:png}]};
const request=(method,ticket)=>new Request('https://example.invalid/.netlify/functions/artwork',{method,headers:{Origin:'https://example.invalid','Content-Type':'application/json',...(ticket?{Authorization:'Bearer '+ticket}:{})},...(method==='POST'?{body:JSON.stringify({mode:'create',brief:'Crie uma arte fictícia para teste.'})}:{})});
function setup({fetchImpl,clock=Date.parse('2026-10-12T12:00:00Z'),config={},store=new MemoryStore()}={}){
  let stamp=clock,calls=0;const fetcher=fetchImpl||(async(url,options)=>options.method==='POST'?Response.json({id:'resp_job'+(++calls)}):Response.json(options.method==='DELETE'?{deleted:true}:completed));
  const handler=createArtworkHandler({env:{...env,...config},fetchImpl:fetcher,storeFactory:async()=>store,now:()=>stamp});
  return {store,handler,setTime:value=>stamp=Date.parse(value),now:()=>stamp,calls:()=>calls,post:ip=>handler(request('POST'),{ip:ip||'ip-a'}),poll:ticket=>handler(request('GET',ticket))};
}
async function finish(f,ip){const r=await f.post(ip);assert.equal(r.status,202);const ticket=(await r.json()).ticket;assert.equal((await f.poll(ticket)).status,200);return ticket;}
const ledger=f=>[...f.store.values.entries()].find(([key])=>key.startsWith('quota-v2/'))?.[1]?.data;

test('configuração padrão permite três criações por IP e vinte no total; valores inválidos não viram padrão silenciosamente',()=>{
  assert.deepEqual(quotaLimits({}),{daily:20,perIP:3,attemptsDaily:60,attemptsPerIP:12});
  for(const value of ['0','-1','NaN','abc','3.5','101'])assert.throws(()=>quotaLimits({IDY_ARTWORK_DAILY_LIMIT:value}));
  assert.equal(quotaLimits({IDY_ARTWORK_PER_IP_LIMIT:'1'}).perIP,1);
});
test('janela diária renova à meia-noite em São Paulo, inclusive na virada de mês e ano',()=>{
  assert.deepEqual(dayWindow(Date.parse('2026-10-12T02:59:59Z')),{day:'2026-10-11',resetAt:Date.parse('2026-10-12T03:00:00Z'),timeZone:'America/Sao_Paulo'});
  assert.equal(dayWindow(Date.parse('2026-10-12T03:00:00Z')).day,'2026-10-12');
  assert.equal(dayWindow(Date.parse('2027-01-01T02:59:59Z')).day,'2026-12-31');
  assert.equal(dayWindow(Date.parse('2026-11-01T02:59:59Z')).resetAt,Date.parse('2026-11-01T03:00:00Z'));
});
test('erros HTTP confirmados não descontam prévias; ainda é possível concluir três imagens',async()=>{
  let posts=0;const f=setup({fetchImpl:async(url,options)=>{
    if(options.method!=='POST')return Response.json(completed);
    const statuses=[400,429,200,200,200];const status=statuses[posts++]||200;
    return status===200?Response.json({id:'resp_job'+posts}):Response.json({error:'Erro simulado'},{status});
  }});
  assert.equal((await f.post()).status,502);assert.equal((await f.post()).status,503);
  await finish(f);await finish(f);await finish(f);
  const blocked=await f.post(),data=await blocked.json();assert.equal(blocked.status,429);assert.equal(data.errorCode,'PREVIEW_DAILY_LIMIT');assert.equal(posts,5);assert.equal(ledger(f).attempts,5);
  assert.equal(Object.values(ledger(f).jobs).filter(j=>j.state==='completed').length,3);assert.equal(Object.values(ledger(f).jobs).filter(j=>j.state==='failed').length,2);
});
test('falha assíncrona e resposta sem imagem liberam reserva sem contar como sucesso',async()=>{
  for(const failed of [{status:'failed',output:[]},{status:'cancelled',output:[]},{status:'completed',output:[]}]){
    let posts=0,polls=0;const f=setup({fetchImpl:async(url,options)=>options.method==='POST'?Response.json({id:'resp_job'+(++posts)}):Response.json(++polls===1?failed:completed)});
    const ticket=(await (await f.post()).json()).ticket;assert.equal((await f.poll(ticket)).status,502);
    await finish(f);await finish(f);await finish(f);assert.equal((await f.post()).status,429);assert.equal(ledger(f).attempts,4);
  }
});
test('falhas definitivas repetidas têm um teto de tentativas separado para proteger os gastos',async()=>{
  let calls=0;const f=setup({fetchImpl:async()=>{calls++;return Response.json({error:'Sem autorização'},{status:403})}});
  for(let i=0;i<12;i++)assert.equal((await f.post()).status,503);
  const r=await f.post();assert.equal((await r.json()).errorCode,'PREVIEW_ATTEMPT_LIMIT');assert.equal(calls,12);assert.equal(Object.values(ledger(f).jobs).filter(j=>j.state==='completed').length,0);
});
test('excesso de tentativas por diferentes IPs também tem teto global',async()=>{
  let calls=0;const f=setup({fetchImpl:async()=>{calls++;return Response.json({error:'Pedido inválido'},{status:400})}});
  for(let i=0;i<60;i++)assert.equal((await f.post('ip-'+i)).status,502);
  assert.equal((await (await f.post('nova-conexao')).json()).errorCode,'PREVIEW_ATTEMPT_LIMIT');assert.equal(calls,60);
});
test('meia-noite local libera a quota mesmo quando a data UTC continua igual',async()=>{
  const f=setup({clock:Date.parse('2026-10-12T02:50:00Z')});await finish(f);await finish(f);await finish(f);
  f.setTime('2026-10-12T02:59:59Z');const blocked=await f.post(),body=await blocked.json();assert.equal(body.errorCode,'PREVIEW_DAILY_LIMIT');assert.equal(body.resetAt,'2026-10-12T03:00:00.000Z');assert.equal(blocked.headers.get('Retry-After'),'1');
  f.setTime('2026-10-12T03:00:00Z');await finish(f);assert.equal([...f.store.values.keys()].filter(k=>k.startsWith('quota-v2/')).length,2);
});
test('a virada de UTC às 21h locais não abre uma segunda quota no mesmo dia brasileiro',async()=>{
  const f=setup({clock:Date.parse('2026-10-12T23:55:00Z')});await finish(f);await finish(f);await finish(f);f.setTime('2026-10-13T00:01:00Z');assert.equal((await (await f.post()).json()).errorCode,'PREVIEW_DAILY_LIMIT');assert.equal(f.calls(),3);
});
test('conclusão de trabalho após a meia-noite é debitada no dia em que iniciou',async()=>{
  const f=setup({clock:Date.parse('2026-10-12T02:59:00Z')}),ticket=(await (await f.post()).json()).ticket;
  f.setTime('2026-10-12T03:01:00Z');assert.equal((await f.poll(ticket)).status,200);await finish(f);
  for(const {data} of f.store.values.values())assert.equal(Object.values(data.jobs).filter(j=>j.state==='completed').length,1);
});
test('consultas repetidas e exclusão da resposta não descontam nem devolvem sucesso mais de uma vez',async()=>{
  const f=setup(),ticket=await finish(f);for(let i=0;i<10;i++)assert.equal((await f.poll(ticket)).status,200);
  assert.equal((await f.handler(request('DELETE',ticket))).status,200);assert.equal(ledger(f).attempts,1);assert.equal(Object.values(ledger(f).jobs).filter(j=>j.state==='completed').length,1);
});
test('limite global recusado não consome tentativa ou reserva do próximo IP',async()=>{
  const store=new MemoryStore(),quota=createQuota({store,limits:{daily:1,perIP:3,attemptsDaily:3,attemptsPerIP:12},now:()=>Date.parse('2026-10-12T12:00:00Z')});
  const one=await quota.reserve('ip-a');await quota.settle(one,'completed','resp_a');
  await assert.rejects(quota.reserve('ip-b'),{code:'PREVIEW_DAILY_LIMIT'});const data=[...store.values.values()][0].data;assert.equal(data.attempts,1);assert.equal(data.ips['ip-b'],undefined);
});
test('reservas globais e por IP são atômicas mesmo com chamadas simultâneas',async()=>{
  const f=setup({config:{IDY_ARTWORK_DAILY_LIMIT:'3',IDY_ARTWORK_PER_IP_LIMIT:'3'}});
  const replies=await Promise.all(Array.from({length:10},()=>f.post()));assert.equal(replies.filter(r=>r.status===202).length,3);assert.equal(f.calls(),3);assert.equal(Object.keys(ledger(f).jobs).length,3);
});
test('processamento em andamento e resultados incertos não aparecem como limite de imagens concluídas',async()=>{
  const f=setup();for(let i=0;i<3;i++)assert.equal((await f.post()).status,202);
  assert.equal((await (await f.post()).json()).errorCode,'PREVIEW_PENDING');f.setTime('2026-10-12T12:21:00Z');assert.equal((await (await f.post()).json()).errorCode,'PREVIEW_UNCONFIRMED');assert.equal(f.calls(),3);
});
test('timeout ou erro 5xx mantém reserva conservadora, pois o provedor pode ter aceitado uma criação',async()=>{
  for(const fetchImpl of [async()=>{throw Error('Timeout')},async()=>Response.json({error:'Instável'},{status:500})]){
    const f=setup({fetchImpl});for(let i=0;i<3;i++)assert([502,504].includes((await f.post()).status));
    assert.equal((await (await f.post()).json()).errorCode,'PREVIEW_UNCONFIRMED');assert.equal(Object.values(ledger(f).jobs).filter(j=>j.state==='completed').length,0);
  }
});
test('imagem gerada com saída ilegível mantém proteção de custo e não é contada como prévia entregue',async()=>{
  const f=setup({fetchImpl:async(url,options)=>options.method==='POST'?Response.json({id:'resp_bad'}):Response.json({status:'completed',output:[{type:'image_generation_call',result:'AAAA'}]})});
  const ticket=(await (await f.post()).json()).ticket;assert.equal((await f.poll(ticket)).status,502);assert.equal(Object.values(ledger(f).jobs)[0].state,'unavailable');
});
test('tickets anteriores continuam válidos e contadores antigos não são alterados',async()=>{
  const f=setup();await f.store.setJSON('quota/2026-10-12/global',{count:5});
  const payload=Buffer.from(JSON.stringify({id:'resp_legacy',expires:f.now()+1200000})).toString('base64url'),ticket=payload+'.'+createHmac('sha256',env.OPENAI_API_KEY).update(payload).digest('hex');
  assert.equal((await f.poll(ticket)).status,200);assert.equal((await f.store.getWithMetadata('quota/2026-10-12/global')).data.count,5);assert.equal(f.store.values.size,1);
});
