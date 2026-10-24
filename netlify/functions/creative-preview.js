function json(statusCode, body){return {statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)}}
function auth(event){return process.env.PANEL_ACCESS_KEY && event.headers['x-panel-key']===process.env.PANEL_ACCESS_KEY;}
exports.handler=async function(event){
  if(event.httpMethod!=='POST') return json(405,{ok:false,error:'Método não permitido'});
  if(!auth(event)) return json(401,{ok:false,error:'Acesso não autorizado.'});
  const apiKey=process.env.OPENAI_API_KEY; if(!apiKey) return json(500,{ok:false,error:'OPENAI_API_KEY não configurada.'});
  try{
    const body=JSON.parse(event.body||'{}');
    const type=body.type==='facade'?'fachada comercial':'logotipo';
    const brief=String(body.brief||'').trim();
    if(brief.length<8) return json(400,{ok:false,error:'Descreva um pouco melhor o que deve ser criado.'});
    const prompt= type==='fachada comercial'
      ? `Crie uma prévia visual conceitual de fachada comercial para aprovação de cliente. Use o briefing a seguir: ${brief}. Aparência profissional, legível, realista, vista frontal/levemente em perspectiva, sem afirmar medidas técnicas. Trate como mockup de aprovação, não arquivo final de produção.`
      : `Crie uma proposta visual de logotipo original e profissional com base neste briefing: ${brief}. Composição limpa, memorável, adequada para impressão e comunicação visual. Apresente como conceito de marca em fundo neutro. Evite mockups excessivos; destaque o símbolo e a tipografia.`;
    const r=await fetch('https://api.openai.com/v1/images/generations',{
      method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:process.env.OPENAI_IMAGE_MODEL||'gpt-image-1',prompt,size:'1024x1024'})
    });
    const data=await r.json(); if(!r.ok) throw new Error(data?.error?.message||`Imagem HTTP ${r.status}`);
    const item=data?.data?.[0]||{};
    const image=item.b64_json?`data:image/png;base64,${item.b64_json}`:item.url;
    if(!image) throw new Error('A API não retornou a imagem.');
    return json(200,{ok:true,image});
  }catch(err){console.error('creative-preview',err);return json(500,{ok:false,error:err.message||'Falha ao gerar prévia.'});}
};
