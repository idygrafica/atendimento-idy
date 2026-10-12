import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const token=process.env.NETLIFY_AUTH_TOKEN,siteId=process.env.NETLIFY_SITE_ID;
assert(token&&siteId,'Credenciais Netlify indisponíveis');
const expectedPrevious='6acc2e92f81ab2e931093ff0',base='https://atendimento-idy.netlify.app/';
async function api(path,method='GET',body,contentType='application/json'){
 const r=await fetch('https://api.netlify.com/api/v1'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':contentType},body:body===undefined?undefined:(contentType==='application/json'?JSON.stringify(body):body),signal:AbortSignal.timeout(30000)});
 if(!r.ok){let message='';try{const e=await r.json();message=String(e.message||e.error||'').replaceAll(token,'[redacted]').slice(0,350)}catch{}throw new Error('Netlify '+method+' HTTP '+r.status+' '+message)}return r.json();
}
const site=await api('/sites/'+siteId);assert.equal(site.name,'atendimento-idy');assert.equal(site.id,siteId);assert.equal(site.published_deploy.id,expectedPrevious,'Outra publicação ocorreu; não sobrescrever');
const previous=await api('/deploys/'+expectedPrevious);assert.equal(previous.state,'ready');assert(!previous.edge_functions_present,'Preservação de edge functions precisa de leitura adicional');
const oldFunctions=previous.available_functions;assert(Array.isArray(oldFunctions)&&oldFunctions.length===7,'Funções atuais não identificadas');
const oldFiles=await api('/sites/'+siteId+'/files'),files={},functions={},configs={};
for(const file of oldFiles){const path=file.path.startsWith('/')?file.path.slice(1):file.path;assert(file.sha);files[path]=file.sha;}
assert(files['index.html']);
for(const fn of oldFunctions){
 assert(fn.n&&fn.d);functions[fn.n]=fn.d;
 configs[fn.n]={build_data:fn.bd||{}};
 if(fn.dn)configs[fn.n].display_name=fn.dn;
 if(fn.g)configs[fn.n].generator=fn.g;
 if(fn.c&&typeof fn.c==='object')Object.assign(configs[fn.n],fn.c);
}
const live=await (await fetch(base+'?before='+Date.now())).text();
const original=await (await fetch('https://raw.githubusercontent.com/idygrafica/atendimento-idy/e6dfd57d844d74d3d9f2bd734dd1f4ad750c174c/index.html')).text();
const scripts=s=>s.split('<script>').slice(1).map(x=>x.split('</script>')[0].trim());
assert.deepEqual(scripts(live),scripts(original),'Código publicado mudou antes da atualização');
const html=fs.readFileSync('index.html','utf8'),sha=createHash('sha1').update(html).digest('hex');files['index.html']=sha;
fs.mkdirSync('.netlify',{recursive:true});const report={site:'atendimento-idy',previousDeploy:expectedPrevious,previousUrl:'https://'+expectedPrevious+'--atendimento-idy.netlify.app',sourceCommit:process.env.GITHUB_SHA,state:'preparing',functions:oldFunctions.map(f=>({name:f.n,digest:f.d})),unchangedFiles:oldFiles.length-1};
fs.writeFileSync('.netlify/page-publication.json',JSON.stringify(report,null,2));
const healthBefore=await fetch(base+'.netlify/functions/health');const healthStatus=healthBefore.status;const previousHealth=await healthBefore.json().catch(()=>({}));

const download=await api('/deploys/6ac2d52dce190d84abeb3ac1/download');
const zipResponse=await fetch(download.url,{signal:AbortSignal.timeout(30000)});assert(zipResponse.ok);
fs.writeFileSync('.netlify/source.zip',Buffer.from(await zipResponse.arrayBuffer()));
execFileSync('python3',['-c',String.raw`import zipfile,pathlib
root=pathlib.Path('.netlify/current-source').resolve()
root.mkdir(parents=True,exist_ok=True)
z=zipfile.ZipFile('.netlify/source.zip')
for entry in z.infolist():
 target=(root/entry.filename).resolve()
 if not target.is_relative_to(root): raise RuntimeError('Caminho inválido no arquivo original')
z.extractall(root)
`],{stdio:'inherit'});
const sourceRoot=fs.realpathSync('.netlify/current-source');
const findSource=path=>{const parts=path.split('/').filter(Boolean);let dir=sourceRoot;for(const part of parts){const name=fs.readdirSync(dir).find(n=>n.toLowerCase()===part.toLowerCase());assert(name,'Arquivo original ausente '+part);dir=dir+'/'+name;}return dir;};
for(const f of oldFiles){if(f.path.toLowerCase()==='/index.html')continue;const source=findSource(f.path);assert.equal(createHash('sha1').update(fs.readFileSync(source)).digest('hex'),f.sha,'Código original deve coincidir com o deploy');}
for(const path of ['lib/artwork.mjs','lib/partial-leads.mjs','netlify/functions/artwork.mjs','netlify/functions/partial-lead.mjs','netlify/functions/idle-leads.mjs']){fs.mkdirSync(sourceRoot+'/'+path.split('/').slice(0,-1).join('/'),{recursive:true});fs.copyFileSync(path,sourceRoot+'/'+path);}
const newNames=['artwork','partial-lead','idle-leads'];
for(const name of newNames)configs[name]={build_data:{bootstrapVersion:'2.18.0',runtimeAPIVersion:2}};
const schedules=[...(previous.function_schedules||[]),{name:'idle-leads',cron:'* * * * *'}];
const pkg=JSON.parse(fs.readFileSync(sourceRoot+'/package.json','utf8'));
console.log('ORIGINAL_FUNCTION_SOURCES_PRESERVED '+JSON.stringify({count:oldFunctions.length,dependencies:pkg.dependencies}));
execFileSync('npm',['install','--ignore-scripts','--no-package-lock','--no-audit','--no-fund'],{cwd:sourceRoot,stdio:'inherit'});
fs.mkdirSync('.netlify/tooling',{recursive:true});fs.writeFileSync('.netlify/tooling/package.json',JSON.stringify({name:'idy-existing-runtime-tooling',private:true,dependencies:{'@netlify/zip-it-and-ship-it':'16.3.0'},overrides:{'@netlify/serverless-functions-api':'2.18.0'}}));
execFileSync('npm',['install','--prefix','.netlify/tooling','--ignore-scripts','--no-package-lock','--no-audit','--no-fund'],{stdio:'inherit'});
const require=createRequire(process.cwd()+'/.netlify/tooling/package.json');
const {zipFunctions}=require('@netlify/zip-it-and-ship-it');
fs.mkdirSync('.netlify/bundles',{recursive:true});
const compileConfig=Object.fromEntries(oldFunctions.map(f=>[f.n,{nodeVersion:'24',nodeBundler:f.bd?.runtimeAPIVersion===2?'nft':'esbuild'}]));
for(const name of newNames)compileConfig[name]={nodeVersion:'24',nodeBundler:'nft'};
const bundles=await zipFunctions(sourceRoot+'/netlify/functions',process.cwd()+'/.netlify/bundles',{config:compileConfig,archiveFormat:'zip'});
assert.equal(bundles.length,oldFunctions.length+newNames.length);
const uploads=new Map();
for(const bundle of bundles){
 const fn=oldFunctions.find(f=>f.n===bundle.name)||{n:bundle.name,r:'nodejs24.x',bd:{bootstrapVersion:'2.18.0',runtimeAPIVersion:2}};assert(oldFunctions.some(f=>f.n===fn.n)||newNames.includes(fn.n));
 if(bundle.invocationMode==='stream'){
 execFileSync('python3',['-c',String.raw`import zipfile,sys,json
with zipfile.ZipFile(sys.argv[1],'a') as z:
 info=zipfile.ZipInfo('.idy-native-runtime.json',(2020,1,1,0,0,0))
 info.compress_type=zipfile.ZIP_DEFLATED
 z.writestr(info,json.dumps({'runtimeAPIVersion':2,'invocationMode':'stream'}))
`,bundle.path],{stdio:'inherit'});
 }
 const bytes=fs.readFileSync(bundle.path),digest=createHash('sha256').update(bytes).digest('hex');
 functions[fn.n]=digest;uploads.set(digest,{name:fn.n,bytes,runtime:fn.r,invocationMode:bundle.invocationMode});
 console.log('BUNDLE_RUNTIME '+JSON.stringify({name:fn.n,invocationMode:bundle.invocationMode}));
 configs[fn.n].build_data={...fn.bd,bootstrapVersion:bundle.bootstrapVersion||fn.bd?.bootstrapVersion,runtimeAPIVersion:bundle.runtimeAPIVersion||fn.bd?.runtimeAPIVersion};
 assert.equal(configs[fn.n].build_data.runtimeAPIVersion,fn.bd.runtimeAPIVersion);
}


async function createDeploy(draftMode,manifest){
 const deploy=await api('/sites/'+siteId+'/deploys','POST',{draft:draftMode,files:manifest,functions,functions_config:configs,function_schedules:schedules,...(draftMode?{branch:'codex/tela-inicial-atendimento'}:{})});
 console.log('DEPLOY_CREATED '+JSON.stringify({id:deploy.id,draft:draftMode,requiredFiles:deploy.required,requiredFunctionCount:deploy.required_functions?.length||0}));
 for(const digest of deploy.required_functions||[]){
  const upload=uploads.get(digest);assert(upload,'Pacote desconhecido');
  await api('/deploys/'+deploy.id+'/functions/'+upload.name+'?runtime='+encodeURIComponent(upload.runtime)+(upload.invocationMode?'&invocation_mode='+encodeURIComponent(upload.invocationMode):''),'PUT',upload.bytes,'application/octet-stream');
 }
 assert((deploy.required||[]).every(d=>d===sha),'Arquivo desconhecido precisaria mudar');
 if(deploy.required?.includes(sha))await api('/deploys/'+deploy.id+'/files/index.html','PUT',html,'application/octet-stream');
 for(let attempt=0;attempt<60;attempt++){
  const current=await api('/deploys/'+deploy.id);if(current.state==='ready')return current;assert.notEqual(current.state,'error','Netlify recusou a publicação');await new Promise(r=>setTimeout(r,2000));
 }throw Error('Netlify ainda não confirmou o deploy');
}
const behavior=f=>({name:f.n,runtime:f.r,region:f.rg,build:f.bd,display:f.dn,generator:f.g,memory:f.m});
const sorted=arr=>arr.filter(f=>!newNames.includes(f.n)).map(behavior).sort((a,b)=>a.name.localeCompare(b.name));
function checkFunctions(deploy){
 assert.equal(deploy.available_functions.length,10);
 assert.deepEqual(sorted(deploy.available_functions),sorted(oldFunctions),'Características das funções existentes mudaram');
 assert((deploy.function_schedules||[]).some(f=>f.name==='idle-leads'&&f.cron==='* * * * *'),'Agendamento não confirmado');
}
async function waitPublished(id,expectedHtml){
 for(let attempt=0;attempt<40;attempt++){
  const site=await api('/sites/'+siteId),response=await fetch(base+'?published='+Date.now()),body=await response.text();
  if(site.published_deploy.id===id&&response.ok&&JSON.stringify(scripts(body))===JSON.stringify(scripts(expectedHtml)))return;
  await new Promise(r=>setTimeout(r,2000));
 }throw Error('Publicação ainda não confirmada no endereço público');
}
async function imageTest(mode,image){
 const response=await fetch(base+'.netlify/functions/artwork',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify({mode,brief:mode==='create'?'Crie uma arte conceitual de cartão de visita horizontal para uma empresa fictícia chamada EXEMPLO, com fundo verde e branco, sem telefone nem e-mail. Apenas uma proposta para teste.':'Melhore esta arte de cartão: preserve EXEMPLO e acrescente um detalhe discreto verde, sem novos textos ou contatos.',image}),signal:AbortSignal.timeout(35000)});
 const data=await response.json().catch(()=>({}));assert(response.ok&&data.ok&&data.ticket,'Criação real '+mode+' falhou HTTP '+response.status+' '+String(data.error||'Resposta inválida').slice(0,200));
 let result;
 for(let attempt=0;attempt<80;attempt++){
  await new Promise(r=>setTimeout(r,2500));const poll=await fetch(base+'.netlify/functions/artwork',{headers:{Authorization:'Bearer '+data.ticket},signal:AbortSignal.timeout(30000)}),value=await poll.json().catch(()=>({}));
  assert(poll.ok&&value.ok,'Consulta de arte '+mode+' falhou HTTP '+poll.status+' '+String(value.error||'').slice(0,200));
  if(value.status==='completed'){result=value.image;break;}
 }
 assert(typeof result==='string'&&/^data:image\/(jpeg|png);base64,/.test(result),'Arte real não retornou uma imagem');
 const bytes=Buffer.from(result.split(',')[1],'base64');assert(bytes.length>1000,'Imagem gerada incompleta');
 await fetch(base+'.netlify/functions/artwork',{method:'DELETE',headers:{Authorization:'Bearer '+data.ticket}});
 console.log('REAL_IMAGE_VERIFIED '+JSON.stringify({mode,bytes:bytes.length}));return result;
}
const draft=await createDeploy(true,files);checkFunctions(draft);
report.draftDeploy=draft.id;fs.writeFileSync('.netlify/page-publication.json',JSON.stringify(report,null,2));
const draftUrl='https://'+draft.id+'--atendimento-idy.netlify.app/';
const draftHtml=await (await fetch(draftUrl+'?check='+Date.now())).text();assert.deepEqual(scripts(draftHtml),scripts(html));
const nativeResponse=await fetch(draftUrl+'.netlify/functions/artwork');assert([403,503].includes(nativeResponse.status),'Função nativa não abriu na prévia');
const latest=await api('/sites/'+siteId);assert.equal(latest.published_deploy.id,expectedPrevious,'Outra publicação ocorreu; não sobrescrever');
// Validate protected production credentials behind the existing page before exposing the new controls.
const existingIndex=oldFiles.find(f=>f.path.toLowerCase()==='/index.html').sha;
const backendFiles={...files,'index.html':existingIndex};
let backend;
try{
 backend=await createDeploy(false,backendFiles);report.backendDeploy=backend.id;
 await waitPublished(backend.id,original);checkFunctions(backend);
 console.log('BACKEND_READY_EXISTING_PAGE_PRESERVED '+JSON.stringify({id:backend.id}));
 const keyCheck=await (await fetch(base+'.netlify/functions/health')).json();assert.equal(keyCheck.hasKey,previousHealth.hasKey,'Configuração da IA mudou');
 const liveArtwork=await fetch(base+'.netlify/functions/artwork');assert.equal(liveArtwork.status,403,'Criação não ficou configurada em produção');
 const generated=await imageTest('create');await imageTest('edit',generated);report.realImageCreationAndEditingVerified=true;
 const startResponse=await fetch(base+'.netlify/functions/partial-lead',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json'},body:JSON.stringify({action:'start',startId:crypto.randomUUID(),contact:{nome:'Teste técnico sem envio',email:'teste@example.invalid',whatsapp:'(51) 99999-0000'}})});
 const startData=await startResponse.json().catch(()=>({}));assert(startResponse.ok&&startData.ticket,'Salvamento em Blobs falhou HTTP '+startResponse.status);
 let finished=false;
 for(let attempt=0;attempt<3;attempt++){
  const r=await fetch(base+'.netlify/functions/partial-lead',{method:'POST',headers:{Origin:new URL(base).origin,'Content-Type':'application/json',Authorization:'Bearer '+startData.ticket},body:JSON.stringify({action:'complete'})});
  if(r.ok){finished=true;break;}
 }assert(finished,'Teste técnico não pôde ser concluído para evitar aviso');
 report.productionRuntimeAndPartialStorageVerified=true;
 const current=await api('/sites/'+siteId);assert.equal(current.published_deploy.id,backend.id,'Outra publicação ocorreu durante os testes; não sobrescrever');
 const production=await createDeploy(false,files);await waitPublished(production.id,html);checkFunctions(production);
 assert.equal((await fetch(base+'.netlify/functions/health')).status,healthStatus);
 const finalHealth=await (await fetch(base+'.netlify/functions/health')).json();assert.equal(finalHealth.hasKey,previousHealth.hasKey);
 report.state='published';report.publishedDeploy=production.id;report.publicUrl=base;report.existingFunctionSourceCodeUnchanged=true;report.functionsRepackaged=true;report.idleCron='* * * * *';report.idleThresholdMinutes=10;
 fs.writeFileSync('.netlify/page-publication.json',JSON.stringify(report,null,2));
 console.log('PAGE_PUBLICATION_CONFIRMED '+JSON.stringify(report));
}catch(error){
 if(backend){
  const current=await api('/sites/'+siteId);
  if(current.published_deploy.id===backend.id){
   await api('/sites/'+siteId+'/deploys/'+expectedPrevious+'/restore','POST');await waitPublished(expectedPrevious,original);report.state='rolled-back';
  }else report.state='external-publication-detected';
 }else report.state='failed-before-production';
 report.publicationError=String(error.message).slice(0,250);fs.writeFileSync('.netlify/page-publication.json',JSON.stringify(report,null,2));console.log('PUBLICATION_STOPPED '+JSON.stringify(report));throw error;
}
