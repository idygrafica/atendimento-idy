import {createHmac,timingSafeEqual} from 'node:crypto';

class ArtworkError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
const fail=(status,message)=>{throw new ArtworkError(status,message)};
const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const digest=(secret,text)=>createHmac('sha256',secret).update(text).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

function signTicket(secret,id,expires){
  const payload=encode({id,expires});return payload+'.'+digest(secret,payload);
}
function readTicket(secret,ticket,now){
  if(typeof ticket!=='string'||ticket.length>700)fail(403,'Prévia não autorizada.');
  const [payload,signature,...extra]=ticket.split('.');
  if(extra.length||!payload||!/^[a-f0-9]{64}$/.test(signature||''))fail(403,'Prévia não autorizada.');
  const expected=digest(secret,payload);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))fail(403,'Prévia não autorizada.');
  let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString())}catch{fail(403,'Prévia não autorizada.')}
  if(!/^resp_[a-zA-Z0-9]+$/.test(data.id||'')||!Number.isSafeInteger(data.expires)||data.expires<=now||data.expires>now+3600000)fail(410,'A prévia expirou. Peça uma nova proposta.');
  return data;
}
function imageInput(value){
  if(typeof value!=='string'||value.length>2800000)fail(413,'A imagem está grande demais para preparar a prévia.');
  const match=value.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)fail(400,'Para melhorar uma arte, use uma imagem JPG ou PNG.');
  const bytes=Buffer.from(match[2],'base64');
  const valid=match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!valid||bytes.length>2000000)fail(400,'Não foi possível ler a imagem selecionada.');
  return value;
}
function resultImage(value){
  if(typeof value!=='string'||value.length>4000000||!/^[A-Za-z0-9+/]+={0,2}$/.test(value))fail(502,'A prévia retornou em um formato inesperado.');
  const bytes=Buffer.from(value,'base64');
  if(bytes[0]===255&&bytes[1]===216)return 'data:image/jpeg;base64,'+value;
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'data:image/png;base64,'+value;
  fail(502,'Não foi possível mostrar a imagem gerada.');
}
async function reserve(store,key,limit){
  for(let attempt=0;attempt<8;attempt++){
    const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
    const count=old?.data?.count||0;if(count>=limit)fail(429,'O limite de prévias de hoje foi atingido. Você pode encaminhar seu pedido à equipe da IDY.');
    const result=await store.setJSON(key,{count:count+1},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
    if(result.modified)return;
  }
  fail(503,'A criação de prévias está ocupada. Tente novamente em instantes.');
}
async function defaultStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-artwork-usage',consistency:'strong'});}

export function createArtworkHandler({fetchImpl=fetch,storeFactory=defaultStore,env=process.env,now=Date.now}={}){
  async function openAI(path,method='GET',body){
    let response;
    try{response=await fetchImpl('https://api.openai.com/v1'+path,{method,headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)})}
    catch{fail(504,'Não consegui confirmar a criação da prévia. Tente novamente em instantes.')}
    if(!response.ok){
      if(response.status===429)fail(503,'A criação de artes está ocupada ou sem saldo disponível. A equipe da IDY pode ajudar com o layout.');
      if(response.status===401||response.status===403)fail(503,'A criação de artes precisa ser habilitada na conta da IDY. Você pode encaminhar o pedido à equipe.');
      fail(502,'Não foi possível preparar a prévia agora. A equipe da IDY pode ajudar com o layout.');
    }
    let data;try{data=await response.json()}catch{fail(502,'A criação de artes não retornou uma resposta válida.')}
    return data;
  }
  return async function artwork(req,context={}){
    try{
      if(!['POST','GET','DELETE'].includes(req.method))return reply(405,{ok:false,error:'Método não permitido.'});
      const key=env.OPENAI_API_KEY;if(!key)fail(503,'A criação de artes precisa ser configurada pela IDY.');
      if(req.method==='POST'){
        const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)fail(403,'Inicie a criação pela página de atendimento da IDY.');
        if(!(req.headers.get('content-type')||'').startsWith('application/json'))fail(415,'Formato de pedido inválido.');
        const raw=await req.text();if(Buffer.byteLength(raw)>3000000)fail(413,'A imagem está grande demais para preparar a prévia.');
        let body;try{body=JSON.parse(raw)}catch{fail(400,'Pedido de criação inválido.')}
        if(!['create','edit'].includes(body.mode))fail(400,'Escolha criar uma proposta ou melhorar a arte.');
        const brief=typeof body.brief==='string'?body.brief.trim():'';if(brief.length<12||brief.length>4000)fail(400,'Descreva o que deseja criar ou mudar na arte, com até 4.000 caracteres.');
        const image=body.mode==='edit'?imageInput(body.image):null;
        const ip=context.ip||req.headers.get('x-nf-client-connection-ip');if(!ip)fail(503,'Não foi possível iniciar a prévia nesta conexão.');
        const store=await storeFactory(),day=new Date(now()).toISOString().slice(0,10),ipKey=digest(key,ip);
        const limit=Number(env.IDY_ARTWORK_DAILY_LIMIT)||20,perIP=Number(env.IDY_ARTWORK_PER_IP_LIMIT)||3;
        if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(perIP)||perIP<1||perIP>10)fail(503,'O limite de criação precisa ser configurado pela IDY.');
        await reserve(store,'quota/'+day+'/ip/'+ipKey,perIP);await reserve(store,'quota/'+day+'/global',limit);
        const content=[{type:'input_text',text:brief}];if(image)content.push({type:'input_image',image_url:image});
        const data=await openAI('/responses','POST',{
          model:env.IDY_ARTWORK_MODEL||'gpt-5-mini',background:true,store:true,max_output_tokens:2048,max_tool_calls:1,parallel_tool_calls:false,
          instructions:'Prepare uma única proposta visual conceitual de arte gráfica para o cliente da IDY Gráfica. Use a ferramenta de geração de imagem uma única vez. Em edições, preserve logotipos, nomes, textos e contatos da arte de referência, exceto o que o cliente pediu explicitamente para mudar. Não invente contatos, preços nem promessas. Crie a composição da arte, sem simular impressão pronta. A proposta será conferida pela gráfica antes da produção.',
          input:[{role:'user',content}],
          tools:[{type:'image_generation',model:env.IDY_ARTWORK_IMAGE_MODEL||'gpt-image-2.5-sunburst',action:body.mode==='edit'?'edit':'generate',quality:'low',size:'1536x1024',output_format:'jpeg',output_compression:80}],
          tool_choice:{type:'image_generation'}
        });
        if(!/^resp_[a-zA-Z0-9]+$/.test(data.id||''))fail(502,'Não consegui iniciar a criação da prévia.');
        return reply(202,{ok:true,ticket:signTicket(key,data.id,now()+1200000),status:'processing',previewOnly:true});
      }
      const ticket=(req.headers.get('authorization')||'').replace(/^Bearer /,''),job=readTicket(key,ticket,now());
      if(req.method==='DELETE'){await openAI('/responses/'+job.id,'DELETE');return reply(200,{ok:true});}
      const data=await openAI('/responses/'+job.id);
      if(['queued','in_progress'].includes(data.status))return reply(202,{ok:true,status:'processing'});
      if(data.status!=='completed')fail(502,'Não foi possível concluir esta proposta. Você pode pedir outra prévia ou encaminhar seu pedido à equipe.');
      const item=data.output?.find(output=>output.type==='image_generation_call'&&output.result);
      if(!item)fail(502,'A IA não retornou uma proposta visual. Tente descrever melhor a arte desejada.');
      return reply(200,{ok:true,status:'completed',image:resultImage(item.result),previewOnly:true});
    }catch(error){return reply(error instanceof ArtworkError?error.status:503,{ok:false,error:error instanceof ArtworkError?error.message:'A criação de artes está temporariamente indisponível. A equipe da IDY pode ajudar com o layout.'});}
  };
}
