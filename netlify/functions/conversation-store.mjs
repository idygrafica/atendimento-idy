import { getStore } from '@netlify/blobs';

function store() {
  // Netlify Functions v2 injects the Blobs context automatically.
  return getStore('idy-conversations');
}
function key(phone){ return `conv:${String(phone||'').replace(/\D/g,'')}`; }

export async function getConversation(phone){
  const s=store();
  return await s.get(key(phone), { type:'json' });
}

export async function saveConversation(conv){
  const s=store();
  conv.updatedAt = new Date().toISOString();
  await s.setJSON(key(conv.phone), conv);
  return conv;
}

export async function ensureConversation(phone, name='Cliente'){
  let conv=await getConversation(phone);
  if(!conv){
    conv={phone:String(phone),name:name||'Cliente',mode:'ai',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),messages:[]};
  }
  if(name && (!conv.name || conv.name==='Cliente')) conv.name=name;
  return conv;
}

export async function appendMessage(phone, message, name='Cliente'){
  const conv=await ensureConversation(phone,name);
  conv.messages=Array.isArray(conv.messages)?conv.messages:[];
  conv.messages.push({
    id: message.id || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    role: message.role,
    text: String(message.text||''),
    at: message.at || new Date().toISOString(),
    type: message.type || 'text'
  });
  if(conv.messages.length>120) conv.messages=conv.messages.slice(-120);
  return await saveConversation(conv);
}

export async function listConversations(){
  const s=store();
  const listed=await s.list({ prefix:'conv:' });
  const out=[];
  for(const b of listed.blobs||[]){
    const c=await s.get(b.key,{type:'json'});
    if(c) out.push(c);
  }
  out.sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
  return out;
}
