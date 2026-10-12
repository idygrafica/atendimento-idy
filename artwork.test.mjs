import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtworkHandler} from './lib/artwork.mjs';
import {MemoryStore,testAttendance} from './test-store.mjs';

const png=Buffer.from([137,80,78,71,13,10,26,10,0,1,2]).toString('base64'),image='data:image/png;base64,'+png;
const env={OPENAI_API_KEY:'mock-key-never-a-real-secret'};
const req=(method,body,ticket,origin='https://example.invalid')=>new Request('https://example.invalid/.netlify/functions/artwork',{method,headers:{origin,'Content-Type':'application/json',...(ticket?{Authorization:'Bearer '+ticket}:{})},...(body?{body:JSON.stringify(body)}:{})});
const fixture=(fetchImpl=async()=>Response.json({id:'resp_example',status:'queued'}),overrides={})=>{
  const store=new MemoryStore(),attendance=new MemoryStore(),notifications=new MemoryStore(),effectiveEnv=overrides.env||env,now=overrides.now||Date.now;
  const realHandler=createArtworkHandler({env,storeFactory:async()=>store,attendanceStoreFactory:async()=>attendance,notificationStoreFactory:async()=>notifications,fetchImpl,...overrides});
  const handler=async(req,context)=>{
    if(req.method==='POST'){
      const body=await req.clone().json();body.attendanceTicket=await testAttendance(attendance,effectiveEnv.OPENAI_API_KEY||env.OPENAI_API_KEY,{now:now()});
      req=new Request(req,{body:JSON.stringify(body)});
    }return realHandler(req,context);
  };return {store,handler};
};
const start=async handler=>{const r=await handler(req('POST',{mode:'create',brief:'Crie um cartão de exemplo.'}),{ip:'127.0.0.1'});assert.equal(r.status,202);return (await r.json()).ticket;};
test('bloqueia origem externa, entrada inválida e pedidos sem configuração antes de cobrar',async()=>{
  let calls=0;const {handler,store}=fixture(async()=>{calls++;return Response.json({})});
  assert.equal((await handler(req('POST',{mode:'create',brief:'Crie um cartão de exemplo.'},null,'https://attacker.invalid'),{ip:'127.0.0.1'})).status,403);
  assert.equal((await handler(req('POST',{mode:'edit',brief:'Melhore a arte existente.',image:'data:image/png;base64,AAAA'}),{ip:'127.0.0.1'})).status,400);
  assert.equal((await fixture(undefined,{env:{}}).handler(req('POST',{}))).status,503);
  assert.equal(calls,0);assert.equal(store.values.size,0);
});
test('cria uma única proposta em segundo plano sem aceitar modelo ou destinatário do cliente',async()=>{
  let captured;const {handler}=fixture(async(url,options)=>{captured=JSON.parse(options.body);return Response.json({id:'resp_example'})});await start(handler);
  assert.equal(captured.background,true);assert.equal(captured.max_tool_calls,1);assert.equal(captured.tool_choice.type,'image_generation');assert.equal(captured.tools.length,1);assert.equal(captured.tools[0].action,'generate');assert.equal(captured.input[0].content.length,1);
});
test('edição envia a referência e conserva os dados originais na instrução',async()=>{
  let captured;const {handler}=fixture(async(url,options)=>{captured=JSON.parse(options.body);return Response.json({id:'resp_example'})});
  const r=await handler(req('POST',{mode:'edit',brief:'Melhore a composição da minha arte.',image}),{ip:'127.0.0.1'});assert.equal(r.status,202);assert.equal(captured.tools[0].action,'edit');assert.equal(captured.input[0].content[1].image_url,image);assert.match(captured.instructions,/preserve logotipos/);
});
test('assinatura e validade impedem consultar a proposta de outro cliente',async()=>{
  let time=1700000000000,calls=0;const {handler}=fixture(async()=>{calls++;return Response.json({id:'resp_example'})},{now:()=>time});const ticket=await start(handler);
  assert.equal((await handler(req('GET',null,ticket+'a'))).status,403);assert.equal((await handler(req('GET',null,'resp_other.'+'0'.repeat(64)))).status,403);assert.equal(calls,1);
  time+=1200001;assert.equal((await handler(req('GET',null,ticket))).status,410);assert.equal(calls,1);
});
test('consulta mostra processamento e depois a imagem verdadeira; exclusão usa o ticket',async()=>{
  const calls=[];let polls=0;const {handler}=fixture(async(url,options)=>{calls.push({url,method:options.method});if(options.method==='POST')return Response.json({id:'resp_example'});if(options.method==='DELETE')return Response.json({deleted:true});return Response.json(++polls===1?{status:'in_progress'}:{status:'completed',output:[{type:'image_generation_call',result:png}]});});
  const ticket=await start(handler);assert.equal((await handler(req('GET',null,ticket))).status,202);assert.equal((await (await handler(req('GET',null,ticket))).json()).image,image);assert.equal((await handler(req('DELETE',null,ticket))).status,200);assert(calls.at(-1).url.endsWith('/responses/resp_example'));
});
test('falha e saída sem imagem não afirmam que uma arte foi criada nem expõem credenciais',async()=>{
  const {handler}=fixture(async(url,options)=>options.method==='POST'?Response.json({id:'resp_example'}):Response.json({status:'completed',output:[]}));const ticket=await start(handler);const r=await handler(req('GET',null,ticket));assert.equal(r.status,502);assert.equal((await r.json()).ok,false);
  const {handler:failed}=fixture(async()=>Response.json({error:{message:env.OPENAI_API_KEY}},{status:401}));const body=await (await failed(req('POST',{mode:'create',brief:'Crie um cartão de exemplo.'}),{ip:'127.0.0.1'})).text();assert(!body.includes(env.OPENAI_API_KEY));assert.match(body,/habilitada/);
});
test('limites diário e por conexão não permitem custo ilimitado nem corrida de concorrência',async()=>{
  let calls=0;const {handler}=fixture(async()=>{calls++;return Response.json({id:'resp_example'})},{env:{...env,IDY_ARTWORK_DAILY_LIMIT:'2',IDY_ARTWORK_PER_IP_LIMIT:'2'}});
  const statuses=await Promise.all([1,2,3,4].map(async()=> (await handler(req('POST',{mode:'create',brief:'Crie um cartão de exemplo.'}),{ip:'127.0.0.1'})).status));assert.equal(calls,2);assert.equal(statuses.filter(s=>s===202).length,2);assert.equal(statuses.filter(s=>s===429).length,2);
});
