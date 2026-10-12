import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

class Element {
  value='';textContent='';children=[];hidden=false;disabled=false;events=new Map();
  appendChild(child){this.children.push(child)}
  get scrollHeight(){return this.children.length}
  addEventListener(name,fn){this.events.set(name,fn)}
  async trigger(name,event={}){return this.events.get(name)?.(event)}
  focus(){}click(){return this.trigger('click')}showModal(){this.open=true}close(){this.open=false}
}
async function page(fetchImpl=async()=>Response.json({answer:'Resposta de teste'})){
  const html=await readFile(new URL('index.html',import.meta.url),'utf8'),elements=new Map();
  for(const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){
    const el=new Element();el.hidden=/\bhidden\b/.test(match[0]);el.disabled=/\bdisabled\b/.test(match[0]);elements.set(match[1],el);
  }
  const get=id=>{assert(elements.has(id),'Elemento '+id);return elements.get(id)};
  const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},fetch:fetchImpl,FormData,console,encodeURIComponent,alert:message=>{throw Error(message)}});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  return {get,html,async start(){get('clientName').value='Cliente de teste';get('clientEmail').value='cliente@example.invalid';get('clientPhone').value='(51) 99999-0000';await get('startForm').trigger('submit',{preventDefault(){}})}};
}

test('a conversa e o envio ficam bloqueados antes de informar os contatos',async()=>{
  let calls=0;const p=await page(async()=>{calls++;return Response.json({answer:'Teste'})});
  assert.equal(p.get('startScreen').hidden,false);assert.equal(p.get('chatPanel').hidden,true);
  p.get('message').value='Quero cartões';await p.get('send').trigger('click');await p.get('submitLead').trigger('click');
  assert.equal(calls,0);assert.equal(p.get('chat').children.length,0);
});
test('nome, e-mail e telefone válidos liberam a conversa sem enviar nada',async()=>{
  let calls=0;const p=await page(async()=>{calls++;return Response.json({answer:'Teste'})});
  const submit=()=>p.get('startForm').trigger('submit',{preventDefault(){}});
  await submit();assert.match(p.get('startError').textContent,/nome/);
  p.get('clientName').value='Cliente';p.get('clientEmail').value='errado';await submit();assert.match(p.get('startError').textContent,/e-mail/);
  p.get('clientEmail').value='cliente@example.invalid';p.get('clientPhone').value='123';await submit();assert.match(p.get('startError').textContent,/telefone/);
  await p.start();assert.equal(p.get('chatPanel').hidden,false);assert.equal(p.get('startScreen').hidden,true);assert.equal(p.get('send').disabled,false);assert.equal(calls,0);
  assert.match(p.get('chat').children[0].children[0].textContent,/Cliente de teste/);
  await submit();assert.equal(p.get('chat').children.length,1);
});
test('o contato inicial e o anexo são reutilizados no registro final',async()=>{
  let form;const p=await page(async(url,options)=>{if(url==='/'){form=options.body;return new Response('Registrado')}return Response.json({ok:true})});
  await p.start();
  p.get('fileInput').files=[new File(['arte de teste'],'arte.pdf',{type:'application/pdf'})];await p.get('fileInput').trigger('change');
  await p.get('lead').trigger('click');assert.match(p.get('contactSummary').textContent,/cliente@example.invalid/);
  await p.get('submitLead').trigger('click');
  assert.equal(form.get('nome'),'Cliente de teste');assert.equal(form.get('email'),'cliente@example.invalid');assert.equal(form.get('whatsapp'),'(51) 99999-0000');assert.equal(form.get('arte').name,'arte.pdf');assert.match(form.get('resumo'),/E-mail: cliente@example.invalid/);
});
test('a identificação inicial mantém a proteção contra pedidos simultâneos',async()=>{
  let release,calls=0;const wait=new Promise(resolve=>{release=resolve});
  const p=await page(async()=>{calls++;await wait;return Response.json({answer:'Teste'})});await p.start();
  p.get('message').value='500 cartões';const pending=p.get('send').trigger('click');p.get('message').value='Outro pedido';await p.get('message').trigger('keydown',{key:'Enter',preventDefault(){}});
  assert.equal(calls,1);release();await pending;assert.equal(p.get('send').disabled,false);
});
