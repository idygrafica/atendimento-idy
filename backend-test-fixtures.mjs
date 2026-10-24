// Test-only storage adapter. No Netlify or Meta credentials or services are used.
import {registerHooks} from 'node:module';
import {createRequire} from 'node:module';
const hooks=registerHooks({resolve(specifier,context,next){
  if(specifier==='@netlify/blobs')return {url:'data:text/javascript,'+encodeURIComponent('export function getStore(name){return globalThis.__idyBackendTestStore(name)}'),shortCircuit:true};
  return next(specifier,context);
}});
export function memoryConversations(){
  const values=new Map();
  return {values,async get(key){return values.has(key)?structuredClone(values.get(key)):null},async setJSON(key,value){values.set(key,structuredClone(value))},async list({prefix}){return {blobs:[...values.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))}}};
}
export function installFixture(){
  const store=memoryConversations(),names=['PANEL_ACCESS_KEY','OPENAI_API_KEY','WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_VERIFY_TOKEN','WHATSAPP_LEAD_TEMPLATE_NAME'];
  const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for(const name of names)process.env[name]='fixture-only';
  delete process.env.WHATSAPP_LEAD_TEMPLATE_NAME;
  const oldStore=globalThis.__idyBackendTestStore,oldFetch=globalThis.fetch;
  globalThis.__idyBackendTestStore=name=>{if(name!=='idy-conversations')throw Error('Unexpected test store');return store};
  globalThis.fetch=async()=>{throw Error('External calls are blocked in backend fixtures')};
  return {store,key:'fixture-only',restore(){globalThis.fetch=oldFetch;globalThis.__idyBackendTestStore=oldStore;for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name]}}};
}
const require=createRequire(import.meta.url);
export const panel=(await import('./netlify/functions/panel-api.mjs')).default;
export const webhook=(await import('./netlify/functions/whatsapp-webhook.mjs')).default;
export const conversations=await import('./netlify/functions/conversation-store.mjs');
export const notify=require('./netlify/functions/notify-idy-whatsapp.js').handler;
export const creative=require('./netlify/functions/creative-preview.js').handler;
export const health=require('./netlify/functions/health.js').handler;
