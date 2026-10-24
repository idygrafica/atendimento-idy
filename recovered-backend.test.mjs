import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {installFixture,panel,webhook,conversations,notify,creative,health} from './backend-test-fixtures.mjs';
const phone='5551999990000';
const req=(key,body,query='')=>new Request('https://fixture.invalid/.netlify/functions/panel-api'+query,{method:body?'POST':'GET',headers:{'x-panel-key':key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
const seed=()=>({phone,name:'Cliente fictício',mode:'ai',messages:[{role:'user',text:'Três A3 coloridas',at:new Date(0).toISOString()}]});
function fixture(t){const f=installFixture();t.after(()=>f.restore());return f;}

test('seis fontes recuperadas preservam exatamente os bytes públicos auditados',()=>{
 const manifest=JSON.parse(fs.readFileSync('config/published-backend.json'));
 assert.equal(manifest.recoveredSources.length,6);assert.equal(manifest.authoritativeInventoryConfirmed,false);
 for(const source of manifest.recoveredSources)assert.equal(createHash('sha256').update(fs.readFileSync(source.path)).digest('hex'),source.sha256,source.path);
});
test('painel protege histórico antes de acessar o armazenamento',async t=>{
 const f=fixture(t);assert.equal((await panel(req('invalid'))).status,401);
 delete process.env.PANEL_ACCESS_KEY;assert.equal((await panel(req(f.key))).status,503);
 assert.equal(f.store.values.size,0);
});
test('painel recuperado lista cliente e histórico completo do armazenamento de conversas',async t=>{
 const f=fixture(t);await conversations.saveConversation(seed());
 const list=await (await panel(req(f.key))).json();assert.equal(list.conversations[0].phone,phone);assert.equal(list.conversations[0].count,1);
 const detail=await (await panel(req(f.key,null,'?phone='+phone))).json();assert.equal(detail.conversation.messages[0].text,'Três A3 coloridas');
});
test('modo humano impede resposta automática do webhook e conserva a nova mensagem',async t=>{
 const f=fixture(t);await conversations.saveConversation(seed());
 const mode=await panel(req(f.key,{action:'set_mode',phone,mode:'human'}));assert.equal(mode.status,200);
 let external=0;globalThis.fetch=async()=>{external++;throw Error('Não enviar')};
 const r=await webhook(new Request('https://fixture.invalid/webhook',{method:'POST',body:JSON.stringify({entry:[{changes:[{value:{messages:[{from:phone,id:'fixture-message',type:'text',text:{body:'Quero falar com a equipe'},timestamp:'1'}]}}]}]})}));
 assert.equal(r.status,200);assert.equal(external,0);const c=await conversations.getConversation(phone);assert.equal(c.messages.at(-1).text,'Quero falar com a equipe');assert.equal(c.mode,'human');
});
test('envio pelo painel é simulado, registra a mensagem humana e preserva o histórico',async t=>{
 const f=fixture(t);await conversations.saveConversation(seed());let sent;
 globalThis.fetch=async(url,options)=>{assert.match(url,/^https:\/\/graph.facebook.com\//);sent=JSON.parse(options.body);return Response.json({messages:[{id:'fixture'}]})};
 assert.equal((await panel(req(f.key,{action:'send_message',phone,text:'Vou conferir seu arquivo.'}))).status,200);
 assert.equal(sent.to,phone);const c=await conversations.getConversation(phone);assert.equal(c.messages.length,2);assert.equal(c.messages.at(-1).role,'human');assert.equal(c.mode,'human');
});
test('notificação recuperada rejeita GET e usa somente Meta simulado no POST',async t=>{
 fixture(t);t.mock.method(console,'log',()=>{});assert.equal((await notify({httpMethod:'GET'})).statusCode,405);let sent;
 globalThis.fetch=async(_,options)=>{sent=JSON.parse(options.body);return Response.json({messages:[{id:'fixture'}]})};
 const r=await notify({httpMethod:'POST',body:JSON.stringify({nome:'Cliente fictício',whatsapp:phone,resumo:'3 A3, total R$ 9,00',arquivo:'arte.pdf'})});
 assert.equal(r.statusCode,200);assert.equal(JSON.parse(r.body).ok,true);assert.match(JSON.stringify(sent),/arte.pdf/);assert.match(JSON.stringify(sent),/9,00/);
});
test('prévia do painel recuperada mantém autorização e usa imagem fictícia',async t=>{
 const f=fixture(t);assert.equal((await creative({httpMethod:'POST',headers:{},body:'{}'})).statusCode,401);
 let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({data:[{b64_json:'ZmFrZQ=='}]})};
 const r=await creative({httpMethod:'POST',headers:{'x-panel-key':f.key},body:JSON.stringify({type:'logo',brief:'Loja fictícia, verde e azul'})});
 assert.equal(r.statusCode,200);assert.equal(calls,1);assert.equal(JSON.parse(r.body).image,'data:image/png;base64,ZmFrZQ==');
});
test('health informa somente presença de chave; verificação do webhook mantém seu contrato',async t=>{
 const f=fixture(t);const h=await health();assert.deepEqual(JSON.parse(h.body),{status:'netlify-function-ok',hasKey:true});assert(!h.body.includes(f.key));
 assert.equal((await webhook(new Request('https://fixture.invalid/webhook'))).status,403);
 const r=await webhook(new Request('https://fixture.invalid/webhook?hub.mode=subscribe&hub.verify_token='+f.key+'&hub.challenge=fixture-challenge'));
 assert.equal(await r.text(),'fixture-challenge');
});
test('armazenamento recuperado conserva a política existente de últimas 120 mensagens',async t=>{
 fixture(t);for(let i=0;i<122;i++)await conversations.appendMessage(phone,{role:'user',text:'Mensagem '+i},'Cliente fictício');
 const c=await conversations.getConversation(phone);assert.equal(c.messages.length,120);assert.equal(c.messages[0].text,'Mensagem 2');
});
test('script legado falha antes de qualquer publicação mesmo com credencial fictícia',()=>{
 const code="globalThis.fetch=()=>{throw Error('Network forbidden')};await import('./deploy-artwork.mjs')";
 const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',env:{...process.env,NETLIFY_AUTH_TOKEN:'fixture-only',NETLIFY_SITE_ID:'fixture-only'}});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Publicação legada desativada/);
 const workflow=fs.readFileSync('.github/workflows/initial-contact-preview.yml','utf8');assert(!/deploy-artwork|NETLIFY_AUTH_TOKEN|secrets\./.test(workflow));
});
