import {createRequire} from 'node:module';
const {handler:chatHandler}=createRequire(import.meta.url)('./netlify/functions/chat.js');
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

class Element {
  value='';textContent='';children=[];hidden=false;disabled=false;events=new Map();
  appendChild(child){this.children.push(child);child.parent=this}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(e=>e!==this)}
  get scrollHeight(){return this.children.length}
  addEventListener(name,fn){this.events.set(name,fn)}
  async trigger(name,event={}){return this.events.get(name)?.(event)}
  focus(){}click(){return this.trigger('click')}showModal(){this.open=true}close(){this.open=false}
}
async function page(fetchImpl=async()=>Response.json({answer:'Resposta de teste'}),{mockPartial=true}={}){
  const html=await readFile(new URL('index.html',import.meta.url),'utf8'),elements=new Map();
  for(const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){
    const el=new Element();el.hidden=/\bhidden\b/.test(match[0]);el.disabled=/\bdisabled\b/.test(match[0]);elements.set(match[1],el);
  }
  const get=id=>{assert(elements.has(id),'Elemento '+id);return elements.get(id)};
  const wrappedFetch=(url,options)=>mockPartial&&url==='/.netlify/functions/partial-lead'?Promise.resolve(Response.json({ok:true,ticket:'mock-ticket'})):fetchImpl(url,options);
  const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},fetch:wrappedFetch,FormData,File,Uint8Array,atob,AbortSignal,AbortController,URL,crypto:webcrypto,console,encodeURIComponent,setTimeout:fn=>fn(),alert:message=>{throw Error(message)}});
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  return {get,html,context,flush:()=>vm.runInContext('partialSaving',context),async start(){get('clientName').value='Cliente de teste';get('clientEmail').value='cliente@example.invalid';get('clientPhone').value='(51) 99999-0000';await get('startForm').trigger('submit',{preventDefault(){}});await vm.runInContext('partialSaving',context)}};
}

test('a conversa e o envio ficam bloqueados antes de informar os contatos',async()=>{
  let calls=0;const p=await page(async()=>{calls++;return Response.json({answer:'Teste'})});
  assert.equal(p.get('startScreen').hidden,false);assert.equal(p.get('chatPanel').hidden,true);
  p.get('message').value='Quero cartões';await p.get('send').trigger('click');
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
  p.get('message').value='Pode encaminhar';await p.get('send').trigger('click');
  assert.equal(form.get('nome'),'Cliente de teste');assert.equal(form.get('email'),'cliente@example.invalid');assert.equal(form.get('whatsapp'),'(51) 99999-0000');assert.equal(form.get('arte').name,'arte.pdf');assert.match(form.get('resumo'),/E-mail: cliente@example.invalid/);
});
test('a identificação inicial mantém a proteção contra pedidos simultâneos',async()=>{
  let release,calls=0;const wait=new Promise(resolve=>{release=resolve});
  const p=await page(async()=>{calls++;await wait;return Response.json({answer:'Teste'})});await p.start();
  p.get('message').value='500 cartões';const pending=p.get('send').trigger('click');p.get('message').value='Outro pedido';await p.get('message').trigger('keydown',{key:'Enter',preventDefault(){}});
  assert.equal(calls,1);release();await pending;assert.equal(p.get('send').disabled,false);
});

const file=()=>new File(['arte de teste'],'arte.pdf',{type:'application/pdf'});
const attach=async p=>{p.get('fileInput').files=[file()];await p.get('fileInput').trigger('change')};
const say=async(p,text)=>{p.get('message').value=text;await p.get('send').trigger('click')};

