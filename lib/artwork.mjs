import {createHmac,timingSafeEqual} from 'node:crypto';
import {createQuota,quotaLimits,QuotaError} from './artwork-quota.mjs';
import {createAttendanceGate,AttendanceError,humanUrl} from './artwork-attendance.mjs';
import {createArtworkNotifications} from './artwork-notification.mjs';

class ArtworkError extends Error {
  constructor(status,message,rejected=false){super(message);this.status=status;this.rejected=rejected;}
}
const fail=(status,message,rejected=false)=>{throw new ArtworkError(status,message,rejected)};
const reply=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(data.retryAfterSeconds?{'Retry-After':String(data.retryAfterSeconds)}:{})}});
const digest=(secret,text)=>createHmac('sha256',secret).update(text).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');

function signTicket(secret,id,expires,quota,attendance){
  const payload=encode({id,expires,quota,attendance});return payload+'.'+digest(secret,payload);
}
function readTicket(secret,ticket,now){
  if(typeof ticket!=='string'||ticket.length>700)fail(403,'Prévia não autorizada.');
  const [payload,signature,...extra]=ticket.split('.');
  if(extra.length||!payload||!/^[a-f0-9]{64}$/.test(signature||''))fail(403,'Prévia não autorizada.');
  const expected=digest(secret,payload);
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(signature)))fail(403,'Prévia não autorizada.');
  let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString())}catch{fail(403,'Prévia não autorizada.')}
  if(!/^resp_[a-zA-Z0-9]+$/.test(data.id||'')||!Number.isSafeInteger(data.expires)||data.expires<=now||data.expires>now+3600000)fail(410,'A prévia expirou. Peça uma nova proposta.');
  if(data.quota&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.quota.day||'')||!/^[0-9a-f-]{36}$/.test(data.quota.id||'')))fail(403,'Prévia não autorizada.');
  if(data.attendance&&(!/^[0-9a-f-]{36}$/.test(data.attendance.id||'')||!/^[0-9a-f-]{36}$/.test(data.attendance.attendanceId||'')))fail(403,'Prévia não autorizada.');
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
async function defaultStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-artwork-usage',consistency:'strong'});}

