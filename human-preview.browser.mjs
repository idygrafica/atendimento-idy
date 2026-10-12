import {chromium} from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {MemoryStore} from './test-store.mjs';
import {createPartialLeadHandler} from './lib/partial-leads.mjs';
import {createArtworkHandler} from './lib/artwork.mjs';
const imageResponse=await fetch('https://idygrafica.netlify.app/assets/logo-idy-grafica.png');assert(imageResponse.ok);
const image=Buffer.from(await imageResponse.arrayBuffer()),html=fs.readFileSync('index.html','utf8');
const env={OPENAI_API_KEY:'mock-openai',WHATSAPP_ACCESS_TOKEN:'mock-meta',WHATSAPP_PHONE_NUMBER_ID:'123456',WHATSAPP_ARTWORK_TEMPLATE_NAME:'idy_previa_arte_responsavel',IDY_ARTWORK_PER_IP_LIMIT:'10'};
const attendance=new MemoryStore(),quota=new MemoryStore(),notifications=new MemoryStore();
let generations=0,ownerMessages=0,forms=0;
const artwork=createArtworkHandler({env,storeFactory:async()=>quota,attendanceStoreFactory:async()=>attendance,notificationStoreFactory:async()=>notifications,
 fetchImpl:async(url,options)=>Response.json(options.method==='POST'?{id:'resp_job'+(++generations)}:options.method==='DELETE'?{deleted:true}:{status:'completed',output:[{type:'image_generation_call',result:image.toString('base64')}]}),
 whatsappFetchImpl:async(url,options)=>{
  if(url.endsWith('/media')){assert.equal(options.body.get('file').type,'image/png');return Response.json({id:'123123'});}
  const msg=JSON.parse(options.body);assert.equal(msg.to,'5551981687562');assert.equal(msg.template.components[0].parameters[0].image.id,'123123');
  const values=msg.template.components[1].parameters.map(p=>p.text);assert.equal(values[2],'Cartões de visita');assert.equal(values[3],'500');assert.equal(values[4],'R$ 85,00');ownerMessages++;return Response.json({messages:[{id:'wamid.mock'+ownerMessages}]});
 }});
const partial=createPartialLeadHandler({env,storeFactory:async()=>attendance});
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  const chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request('http://127.0.0.1:8787'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
  let response;
  if(req.url.startsWith('/.netlify/functions/artwork'))response=await artwork(request,{ip:'browser-test'});
  else if(req.url==='/.netlify/functions/partial-lead')response=await partial(request,{ip:'browser-test'});
  else if(req.url==='/.netlify/functions/chat')response=Response.json({answer:'500 cartões de visita, frente e verso. Valor total: R$ 85,00. A equipe fará a conferência antes de imprimir.'});
  else if(req.url==='/'&&req.method==='POST'){forms++;response=new Response('Registro simulado');}
  else response=Response.json({ok:true,status:'mock',hasKey:true});
  res.statusCode=response.status;for(const[key,value]of response.headers)res.setHeader(key,value);res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(e);res.statusCode=500;res.end('Falha no teste');}
});
await new Promise(resolve=>server.listen(8787,'127.0.0.1',resolve));
const browser=await chromium.launch();fs.mkdirSync('preview',{recursive:true});
try{
 for(const width of [320,390,780,1024,1280]){
  const context=await browser.newContext({viewport:{width,height:900}});await context.route('https://wa.me/**',route=>route.fulfill({status:200,contentType:'text/html',body:'WhatsApp de teste: nenhuma mensagem real enviada'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8787/');
  await page.evaluate(()=>Promise.all([...document.images].map(e=>e.decode())));
  const start=async()=>{await page.locator('#clientName').fill('Cliente fictício');await page.locator('#clientEmail').fill('cliente@example.invalid');await page.locator('#clientPhone').fill('(51) 99999-0000');await page.locator('#startButton').click();await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('Conversa salva'));};
  await start();
  const initialGeneration=generations,initialOwnerMessages=ownerMessages;
  const popupPromise=context.waitForEvent('page');await page.locator('#humanContact').click();const popup=await popupPromise;await popup.waitForLoadState();
  const destination=new URL(popup.url());assert.equal(destination.hostname,'wa.me');assert.equal(destination.pathname,'/5551981687562');assert.equal(destination.searchParams.get('text'),'Olá! Vim pelo Atendimento com IA da IDY Gráfica e gostaria de falar com um atendente.');await popup.close();
  assert.equal(generations,initialGeneration);assert.equal(ownerMessages,initialOwnerMessages);assert.equal(forms,0);assert.equal(await page.locator('#send').isEnabled(),true);
  await page.locator('#message').fill('Quero 500 cartões de visita');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Pronto.');
  await page.locator('#fileInput').setInputFiles({name:'arte-original.png',mimeType:'image/png',buffer:image});
  await page.locator('#message').fill('Melhore minha arte: preserve os textos e deixe as cores mais vivas.');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Prévia pronta para conferir.');
  await page.locator('img[alt="Proposta visual criada para aprovação"]').evaluate(e=>e.decode());
  assert.equal(generations,initialGeneration+1);assert.equal(ownerMessages,initialOwnerMessages+1);assert.equal(await page.locator('#send').isEnabled(),true);assert.equal(forms,0);
  const layout=await page.evaluate(()=>{
   const human=document.querySelector('#humanContact').getBoundingClientRect(),composer=document.querySelector('.composer').getBoundingClientRect();
   return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,humanHeight:human.height,humanAboveComposer:human.bottom<=composer.top,humanInsideWidth:human.left>=0&&human.right<=innerWidth,originalAndPreview:[...document.querySelectorAll('.art-preview')].length===2,logoOriginal:document.querySelector('.logo img').src.endsWith('logo-idy-grafica.png'),humanLabel:document.querySelector('#humanContact').textContent,sendStillPresent:!!document.querySelector('#send')};
  });assert.equal(layout.width,layout.scrollWidth);assert(layout.humanHeight>=44&&layout.humanAboveComposer&&layout.humanInsideWidth&&layout.originalAndPreview&&layout.logoOriginal&&layout.sendStillPresent);
  assert.equal(layout.humanLabel,'Falar com atendimento humano');
  if(width===390||width===1280){await page.screenshot({path:'preview/atendimento-humano-'+width+'.jpg',type:'jpeg',quality:75,fullPage:true});}
  await page.locator('#message').fill('Crie uma nova arte com outras cores');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('já foi utilizada'));assert.equal(generations,initialGeneration+1);assert.equal(ownerMessages,initialOwnerMessages+1);
  await page.reload();await start();await page.locator('#message').fill('Crie outra arte para meu cartão');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('já foi utilizada'));assert.equal(generations,initialGeneration+1);assert.equal(ownerMessages,initialOwnerMessages+1);
  await page.locator('#message').fill('Quero tirar mais uma dúvida');await page.locator('#send').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Pronto.');assert.equal(errors.length,0);
  console.log('HUMAN_BUTTON_BROWSER_VERIFIED '+JSON.stringify({...layout,whatsappPopupAndPrefilledTextVerified:true,onePreviewAndNotification:true,reloadDoesNotResetAllowance:true,aiStillWorks:true}));
  await context.close();
 }
 console.log('HUMAN_PREVIEW_BROWSER_COMPLETED_NO_REAL_MESSAGES');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}