test('o anexo oferece encaminhamento na conversa sem registrar antes da confirmação',async()=>{
  const calls=[];const p=await page(async(url,options)=>{calls.push({url,options});return Response.json({ok:true,answer:'Resposta'})});
  await p.start();await attach(p);assert.equal(calls.length,0);
  assert.match(p.get('chat').children.at(-1).children[0].textContent,/pedir atendimento humano/);
  assert(!p.html.includes('id="lead"'));assert(!p.html.includes('id="leadDialog"'));
  await say(p,'Não, pode encaminhar.');assert.deepEqual(calls.map(c=>c.url),['/','/.netlify/functions/notify-idy-whatsapp']);
  await say(p,'Pode encaminhar');assert.equal(calls.length,2);
});
test('recusa e perguntas adicionais continuam na IA sem disparar registro',async()=>{
  for(const text of ['Não pode enviar','Não envie ainda','Ainda não','Sim, preciso mudar a quantidade','Pode enviar? Antes preciso saber o preço']){
    const calls=[];const p=await page(async url=>{calls.push(url);return Response.json({answer:'Vamos continuar'})});await p.start();await attach(p);await say(p,text);assert.deepEqual(calls,['/.netlify/functions/chat'],text);
  }
});
test('não sozinho não encaminha o atendimento, mesmo após selecionar arquivo',async()=>{
  const calls=[];const p=await page(async url=>{calls.push(url);return Response.json({answer:'Resposta',ok:true})});await p.start();await say(p,'Não');assert.deepEqual(calls,['/.netlify/functions/chat']);await attach(p);await say(p,'Não');assert.deepEqual(calls,['/.netlify/functions/chat','/.netlify/functions/chat']);
});
test('arquivo selecionado durante a resposta não repete pergunta de confirmação',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const p=await page(async()=>{await wait;return Response.json({answer:'Resposta'})});await p.start();p.get('message').value='Meu pedido';const pending=p.get('send').trigger('click');await attach(p);assert(!p.get('chat').children.at(-1).children[0]);release();await pending;assert.equal(p.get('chat').children.at(-1).children[0].textContent,'Resposta');
});
test('confirmações simultâneas geram apenas um registro e um aviso',async()=>{
  const calls=[];let release;const wait=new Promise(resolve=>release=resolve);const p=await page(async url=>{calls.push(url);if(url==='/')await wait;return Response.json({ok:true})});await p.start();await attach(p);p.get('message').value='Pode enviar';const pending=p.get('send').trigger('click');await say(p,'Pode enviar');await p.flush();assert.deepEqual(calls,['/']);assert.equal(p.get('attach').disabled,true);release();await pending;assert.deepEqual(calls,['/','/.netlify/functions/notify-idy-whatsapp']);assert.equal(p.get('send').disabled,false);
});
test('falha de registro não promete envio e permite repetição explícita com o arquivo',async()=>{
  let forms=0;const p=await page(async url=>{if(url==='/'&&++forms===1)return new Response('Falhou',{status:503});return Response.json({ok:true})});await p.start();await attach(p);await say(p,'Pode encaminhar');assert.match(p.get('status').textContent,/Não foi possível confirmar/);await say(p,'tentar novamente');assert.equal(forms,2);assert.match(p.get('status').textContent,/equipe avisada/);
});
test('falha do aviso WhatsApp preserva o registro e não repete o formulário',async()=>{
  let forms=0;const p=await page(async url=>{if(url==='/'){forms++;return new Response('Salvo')}return Response.json({ok:false},{status:502})});await p.start();await attach(p);await say(p,'Pode encaminhar');assert.match(p.get('status').textContent,/registrado.*não confirmado/);await say(p,'Pode enviar');assert.equal(forms,1);
});
test('a confirmação explícita também encaminha pedidos sem arquivo',async()=>{
  let form;const p=await page(async(url,options)=>{if(url==='/')form=options.body;return Response.json({ok:true})});await p.start();await say(p,'Pode encaminhar');assert.equal(form.get('arte'),null);assert.equal(form.get('email'),'cliente@example.invalid');
});

test('a imagem aparece na conversa sem upload antecipado e seu URL é liberado ao trocar o arquivo',async()=>{
  let calls=0;const p=await page(async()=>{calls++;return Response.json({ok:true})});await p.start();
  p.get('fileInput').files=[new File(['imagem'],'cartao.jpg',{type:'image/jpeg'})];await p.get('fileInput').trigger('change');
  const bubble=p.get('chat').children.at(-2),image=bubble.children[0];assert.match(image.src,/^blob:/);assert.match(image.alt,/cartao.jpg/);assert.equal(calls,0);
  await attach(p);assert.equal(bubble.children.length,0);assert.equal(calls,0);
});

