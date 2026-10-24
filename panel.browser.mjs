import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {installFixture,panel,creative,conversations} from './backend-test-fixtures.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const fixture=installFixture(),checks=[],errors=[],providerCalls=[];
globalThis.fetch=async(url,options)=>{providerCalls.push(new URL(url).hostname);return Response.json(url.includes('/images/')?{data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCYUAAAAASUVORK5CYII='}]}:{messages:[{id:'fixture'}]})};
let failNextMode=false,failNextList=false;
const phone='5551999990000',out='preview/orcamento-a3';fs.mkdirSync(out,{recursive:true});
const server=http.createServer(async(req,res)=>{
 try{
  if(req.url==='/painel.html'){res.setHeader('Content-Type','text/html');return res.end(fs.readFileSync('painel.html'));}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
  const request=new Request('http://127.0.0.1:8766'+req.url,{method:req.method,headers:req.headers,body:req.method==='POST'?raw:undefined});
  let response;
  if(req.url.startsWith('/.netlify/functions/panel-api')){
   if((failNextMode&&raw.includes('set_mode'))||(failNextList&&req.method==='GET')){failNextMode=false;failNextList=false;response=Response.json({error:'Falha simulada'},{status:503});}
   else response=await panel(request);
  }else if(req.url==='/.netlify/functions/creative-preview'){
   const r=await creative({httpMethod:req.method,headers:req.headers,body:raw});response=new Response(r.body,{status:r.statusCode,headers:r.headers});
  }else response=new Response('',{status:404});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500);res.end('Falha no teste');}
});
await new Promise(resolve=>server.listen(8766,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
try{
 for(const width of [390,1440]){
  await conversations.saveConversation({phone,name:'Cliente fictício',mode:'ai',messages:[{role:'user',text:'Preciso de três A3 coloridas, tenho o arquivo.',at:new Date().toISOString()}]});
  const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8766/painel.html');
  assert.equal(await page.locator('#app').isVisible(),false);
  await page.locator('#accessKey').fill('invalid');await page.locator('#loginBtn').click();await page.locator('#loginMsg').filter({hasText:'não autorizado'}).waitFor();assert.equal(await page.locator('#app').isVisible(),false);
  await page.locator('#accessKey').fill(fixture.key);await page.locator('#loginBtn').click();await page.locator('#app').waitFor({state:'visible'});
  await page.locator('.conv').click();await page.locator('#messages').filter({hasText:'três A3'}).waitFor();assert.match(await page.locator('#brief').inputValue(),/tenho o arquivo/);
  failNextMode=true;await page.locator('#modeBtn').click();await page.locator('#panelStatus').filter({hasText:'Não foi possível mudar'}).waitFor();assert.equal((await conversations.getConversation(phone)).mode,'ai');
  await page.locator('#modeBtn').click();await page.locator('#modeBtn').filter({hasText:'Devolver para IA'}).waitFor();assert.equal((await conversations.getConversation(phone)).mode,'human');
  await page.locator('#manualText').fill('Vou conferir o PDF.');await page.locator('#sendManual').click();await page.locator('#messages').filter({hasText:'Vou conferir o PDF.'}).waitFor();assert.equal((await conversations.getConversation(phone)).messages.at(-1).role,'human');
  await page.locator('#generate').click();await page.locator('#preview img').waitFor();
  failNextList=true;await page.locator('#refreshBtn').click();await page.locator('#panelStatus').filter({hasText:'Não foi possível atualizar'}).waitFor();
  await page.locator('#refreshBtn').click();await page.locator('#panelStatus').filter({hasText:'Conversas atualizadas'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:out+'/painel-'+width+'.png',fullPage:true});
  checks.push({width,loginProtected:true,history:true,humanMode:true,manualReplySimulated:true,creativePreviewSimulated:true,failuresRecover:true});await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(providerCalls.length,4);
 fs.writeFileSync(out+'/panel-report.json',JSON.stringify({passed:checks.length,checks,javascriptErrors:errors,providerCallsSimulated:providerCalls.length,realMessagesSent:0,realImagesGenerated:0},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));fixture.restore();}
