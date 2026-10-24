import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{handler}=require('./netlify/functions/chat.js');
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const out='preview/orcamento-a3';fs.mkdirSync(out,{recursive:true});
const records={forms:[],notifications:[],chat:[],partial:[]},checks=[];
const originalFetch=globalThis.fetch,originalKey=process.env.OPENAI_API_KEY;let aiCallsSimulated=0;
process.env.OPENAI_API_KEY='browser-fixture-only';
globalThis.fetch=async(url)=>{assert.equal(url,'https://api.openai.com/v1/responses');aiCallsSimulated++;return Response.json({output_text:'Qual é o formato da impressão?'})};
const server=http.createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const b of req)chunks.push(b);const buffer=Buffer.concat(chunks),raw=buffer.toString('utf8');
    if(req.url==='/'&&req.method==='GET'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync('index.html'));}
    res.setHeader('Content-Type','application/json');
    if(req.url==='/.netlify/functions/chat'){records.chat.push(JSON.parse(raw));const r=await handler({httpMethod:'POST',body:raw});res.writeHead(r.statusCode,r.headers);return res.end(r.body);}
    if(req.url==='/.netlify/functions/partial-lead'){records.partial.push(JSON.parse(raw));return res.end(JSON.stringify({ok:true,ticket:'fixture-ticket'}));}
    if(req.url==='/'&&req.method==='POST'){const r=new Request('http://127.0.0.1/',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:buffer});records.forms.push(await r.formData());return res.end(JSON.stringify({ok:true}));}
    if(req.url==='/.netlify/functions/notify-idy-whatsapp'){records.notifications.push(JSON.parse(raw));return res.end(JSON.stringify({ok:true}));}
    res.statusCode=404;res.end(JSON.stringify({error:'Recurso não simulado'}));
  }catch(e){console.error(e);res.statusCode=500;res.end(JSON.stringify({error:'Falha no teste'}));}
});
await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});
const errors=[];
async function start(width){const context=await browser.newContext({viewport:{width,height:1000},deviceScaleFactor:1});await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1')return route.continue();if(u.hostname==='idygrafica.netlify.app'&&route.request().resourceType()==='image')return route.continue();return route.abort();});context.on('page',p=>{if(p.url().startsWith('https://wa.me'))void p.close();});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8765/');await page.locator('#clientName').fill('Cliente fictício');await page.locator('#clientEmail').fill('cliente@example.invalid');await page.locator('#clientPhone').fill('(51) 99999-0000');await page.locator('#startButton').click();await page.locator('#chatPanel').waitFor({state:'visible'});return {page,context};}
async function say(page,text,transfer=false){await page.locator('#message').fill(text);await page.locator('#send').click();if(transfer)await page.waitForFunction(()=>document.querySelector('#status').textContent==='Atendimento registrado e equipe avisada pelo WhatsApp.');else await page.waitForFunction(()=>document.querySelector('#status').textContent==='Pronto.');}
try{
 for(const width of [390,1440]){
  let early=await start(width);const earlyCalls=aiCallsSimulated;
  await say(early.page,'Colorida');await say(early.page,'A3');let earlyAnswer=await early.page.locator('.msg.bot').last().innerText();assert(!/colorida ou|preto e branco\?/.test(earlyAnswer));
  await say(early.page,'3, somente frente');earlyAnswer=await early.page.locator('.msg.bot').last().innerText();assert.match(earlyAnswer,/Total: R\$ 9,00/);assert.equal(aiCallsSimulated,earlyCalls+1);checks.push({width,scenario:'Cor informada antes do formato não é perguntada novamente'});await early.context.close();

  early=await start(width);await say(early.page,'3 cópias A3 somente frente');const beforeColor=records.chat.length;let releaseColor;const colorGate=new Promise(resolve=>releaseColor=resolve);
  await early.page.route('**/.netlify/functions/chat',async route=>{await colorGate;await route.continue()});await early.page.locator('#message').fill('Cores');
  await early.page.evaluate(()=>{document.querySelector('#send').click();document.querySelector('#message').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));document.querySelector('#send').click()});releaseColor();await early.page.waitForFunction(()=>document.querySelector('#status').textContent==='Pronto.');
  assert.equal(records.chat.length,beforeColor+1);assert.match(await early.page.locator('.msg.bot').last().innerText(),/Total: R\$ 9,00/);assert.equal(records.chat.at(-1).messages.filter(m=>m.role==='user'&&m.content==='Cores').length,1);checks.push({width,scenario:'Cores e clique/Enter concorrentes produzem um único orçamento'});await early.context.close();

  early=await start(width);await say(early.page,'3 cópias A3 coloridas somente frente');await early.page.locator('#fileInput').setInputFiles({name:'A4 preto e branco.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 ficticio')});await say(early.page,'Qual o total?');assert.match(await early.page.locator('.msg.bot').last().innerText(),/Total: R\$ 9,00/);assert(records.chat.at(-1).messages.some(m=>m.kind==='attachment'));checks.push({width,scenario:'Nome do arquivo não troca formato nem cor'});await early.context.close();

  let {page,context}=await start(width);const before=records.forms.length;
  await say(page,'Quanto custa uma cópia A3 colorida?');let answer=await page.locator('.msg.bot').last().innerText();assert.match(answer,/R\$ 3,00.*R\$ 6,00/);assert.match(answer,/Quantas folhas/);
  await say(page,'Quero 3, somente frente.');answer=await page.locator('.msg.bot').last().innerText();assert.match(answer,/Total: R\$ 9,00/);assert(!/Quantas|qual papel|retirada/i.test(answer));assert.equal(records.forms.length,before);assert(await page.locator('#humanContact').isVisible());
  await page.locator('#chatPanel').screenshot({path:out+'/tres-copias-'+width+'.png'});
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
  checks.push({width,scenario:'Preço em dois turnos',answer});await context.close();

  ({page,context}=await start(width));await say(page,'Quero 3 cópias A3 coloridas, somente frente.');await say(page,'Sim');
  answer=await page.locator('.msg.bot').last().innerText();assert.match(answer,/Anexe.*PDF.*clipe/);assert(!/R\$|\?/.test(answer));checks.push({width,scenario:'Confirmação de arquivo sem repetir orçamento'});await context.close();

  ({page,context}=await start(width));const humanPending=records.forms.length;
  await page.route('**/.netlify/functions/chat',()=>{});await page.locator('#message').fill('Preciso de ajuda');await page.locator('#send').click();await page.locator('#status').filter({hasText:'Respondendo'}).waitFor();
  await page.locator('#humanContact').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Atendimento registrado e equipe avisada pelo WhatsApp.');assert.equal(records.forms.length,humanPending+1);assert.match(records.forms.at(-1).get('resumo'),/Preciso de ajuda/);checks.push({width,scenario:'Humano interrompe resposta pendente'});await context.close();

  ({page,context}=await start(width));const formCount=records.forms.length,noticeCount=records.notifications.length;
  await say(page,'Quero 100 cópias A3 coloridas, frente e verso.');answer=await page.locator('.msg.bot').last().innerText();assert.match(answer,/R\$ 6,00 por folha.*Total: R\$ 600,00/);checks.push({width,scenario:'100 frente e verso',answer});
  await say(page,'Quanto fica em papel mais grosso?',true);assert.equal(records.forms.length,formCount+1);assert.equal(records.notifications.length,noticeCount+1);assert.match(records.forms.at(-1).get('resumo'),/Não há preço cadastrado/);assert.match(records.forms.at(-1).get('resumo'),/100 cópias/);checks.push({width,scenario:'Papel sem preço: transferência com histórico'});await context.close();

  ({page,context}=await start(width));const humanBefore=records.forms.length;
  await say(page,'Quero falar com um humano.',true);assert.equal(records.forms.length,humanBefore+1);assert.match(records.forms.at(-1).get('resumo'),/Quero falar com um humano/);assert.equal(records.forms.at(-1).get('whatsapp'),'(51) 99999-0000');checks.push({width,scenario:'Pedido humano direto sem confirmação'});await context.close();

  ({page,context}=await start(width));const buttonBefore=records.forms.length;
  await page.locator('#fileInput').setInputFiles({name:'arte-teste.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 arquivo ficticio')});
  await page.locator('#humanContact').click();await page.waitForFunction(()=>document.querySelector('#status').textContent==='Atendimento registrado e equipe avisada pelo WhatsApp.');assert.equal(records.forms.length,buttonBefore+1);assert.equal(records.forms.at(-1).get('arte').name,'arte-teste.pdf');assert.match(records.forms.at(-1).get('resumo'),/Quero falar com atendimento humano/);checks.push({width,scenario:'Botão humano conserva PDF e contato'});await context.close();
 }
 assert.deepEqual(errors,[]);
 const report={passed:checks.length,checks,javascriptErrors:errors,formsSimulated:records.forms.length,notificationsSimulated:records.notifications.length,aiCallsSimulated,realMessagesSent:0,realImagesGenerated:0};fs.writeFileSync(out+'/browser-report.json',JSON.stringify(report,null,2));console.log('BROWSER_VERIFIED',JSON.stringify(report));
}finally{await browser.close();server.close();globalThis.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
