import { getConversation, appendMessage } from './conversation-store.mjs';

const SYSTEM_PROMPT = `Você é o atendente virtual da IDY Gráfica, de Porto Alegre/RS. Responda em português do Brasil de forma humana, curta, simpática e comercial, como em uma conversa de WhatsApp. Faça no máximo uma pergunta por vez e aproveite tudo o que o cliente já informou.

Regras comerciais conhecidas:
- Cartão de visita padrão 9x5 cm, 4x4, couché 300g, sem laminação: 500 un = R$ 85,00; 1.000 un = R$ 140,00; acima disso, somente milheiros fechados a R$ 140,00 por milheiro. Não ofereça 1.500, 2.500 etc.; ofereça 1.000 ou 2.000, 2.000 ou 3.000, conforme o caso. Prazo padrão: 5 dias úteis.
- Fachada ACM com caixa/letra 3D: R$ 1.900,00/m² de fabricação.
- Fachada ACM vazado/cortado com iluminação interna: R$ 1.650,00/m² de fabricação.
- Instalação de fachada é separada e depende de altura, acesso, fixação, elétrica e segurança.
- Não invente preços que não estejam cadastrados.

Se o cliente pedir criação de logotipo, layout, mockup ou fachada, colete um briefing curto e útil, uma pergunta por vez: nome/marca, objetivo, estilo, cores, textos e, para fachada, medidas e tipo. Diga que pode ser preparada uma prévia para aprovação. Não prometa arquivo final de produção sem revisão técnica.

Se o cliente quiser falar com uma pessoa ou fechar algo que precisa de análise humana, diga que a equipe da IDY vai continuar o atendimento.`;

function json(body,status=200){ return Response.json(body,{status}); }

async function generateReply(text, history=[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY não configurada');
  const transcript=(history||[]).slice(-14).map(m=>`${m.role==='user'?'CLIENTE':m.role==='human'?'ATENDENTE':'IA'}: ${m.text}`).join('\n');
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`,'Content-Type': 'application/json'},
    body: JSON.stringify({model: process.env.OPENAI_MODEL || 'gpt-5-mini',instructions: SYSTEM_PROMPT,input: `${transcript}\nCLIENTE: ${text}`}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${r.status}`);
  let answer = data.output_text;
  if (!answer && Array.isArray(data.output)) answer=data.output.flatMap(x=>x.content||[]).map(c=>c.text||'').filter(Boolean).join('\n').trim();
  return answer || 'Oi! Como posso ajudar?';
}

async function sendWhatsAppText(to, body) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const graphVersion = process.env.META_GRAPH_VERSION || 'v26.0';
  if (!token || !phoneNumberId) throw new Error('WhatsApp não configurado.');
  const r = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST', headers: {Authorization: `Bearer ${token}`,'Content-Type':'application/json'},
    body: JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to,type:'text',text:{body}}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || `WhatsApp HTTP ${r.status}`);
}

export default async function handler(req) {
  const url=new URL(req.url);
  if (req.method === 'GET') {
    const mode=url.searchParams.get('hub.mode');
    const verify=url.searchParams.get('hub.verify_token');
    const challenge=url.searchParams.get('hub.challenge')||'';
    if(mode==='subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && verify===process.env.WHATSAPP_VERIFY_TOKEN){
      return new Response(String(challenge),{status:200,headers:{'Content-Type':'text/plain'}});
    }
    return new Response('Verification failed',{status:403,headers:{'Content-Type':'text/plain'}});
  }
  if(req.method!=='POST') return json({error:'Método não permitido'},405);
  try{
    const payload=await req.json().catch(()=>({}));
    const changes=payload?.entry?.flatMap(e=>e.changes||[])||[];
    for(const change of changes){
      const value=change?.value||{};
      const contacts=value.contacts||[];
      const contactName=contacts?.[0]?.profile?.name||'Cliente';
      for(const msg of value.messages||[]){
        if(!msg?.from) continue;
        let incoming='';
        if(msg.type==='text') incoming=msg?.text?.body?.trim()||'';
        else incoming=`[${msg.type||'arquivo'} recebido pelo WhatsApp]`;
        if(!incoming) continue;
        await appendMessage(msg.from,{id:msg.id,role:'user',text:incoming,at:new Date(Number(msg.timestamp||0)*1000||Date.now()).toISOString(),type:msg.type||'text'},contactName);
        const conv=await getConversation(msg.from);
        if((conv?.mode||'ai')==='human') continue;
        if(msg.type!=='text') continue;
        const answer=await generateReply(incoming,conv?.messages||[]);
        await sendWhatsAppText(msg.from,answer);
        await appendMessage(msg.from,{role:'assistant',text:answer,type:'text'},contactName);
      }
    }
    return json({received:true});
  }catch(err){
    console.error('whatsapp-webhook',err);
    return json({received:true,warning:err.message||'Erro interno'});
  }
}