const sampleImage='data:image/png;base64,'+Buffer.from([137,80,78,71,13,10,26,10,0,1]).toString('base64');
test('criação mostra uma proposta baixável e encaminha original e proposta somente após aprovação',async()=>{
  const calls=[];let form;
  const p=await page(async(url,options={})=>{
    calls.push({url,options});
    if(url==='/.netlify/functions/artwork')return Response.json(options.method==='POST'?{ok:true,ticket:'test-ticket'}:options.method==='DELETE'?{ok:true}:{ok:true,status:'completed',image:sampleImage});
    if(url==='/')form=options.body;return Response.json({ok:true});
  });await p.start();await attach(p);await say(p,'Crie uma nova arte: cartão moderno para minha loja.');
  assert.match(p.get('status').textContent,/Prévia pronta/);assert.equal(form,undefined);assert.equal(p.get('chat').children.at(-1).children[1].alt,'Proposta visual criada para aprovação');assert.equal(p.get('chat').children.at(-1).children[2].download,'proposta-idy.png');
  await say(p,'Pode encaminhar esta proposta');assert.equal(form.get('arte').name,'arte.pdf');assert.equal(form.get('proposta').name,'proposta-idy.png');assert.match(form.get('resumo'),/Proposta visual para conferir/);
});
test('edição usa a imagem de referência sem substituir o anexo original',async()=>{
  let payload,form;const p=await page(async(url,options={})=>{
    if(url==='/.netlify/functions/artwork'){if(options.method==='POST')payload=JSON.parse(options.body);return Response.json(options.method==='POST'?{ok:true,ticket:'test-ticket'}:options.method==='DELETE'?{ok:true}:{ok:true,status:'completed',image:sampleImage});}
    if(url==='/')form=options.body;return Response.json({ok:true});
  });await p.start();p.get('fileInput').files=[new File(['original-preservado'],'cartao-original.png',{type:'image/png'})];await p.get('fileInput').trigger('change');
  vm.runInContext('encodeImageReference=async()=>'+JSON.stringify(sampleImage),p.context);await say(p,'Melhore minha arte: mantenha o logo e ajuste as cores.');assert.equal(payload.mode,'edit');assert.equal(payload.image,sampleImage);
  await say(p,'Pode encaminhar');assert.equal(await form.get('arte').text(),'original-preservado');assert.equal(form.get('proposta').name,'proposta-idy.png');
});
test('pergunta de preço não gera imagem e PDF não é enviado como referência de edição',async()=>{
  const calls=[];const p=await page(async url=>{calls.push(url);return Response.json({answer:'Vamos ver o orçamento.'})});await p.start();await attach(p);await say(p,'Quanto custa criar uma arte?');assert.deepEqual(calls,['/.netlify/functions/chat']);await say(p,'Melhore minha arte: aumente o contraste.');assert.equal(calls.length,1);assert.match(p.get('chat').children.at(-1).children[0].textContent,/JPG ou PNG/);
});
test('falha de criação é informada sem proposta fictícia e conserva o encaminhamento',async()=>{
  let form;const p=await page(async(url,options)=>{if(url==='/.netlify/functions/artwork')return Response.json({ok:false,error:'Criação indisponível.'},{status:503});if(url==='/')form=options.body;return Response.json({ok:true})});await p.start();await attach(p);await say(p,'Crie uma arte moderna para meu cartão.');assert.match(p.get('status').textContent,/não foi concluída/);assert.equal(p.get('send').disabled,false);await say(p,'Pode encaminhar');assert.equal(form.get('proposta'),null);assert.equal(form.get('arte').name,'arte.pdf');
});
test('salvamento parcial inclui contatos e conversa, sem upload nem aviso direto',async()=>{
  const calls=[];const p=await page(async(url,options)=>{calls.push({url,body:options?.body});return Response.json(url==='/.netlify/functions/chat'?{answer:'Resposta'}:{ok:true,ticket:'test-ticket'})},{mockPartial:false});await p.start();await say(p,'Preciso de cartões');await p.flush();
  const partial=calls.filter(c=>c.url==='/.netlify/functions/partial-lead').map(c=>JSON.parse(c.body));assert.equal(partial[0].contact.email,'cliente@example.invalid');assert.equal(partial.at(-1).history.length,2);assert(!calls.some(c=>c.url==='/'||c.url.includes('notify-idy')));
  await say(p,'Pode encaminhar');await p.flush();assert(partial.length>=2);const last=calls.filter(c=>c.url==='/.netlify/functions/partial-lead').map(c=>JSON.parse(c.body));assert(last.some(c=>c.action==='submitting'));assert(last.some(c=>c.action==='complete'));
});
test('falha de salvamento automático é visível e não bloqueia a IA',async()=>{
  const p=await page(async url=>url==='/.netlify/functions/partial-lead'?new Response('Falhou',{status:503}):Response.json({answer:'Resposta'}) ,{mockPartial:false});await p.start();assert.match(p.get('saveStatus').textContent,/não confirmado/);await say(p,'Quero cartões');assert.equal(p.get('status').textContent,'Pronto.');
});

