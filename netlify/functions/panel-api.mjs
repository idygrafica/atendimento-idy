import { getConversation, saveConversation, listConversations } from './conversation-store.mjs';

function json(body, status=200){
  return Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
}
function auth(req){
  const expected=process.env.PANEL_ACCESS_KEY;
  if(!expected) return {ok:false,status:503,error:'PANEL_ACCESS_KEY não configurada na Netlify.'};
  const got=req.headers.get('x-panel-key');
  if(got!==expected) return {ok:false,status:401,error:'Acesso não autorizado.'};
  return {ok:true};
}
async function sendWhatsAppText(to, body){
  const token=process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId=process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion=process.env.META_GRAPH_VERSION||'v26.0';
  if(!token||!phoneNumberId) throw new Error('WhatsApp não configurado na Netlify.');
  const r=await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,{
    method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{body}})
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data?.error?.message||`WhatsApp HTTP ${r.status}`);
  return data;
}

export default async function handler(req){
  const a=auth(req); if(!a.ok) return json({ok:false,error:a.error},a.status);
  try{
    const url=new URL(req.url);
    if(req.method==='GET'){
      const phone=url.searchParams.get('phone');
      if(phone){ const c=await getConversation(phone); return json({ok:true,conversation:c||null}); }
      const list=await listConversations();
      const slim=list.map(c=>({phone:c.phone,name:c.name||'Cliente',mode:c.mode||'ai',updatedAt:c.updatedAt,lastMessage:(c.messages||[]).slice(-1)[0]||null,count:(c.messages||[]).length}));
      return json({ok:true,conversations:slim});
    }
    if(req.method!=='POST') return json({ok:false,error:'Método não permitido'},405);
    const body=await req.json().catch(()=>({}));
    const phone=String(body.phone||'').replace(/\D/g,'');
    if(!phone) return json({ok:false,error:'Telefone obrigatório.'},400);
    const conv=await getConversation(phone);
    if(!conv) return json({ok:false,error:'Conversa não encontrada.'},404);
    if(body.action==='set_mode'){
      conv.mode=body.mode==='human'?'human':'ai';
      await saveConversation(conv);
      return json({ok:true,mode:conv.mode});
    }
    if(body.action==='send_message'){
      const text=String(body.text||'').trim(); if(!text) return json({ok:false,error:'Mensagem vazia.'},400);
      await sendWhatsAppText(phone,text);
      conv.messages=Array.isArray(conv.messages)?conv.messages:[];
      conv.messages.push({id:`manual-${Date.now()}`,role:'human',text,at:new Date().toISOString(),type:'text'});
      conv.mode='human'; await saveConversation(conv);
      return json({ok:true});
    }
    return json({ok:false,error:'Ação inválida.'},400);
  }catch(err){
    console.error('panel-api',err);
    return json({ok:false,error:err.message||'Erro interno'},500);
  }
}
