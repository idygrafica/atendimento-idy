import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(process.cwd()+'/.quote-tooling/package.json');
const {zipFunctions}=require('@netlify/zip-it-and-ship-it');
const manifest=JSON.parse(fs.readFileSync('config/published-backend.json'));
const legacy=['chat','creative-preview','health','notify-idy-whatsapp'];
const config={'*':{nodeVersion:'24',nodeBundler:'nft'},...Object.fromEntries(legacy.map(name=>[name,{nodeVersion:'24',nodeBundler:'esbuild'}]))};
const bundles=await zipFunctions('netlify/functions',path.resolve('.quote-bundles'),{config,archiveFormat:'zip'});
assert.deepEqual(bundles.map(b=>b.name).sort(),[...manifest.knownFunctionNames].sort(),'O pacote deve preservar todas as dez funções conhecidas');
for(const name of legacy)assert.equal(bundles.find(b=>b.name===name).runtimeAPIVersion,1,name);
for(const name of ['artwork','partial-lead','idle-leads','panel-api','whatsapp-webhook'])assert.equal(bundles.find(b=>b.name===name).runtimeAPIVersion,2,name);
const chat=bundles.find(b=>b.name==='chat');
const directories=[];
function extract(bundle){const root=fs.mkdtempSync(path.join(os.tmpdir(),'idy-bundle-'+bundle.name+'-'));directories.push(root);execFileSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',bundle.path,root]);return root;}
function sourceFiles(root){return fs.readdirSync(root,{withFileTypes:true}).flatMap(entry=>{const file=path.join(root,entry.name);return entry.isDirectory()?sourceFiles(file):/\.(?:mjs|cjs|js)$/.test(file)?[file]:[]})}
const {handler}=createRequire(import.meta.url)(path.join(extract(chat),'chat.js'));
const event=text=>({httpMethod:'POST',body:JSON.stringify({messages:[{role:'user',content:text}]})});
const result=await handler(event('Quero 3 cópias A3 coloridas, somente frente.'));
assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).quote.totalCents,900);
const unknown=JSON.parse((await handler(event('Quero 3 cópias A4 coloridas somente frente'))).body);assert.equal(unknown.handoff,true);assert(!unknown.quote);
const isolatedChecks=[];
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Network calls forbidden during compiled-function checks')};
try{for(const name of ['panel-api','whatsapp-webhook']){
 const bundle=bundles.find(b=>b.name===name);
 const root=extract(bundle),sources=sourceFiles(root),sentinel=name==='panel-api'?'PANEL_ACCESS_KEY':'Verification failed';
 const entry=sources.find(file=>fs.readFileSync(file,'utf8').includes(sentinel));
 assert(entry,name+' precisa conter o handler recuperado');
 assert(sources.some(file=>fs.readFileSync(file,'utf8').includes('idy-conversations')),name+' precisa preservar o armazenamento, inclusive quando incorporado pelo empacotador');
 const loaded=await import(pathToFileURL(entry));const invoke=typeof loaded.default==='function'?loaded.default:loaded.default?.default;
 console.log('ISOLATED_BUNDLE_MODULE',JSON.stringify({name,entry:path.relative(root,entry),exports:Object.keys(loaded)}));
 assert.equal(typeof invoke,'function',name+' precisa exportar o handler nativo');
 const previous=process.env.PANEL_ACCESS_KEY;process.env.PANEL_ACCESS_KEY='bundle-fixture-only';
 try{const response=await invoke(new Request('https://fixture.invalid/'+name));assert.equal(response.status,name==='panel-api'?401:403);isolatedChecks.push({name,status:response.status,dependenciesResolvedOutsideCheckout:true});}
 finally{if(previous===undefined)delete process.env.PANEL_ACCESS_KEY;else process.env.PANEL_ACCESS_KEY=previous;}
}}finally{globalThis.fetch=originalFetch;for(const root of directories)fs.rmSync(root,{recursive:true,force:true});}
fs.mkdirSync('preview/orcamento-a3',{recursive:true});
fs.writeFileSync('preview/orcamento-a3/bundle-report.json',JSON.stringify({threeA3Cents:900,unknownA4Human:true,functions:bundles.map(b=>({name:b.name,runtimeAPIVersion:b.runtimeAPIVersion})),isolatedChecks,knownInventoryPreserved:true,authoritativeLiveInventoryConfirmed:false,readyForPublication:false,pending:['Acesso ao projeto e branch de produção','Inventário e configuração do deploy ativo','Aprovação do responsável']},null,2));
console.log('TEN_KNOWN_FUNCTIONS_BUNDLED_WITHOUT_PUBLICATION');