test('dois turnos reais do endpoint dão R$ 9,00 e pedido humano registra todo o histórico com anexo',async()=>{
  const forms=[],notifications=[];let ai=0;
  const p=await page(async(url,options)=>{
    if(url==='/.netlify/functions/chat'){ai++;const r=await chatHandler({httpMethod:'POST',body:options.body});return new Response(r.body,{status:r.statusCode,headers:r.headers});}
    if(url==='/')forms.push(options.body);
    if(url==='/.netlify/functions/notify-idy-whatsapp')notifications.push(JSON.parse(options.body));
    return Response.json({ok:true});
  });
  await p.start();await say(p,'Quanto custa uma cópia A3 colorida?');await say(p,'Quero 3, somente frente.');
  assert.match(p.get('chat').children.at(-1).children[0].textContent,/Total: R\$ 9,00/);
  await attach(p);await say(p,'Quero falar com um humano.');
  assert.equal(forms.length,1);assert.equal(notifications.length,1);assert.equal(forms[0].get('arte').name,'arte.pdf');assert.match(forms[0].get('resumo'),/R\$ 9,00/);assert.match(forms[0].get('resumo'),/Quanto custa uma cópia/);assert.match(forms[0].get('resumo'),/Quero falar com um humano/);assert.equal(ai,3);
  await say(p,'humano');assert.equal(forms.length,1);assert.equal(notifications.length,1);
});
test('papel sem tabela solicita a equipe automaticamente, sem frase de confirmação',async()=>{
  let form;const p=await page(async(url,options)=>{
    if(url==='/.netlify/functions/chat'){const r=await chatHandler({httpMethod:'POST',body:options.body});return new Response(r.body,{status:r.statusCode,headers:r.headers});}
    if(url==='/')form=options.body;return Response.json({ok:true});
  });await p.start();await say(p,'Quanto fica em papel mais grosso?');assert(form);assert.match(form.get('resumo'),/mais grosso/);assert(!form.get('resumo').includes('pode encaminhar'));
});
test('botão humano registra histórico e conserva o link de WhatsApp e os dados de contato',async()=>{
  let form;const p=await page(async(url,options)=>{if(url==='/')form=options.body;return Response.json({ok:true,answer:'Resposta anterior'});});
  await p.start();await say(p,'Meu pedido de impressão');await p.get('humanContact').trigger('click');assert(form);assert.match(form.get('resumo'),/Meu pedido de impressão/);assert.match(form.get('resumo'),/Resposta anterior/);assert.equal(form.get('nome'),'Cliente de teste');assert.equal(form.get('whatsapp'),'(51) 99999-0000');assert.match(p.get('humanContact').href,/wa.me\/5551981687562/);
});
test('cliques humanos durante resposta são enfileirados e não duplicam o registro',async()=>{
  let release,forms=0;const wait=new Promise(r=>release=r);const p=await page(async(url)=>{if(url==='/.netlify/functions/chat'){await wait;return Response.json({answer:'Resposta concluída'});}if(url==='/')forms++;return Response.json({ok:true});});
  await p.start();p.get('message').value='Meu pedido';const pending=p.get('send').trigger('click');await p.get('humanContact').trigger('click');await p.get('humanContact').trigger('click');assert.equal(forms,0);release();await pending;assert.equal(forms,1);
});
test('falha no registro humano mantém o anexo e admite uma nova solicitação direta',async()=>{
  let attempts=0,form;const p=await page(async(url,options)=>{if(url==='/.netlify/functions/chat')return Response.json({answer:'Vou solicitar a equipe.',handoff:true});if(url==='/'){form=options.body;if(++attempts===1)return new Response('Falha',{status:503});}return Response.json({ok:true});});
  await p.start();await attach(p);await say(p,'humano');assert.match(p.get('status').textContent,/Não foi possível confirmar/);await say(p,'Quero falar com alguém');assert.equal(attempts,2);assert.equal(form.get('arte').name,'arte.pdf');
});
test('botão humano cancela uma resposta pendente e registra histórico sem esperar a IA',async()=>{
  let form,notice=0,started;const ready=new Promise(resolve=>started=resolve);
  const p=await page((url,options={})=>{
    if(url==='/.netlify/functions/chat'){started();return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));}
    if(url==='/')form=options.body;if(url==='/.netlify/functions/notify-idy-whatsapp')notice++;return Promise.resolve(Response.json({ok:true}));
  });await p.start();await attach(p);p.get('message').value='Preciso de ajuda';const response=p.get('send').trigger('click');await ready;await p.get('humanContact').trigger('click');await response;
  assert.match(form.get('resumo'),/Preciso de ajuda/);assert.match(form.get('resumo'),/atendimento humano/);assert.equal(form.get('arte').name,'arte.pdf');assert.equal(notice,1);assert(!p.get('chat').children.some(c=>/Erro de conexão/.test(c.children[0]?.textContent||'')));
});
test('arquivo inválido ou grande mantém o anexo anterior e permite corrigir a seleção',async()=>{
  const p=await page();await p.start();await attach(p);
  for(const f of [new File(['x'],'programa.exe',{type:'application/octet-stream'}),new File([new Uint8Array(8*1024*1024+1)],'grande.pdf',{type:'application/pdf'})]){
    p.get('fileInput').files=[f];await p.get('fileInput').trigger('change');assert.match(p.get('filetag').textContent,/PDF.*8 MB.*anterior/);assert.equal(vm.runInContext('selectedFile.name',p.context),'arte.pdf');
  }
});
test('clique e Enter concorrentes enviam um único turno e não duplicam o histórico',async()=>{
  let release,payload,calls=0;const waiting=new Promise(resolve=>release=resolve);
  const p=await page(async(url,options)=>{if(url==='/.netlify/functions/chat'){calls++;payload=JSON.parse(options.body);await waiting;return Response.json({answer:'Qual formato?'})}return Response.json({ok:true})});await p.start();
  p.get('message').value='Colorida';const pending=p.get('send').trigger('click');await p.get('message').trigger('keydown',{key:'Enter',preventDefault(){}});await p.get('send').trigger('click');release();await pending;
  assert.equal(calls,1);assert.equal(payload.messages.filter(m=>m.role==='user').length,1);assert.equal(vm.runInContext('history.filter(m=>m.role==="user").length',p.context),1);
});
test('falha de rede conserva a cor já respondida e a próxima mensagem recebe o total',async()=>{
  let failColor=true,payload;
  const p=await page(async(url,options)=>{if(url==='/.netlify/functions/chat'){payload=JSON.parse(options.body);if(failColor&&payload.messages.at(-1).content==='Cores'){failColor=false;return new Response('Falha',{status:503})}const r=await chatHandler({httpMethod:'POST',body:options.body});return new Response(r.body,{status:r.statusCode})}return Response.json({ok:true})});await p.start();
  await say(p,'3 cópias A3 somente frente');await say(p,'Cores');assert.match(p.get('status').textContent,/Falha/);await say(p,'Qual o total?');assert.match(p.get('chat').children.at(-1).children[0].textContent,/Total: R\$ 9,00/);assert.equal(payload.messages.filter(m=>m.role==='user'&&m.content==='Cores').length,1);
});
test('anexo continua no histórico e no registro, sem ser interpretado como instrução de preço',async()=>{
  let form;
  const p=await page(async(url,options)=>{if(url==='/.netlify/functions/chat'){const r=await chatHandler({httpMethod:'POST',body:options.body});return new Response(r.body,{status:r.statusCode})}if(url==='/')form=options.body;return Response.json({ok:true})});await p.start();await say(p,'3 cópias A3 coloridas somente frente');
  p.get('fileInput').files=[new File(['PDF fictício'],'A4 preto e branco.pdf',{type:'application/pdf'})];await p.get('fileInput').trigger('change');await say(p,'Qual o total?');assert.match(p.get('chat').children.at(-1).children[0].textContent,/Total: R\$ 9,00/);
  assert.equal(vm.runInContext('history.find(m=>m.kind==="attachment").content',p.context),'O cliente selecionou uma arte/arquivo chamado A4 preto e branco.pdf.');await say(p,'Humano');assert.equal(form.get('arte').name,'A4 preto e branco.pdf');assert.match(form.get('resumo'),/A4 preto e branco.pdf/);
});

