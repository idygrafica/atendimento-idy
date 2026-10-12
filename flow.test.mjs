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
async function page(fetchImpl=async()=>Response.json({answer:'Resposta de teste'}),{mockPartial=true,sessionStorage}={}){
  const html=await readFile(new URL('index.html',import.meta.url),'utf8'),elements=new Map();
  for(const match of html.matchAll(/<[^>]+id="([^"]+)"[^>]*>/g)){
    const el=new Element();el.hidden=/\bhidden\b/.test(match[0]);el.disabled=/\bdisabled\b/.test(match[0]);elements.set(match[1],el);
  }
  const get=id=>{assert(elements.has(id),'Elemento '+id);return elements.get(id)};
  const wrappedFetch=(url,options)=>mockPartial&&url==='/.netlify/functions/partial-lead'?Promise.resolve(Response.json({ok:true,ticket:'mock-ticket'})):fetchImpl(url,options);
  const context=vm.createContext({document:{getElementById:get,createElement:()=>new Element()},fetch:wrappedFetch,FormData,File,Uint8Array,atob,AbortSignal,URL,crypto:webcrypto,console,encodeURIComponent,sessionStorage,setTimeout:fn=>fn(),alert:message=>{throw Error(message)}});
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
  assert.match(p.get('chat').children.at(-1).children[0].textContent,/Precisa de mais alguma coisa/);
  assert(!p.html.includes('id="lead"'));assert(!p.html.includes('id="leadDialog"'));
  await say(p,'Não, pode encaminhar.');assert.deepEqual(calls.map(c=>c.url),['/','/.netlify/functions/notify-idy-whatsapp']);
  await say(p,'Pode encaminhar');assert.equal(calls.length,2);
});
test('recusa e perguntas adicionais continuam na IA sem disparar registro',async()=>{
  for(const text of ['Não pode enviar','Não envie ainda','Ainda não','Sim, preciso mudar a quantidade','Pode enviar? Antes preciso saber o preço']){
    const calls=[];const p=await page(async url=>{calls.push(url);return Response.json({answer:'Vamos continuar'})});await p.start();await attach(p);await say(p,text);assert.deepEqual(calls,['/.netlify/functions/chat'],text);
  }
});
test('não sozinho só finaliza após a pergunta de encaminhamento',async()=>{
  const calls=[];const p=await page(async url=>{calls.push(url);return Response.json({answer:'Resposta',ok:true})});await p.start();await say(p,'Não');assert.deepEqual(calls,['/.netlify/functions/chat']);await attach(p);await say(p,'Não');assert.deepEqual(calls,['/.netlify/functions/chat','/','/.netlify/functions/notify-idy-whatsapp']);
});
test('um arquivo selecionado durante a resposta oferece encaminhamento depois dela',async()=>{
  let release;const wait=new Promise(resolve=>release=resolve);const p=await page(async()=>{await wait;return Response.json({answer:'Resposta'})});await p.start();p.get('message').value='Meu pedido';const pending=p.get('send').trigger('click');await attach(p);assert(!p.get('chat').children.at(-1).children[0]);release();await pending;assert.match(p.get('chat').children.at(-1).children[0].textContent,/Precisa de mais alguma coisa/);
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

test('pedido de segunda geração oferece humano e não chama novamente a API nem remove a primeira prévia',async()=>{
  let generations=0;const p=await page(async(url,options={})=>{
    if(url==='/.netlify/functions/artwork'){if(options.method==='POST')generations++;return Response.json(options.method==='POST'?{ok:true,ticket:'test-ticket'}:options.method==='DELETE'?{ok:true}:{ok:true,status:'completed',image:sampleImage,notification:{state:'accepted'}});}
    return Response.json({ok:true});
  });await p.start();await say(p,'Crie uma arte moderna para meu cartão.');assert.equal(generations,1);assert.equal(p.get('createArtwork').disabled,true);assert.match(p.get('artworkNotice').textContent,/encaminhada/);
  await say(p,'Crie uma nova arte com outras cores.');assert.equal(generations,1);assert.match(p.get('chat').children.at(-1).children[0].textContent,/já foi utilizada/);assert.match(p.get('chat').children.at(-1).children[1].href,/wa.me\/5551981687562/);assert.equal(p.get('send').disabled,false);
  await attach(p);await say(p,'Crie uma nova arte com este outro arquivo.');assert.equal(generations,1);
});
test('bloqueio do servidor também mostra humano quando o navegador ainda não sabe que a prévia foi utilizada',async()=>{
  const p=await page(async()=>Response.json({ok:false,errorCode:'ARTWORK_ALREADY_USED'},{status:409}));await p.start();await say(p,'Crie uma arte para meu cartão.');assert.match(p.get('chat').children.at(-1).children[0].textContent,/já foi utilizada/);assert.equal(p.get('send').disabled,false);assert.equal(p.get('createArtwork').disabled,true);
});
test('botão humano aparece acima do compositor, aponta para o responsável e não troca o botão Enviar',async()=>{
  const p=await page();const tag=p.html.match(/<a id="humanContact"[^>]+>/)[0],href=tag.match(/href="([^"]+)"/)[1],url=new URL(href);
  assert.equal(url.hostname,'wa.me');assert.equal(url.pathname,'/5551981687562');assert.equal(url.searchParams.get('text'),'Olá! Vim pelo Atendimento com IA da IDY Gráfica e gostaria de falar com um atendente.');assert.match(tag,/target="_blank"/);assert.match(tag,/rel="noopener noreferrer"/);assert(p.html.indexOf('id="humanContact"')<p.html.indexOf('<div class="composer">'));assert(p.html.includes('Falar com atendimento humano'));assert(p.html.includes('id="send"'));
});
test('prévia continua disponível quando o aviso WhatsApp depende de configuração',async()=>{
  const p=await page(async(url,options={})=>Response.json(options.method==='POST'?{ok:true,ticket:'test-ticket'}:options.method==='DELETE'?{ok:true}:{ok:true,status:'completed',image:sampleImage,notification:{state:'configuration_required'}}));await p.start();await say(p,'Crie uma arte moderna para meu cartão.');assert.match(p.get('status').textContent,/Prévia pronta/);assert.match(p.get('artworkNotice').textContent,/pendente/);assert.equal(p.get('send').disabled,false);
});
test('recarregar a página retoma o mesmo atendimento e não libera uma segunda prévia',async()=>{
  const values=new Map(),sessionStorage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};let generations=0,starts=0;
  const fetcher=async(url,options={})=>{
    if(url==='/.netlify/functions/partial-lead'){
      const body=JSON.parse(options.body);if(body.action==='start')starts++;
      return Response.json(body.action==='restore'?{ok:true,previewUsed:true,sequence:10,history:[{role:'user',content:'Quero 500 cartões.'}]}:{ok:true,ticket:'saved-ticket'});
    }
    if(url==='/.netlify/functions/artwork'){if(options.method==='POST')generations++;return Response.json(options.method==='POST'?{ok:true,ticket:'test-ticket'}:options.method==='DELETE'?{ok:true}:{ok:true,status:'completed',image:sampleImage,notification:{state:'accepted'}});}
    return Response.json({ok:true,answer:'Vamos continuar.'});
  };
  const a=await page(fetcher,{mockPartial:false,sessionStorage});await a.start();await say(a,'Crie uma arte para os meus cartões.');await a.flush();
  const b=await page(fetcher,{mockPartial:false,sessionStorage});await b.start();await say(b,'Crie outra arte para meu cartão.');assert.equal(starts,1);assert.equal(generations,1);assert.match(b.get('chat').children.at(-1).children[0].textContent,/já foi utilizada/);assert.equal(b.get('send').disabled,false);
});