export function createArtworkHandler({fetchImpl=fetch,storeFactory=defaultStore,attendanceStoreFactory,notificationStoreFactory,whatsappFetchImpl=fetch,env=process.env,now=Date.now}={}){
  const gate=createAttendanceGate({secret:env.OPENAI_API_KEY,storeFactory:attendanceStoreFactory,now});
  const notifications=createArtworkNotifications({env,storeFactory:notificationStoreFactory,fetchImpl:whatsappFetchImpl,now});
  async function openAI(path,method='GET',body){
    let response;
    try{response=await fetchImpl('https://api.openai.com/v1'+path,{method,headers:{Authorization:'Bearer '+env.OPENAI_API_KEY,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)})}
    catch{fail(504,'Não consegui confirmar a criação da prévia. Tente novamente em instantes.')}
    if(!response.ok){
      const rejected=[400,401,403,404,422,429].includes(response.status);
      if(response.status===429)fail(503,'A criação de artes está ocupada ou sem saldo disponível. A equipe da IDY pode ajudar com o layout.',true);
      if(response.status===401||response.status===403)fail(503,'A criação de artes precisa ser habilitada na conta da IDY. Você pode encaminhar o pedido à equipe.',true);
      fail(502,'Não foi possível preparar a prévia agora. A equipe da IDY pode ajudar com o layout.',rejected);
    }
    let data;try{data=await response.json()}catch{fail(502,'A criação de artes não retornou uma resposta válida.')}
    return data;
  }
  return async function artwork(req,context={}){
    let quota=null,reservation=null,accepted=false,claim=null,providerContacted=false;
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
        claim=await gate.reserve(body.attendanceTicket);
        if(claim.existing)return reply(202,{ok:true,ticket:signTicket(key,claim.responseId,now()+1200000,claim.quota,{id:claim.id,attendanceId:claim.attendanceId}),status:'processing',previewOnly:true,resumed:true});
        const limits=quotaLimits(env),store=await storeFactory(),ipKey=digest(key,ip);
        quota=createQuota({store,limits,now});reservation=await quota.reserve(ipKey);
        const content=[{type:'input_text',text:brief}];if(image)content.push({type:'input_image',image_url:image});
        providerContacted=true;
        const data=await openAI('/responses','POST',{
          model:env.IDY_ARTWORK_MODEL||'gpt-5-mini',background:true,store:true,max_output_tokens:2048,max_tool_calls:1,parallel_tool_calls:false,
          instructions:'Prepare uma única proposta visual conceitual de arte gráfica para o cliente da IDY Gráfica. Use a ferramenta de geração de imagem uma única vez. Em edições, preserve logotipos, nomes, textos e contatos da arte de referência, exceto o que o cliente pediu explicitamente para mudar. Não invente contatos, preços nem promessas. Crie a composição da arte, sem simular impressão pronta. A proposta será conferida pela gráfica antes da produção.',
          input:[{role:'user',content}],
          tools:[{type:'image_generation',model:env.IDY_ARTWORK_IMAGE_MODEL||'gpt-image-2.5-sunburst',action:body.mode==='edit'?'edit':'generate',quality:'low',size:'1536x1024',output_format:'jpeg',output_compression:80}],
          tool_choice:{type:'image_generation'}
        });
        accepted=true;
        if(!/^resp_[a-zA-Z0-9]+$/.test(data.id||''))fail(502,'Não consegui iniciar a criação da prévia.');
        await gate.settle(claim,'queued',data.id,reservation);
        await quota.settle(reservation,'queued',data.id);
        return reply(202,{ok:true,ticket:signTicket(key,data.id,now()+1200000,reservation,{id:claim.id,attendanceId:claim.attendanceId}),status:'processing',previewOnly:true});
      }
      const ticket=(req.headers.get('authorization')||'').replace(/^Bearer /,''),job=readTicket(key,ticket,now());
      if(req.method==='GET'&&new URL(req.url).searchParams.get('notification')==='1'&&job.attendance)return reply(200,{ok:true,notification:{state:await notifications.status(job.attendance.attendanceId)}});
      if(req.method==='DELETE'){await openAI('/responses/'+job.id,'DELETE');return reply(200,{ok:true});}
      const data=await openAI('/responses/'+job.id);
      if(['queued','in_progress'].includes(data.status))return reply(202,{ok:true,status:'processing'});
      const ledger=job.quota?createQuota({store:await storeFactory(),limits:quotaLimits(env),now}):null;
      const settle=async state=>{if(job.attendance)await gate.settle(job.attendance,state,job.id,job.quota);await ledger?.settle(job.quota,state,job.id);};
      const item=data.output?.find(output=>output.type==='image_generation_call'&&output.result);
      if(['failed','cancelled','incomplete'].includes(data.status)){
        await settle(item?'unavailable':'failed');
        fail(502,'Não foi possível concluir esta proposta. Você pode pedir outra prévia ou encaminhar seu pedido à equipe.');
      }
      if(data.status!=='completed'){await settle('uncertain');fail(502,'Não foi possível confirmar o resultado desta proposta.');}
      if(!item){await settle('failed');fail(502,'A IA não retornou uma proposta visual. Tente descrever melhor a arte desejada.');}
      let image;try{image=resultImage(item.result);}catch(error){await settle('unavailable');throw error;}
      let notification={state:'unlinked'};
      if(job.attendance){
        const details=await gate.details(job.attendance);
        notification.state=await notifications.enqueue({...details,responseId:job.id,image});
      }
      await settle('completed');
      if(job.attendance){
        const work=notifications.process(job.attendance.attendanceId).catch(()=> 'pending');
        if(typeof context.waitUntil==='function')context.waitUntil(work);else notification.state=await work;
      }
      return reply(200,{ok:true,status:'completed',image,previewOnly:true,notification});
    }catch(error){
      if(reservation){try{await quota.settle(reservation,!accepted&&error.rejected?'failed':'uncertain');}catch{}}
      if(claim&&!claim.existing){try{await gate.settle(claim,!providerContacted||!accepted&&error.rejected?'failed':'uncertain');}catch{}}
      const known=error instanceof ArtworkError||error instanceof QuotaError||error instanceof AttendanceError;
      return reply(known?error.status:503,{ok:false,error:known?error.message:'A criação de artes está temporariamente indisponível. A equipe da IDY pode ajudar com o layout.',...(error instanceof AttendanceError?{errorCode:error.code,humanUrl}:{}),...(error instanceof QuotaError?{errorCode:error.code,...(error.resetAt?{resetAt:new Date(error.resetAt).toISOString(),retryAfterSeconds:Math.max(1,Math.ceil((error.resetAt-now())/1000))}:{})}:{})});
    }
  };
}
