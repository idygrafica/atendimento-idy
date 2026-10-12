import {createHmac,timingSafeEqual} from 'node:crypto';

export const IDLE_MS=10*60*1000;
const DAY=24*60*60*1000,RETENTION=30*DAY;
const origin='https://atendimento-idy.netlify.app';
class LeadError extends Error{constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new LeadError(status,message)};
const json=(status,data)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const mac=(key,value)=>createHmac('sha256',key).update(value).digest('hex');
function ticket(key,id){return id+'.'+mac(key,id)}
function readTicket(key,value){
  const [id,sig,...extra]=String(value||'').split('.');
  if(extra.length||!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f]{64}$/.test(sig||''))fail(403,'Atendimento não autorizado.');
  if(!timingSafeEqual(Buffer.from(mac(key,id)),Buffer.from(sig)))fail(403,'Atendimento não autorizado.');return id;
}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value.length>max)fail(400,label+' inválido.');return value.trim();}
function contacts(value){
  const nome=text(value?.nome,120,'Nome'),email=text(value?.email,254,'E-mail'),whatsapp=text(value?.whatsapp,24,'Telefone');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{10,15}$/.test(whatsapp.replace(/\D/g,'')))fail(400,'Informe e-mail e telefone válidos.');
  return {nome,email,whatsapp};
}
function snapshot(value){
  if(!Array.isArray(value.history)||value.history.length>200)fail(400,'Conversa muito longa para salvar.');
  const history=value.history.map(m=>({role:['user','assistant'].includes(m?.role)?m.role:fail(400,'Mensagem inválida.'),content:text(m?.content,12000,'Mensagem')}));
  if(history.reduce((n,m)=>n+m.content.length,0)>60000)fail(413,'Conversa muito longa para salvar.');
  const files=Array.isArray(value.files)?value.files.slice(0,2).map(f=>text(f,180,'Nome do arquivo')):[];
  if(!Number.isSafeInteger(value.sequence)||value.sequence<1||value.sequence>100000)fail(400,'Sequência inválida.');return {history,files,sequence:value.sequence};
}
async function defaultStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-partial-leads',consistency:'strong'});}
async function quota(store,key,limit){
  for(let i=0;i<8;i++){
    const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'}),count=old?.data?.count||0;
    if(count>=limit)fail(429,'Muitos atendimentos iniciados. Tente novamente mais tarde.');
    if((await store.setJSON(key,{count:count+1},old?{onlyIfMatch:old.etag}:{onlyIfNew:true})).modified)return;
  }fail(503,'Não foi possível iniciar o salvamento agora.');
}
export function createPartialLeadHandler({storeFactory=defaultStore,env=process.env,now=Date.now}={}){
  return async (req,context={})=>{
    try{
      if(req.method!=='POST')return json(405,{ok:false,error:'Método não permitido.'});
      if(req.headers.get('origin')!==new URL(req.url).origin)fail(403,'Inicie o atendimento pela página da IDY.');
      const secret=env.OPENAI_API_KEY;if(!secret)fail(503,'Não foi possível salvar o atendimento agora.');
      if(!(req.headers.get('content-type')||'').startsWith('application/json'))fail(415,'Pedido inválido.');
      const raw=await req.text();if(Buffer.byteLength(raw)>100000)fail(413,'Conversa muito longa para salvar.');
      let body;try{body=JSON.parse(raw)}catch{fail(400,'Pedido inválido.')}
      const store=await storeFactory(),time=now();
      if(body.action==='start'){
        const contact=contacts(body.contact),ip=context.ip||req.headers.get('x-nf-client-connection-ip');if(!ip)fail(503,'Não foi possível iniciar o salvamento nesta conexão.');
        if(!/^[0-9a-f-]{36}$/.test(body.startId||''))fail(400,'Identificação inválida.');
        const fingerprint=mac(secret,ip+'|'+body.startId),id=fingerprint.slice(0,8)+'-'+fingerprint.slice(8,12)+'-'+fingerprint.slice(12,16)+'-'+fingerprint.slice(16,20)+'-'+fingerprint.slice(20,32);
        const existing=await store.getWithMetadata('drafts/'+id,{type:'json',consistency:'strong'});
        if(existing){if(JSON.stringify(existing.data.contact)!==JSON.stringify(contact))fail(409,'Este atendimento já foi iniciado.');return json(200,{ok:true,ticket:ticket(secret,id)});}
        await quota(store,'quota/'+new Date(time).toISOString().slice(0,10)+'/ip/'+mac(secret,ip),10);
        await quota(store,'quota/'+new Date(time).toISOString().slice(0,10)+'/global',100);
        const data={id,contact,history:[],files:[],sequence:0,createdAt:time,lastActivity:time,state:'active',notice:null};
        await store.setJSON('drafts/'+id,data,{onlyIfNew:true});
        await store.setJSON('pending/'+id,{id});
        return json(201,{ok:true,ticket:ticket(secret,id)});
      }
      const id=readTicket(secret,(req.headers.get('authorization')||'').replace(/^Bearer /,''));
      if(!['save','submitting','complete','resume'].includes(body.action))fail(400,'Ação inválida.');
      const update=body.action==='save'?snapshot(body):null;
      for(let attempt=0;attempt<8;attempt++){
        const old=await store.getWithMetadata('drafts/'+id,{type:'json',consistency:'strong'});
        if(!old||time-old.data.createdAt>RETENTION)fail(410,'Este atendimento expirou. Inicie uma nova conversa.');
        const data=old.data;
        if(data.state==='completed')return json(200,{ok:true,completed:true});
        if(body.action==='save'){
          if(update.sequence<=data.sequence)return json(200,{ok:true});
          Object.assign(data,update,{lastActivity:time});
        }else if(body.action==='complete')data.state='completed';
        else if(body.action==='submitting'){data.state='submitting';data.submittingUntil=time+120000;data.lastActivity=time;}
        else {data.state='active';data.lastActivity=time;}
        if((await store.setJSON('drafts/'+id,data,{onlyIfMatch:old.etag})).modified){if(data.state==='completed')await store.delete('pending/'+id);return json(200,{ok:true});}
      }fail(503,'Não foi possível salvar o atendimento agora.');
    }catch(e){return json(e instanceof LeadError?e.status:503,{ok:false,error:e instanceof LeadError?e.message:'Não foi possível salvar o atendimento agora.'});}
  };
}

export function createIdleNotifier({storeFactory=defaultStore,fetchImpl=fetch,now=Date.now,env=process.env}={}){
  return async ()=>{
    // Netlify schedules execute only in production. Never notify from a preview deploy.
    if(env.CONTEXT!=='production')return {skipped:true};
    const store=await storeFactory(),time=now(),report={checked:0,notified:0,failed:0,expired:0};
    const started=Date.now();
    for await(const page of store.list({prefix:'pending/',paginate:true})){
      for(const {key:pendingKey} of page.blobs){
        const key='drafts/'+pendingKey.slice('pending/'.length);
        if(report.checked>=200||Date.now()-started>40000)return report;
        report.checked++;
        const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});if(!old){await store.delete(pendingKey);continue;}
        const data=old.data;
        if(time-data.createdAt>RETENTION){await store.delete(key);await store.delete(pendingKey);report.expired++;continue;}
        if(data.state==='completed'||data.notice){await store.delete(pendingKey);continue;}
        if(time-data.lastActivity<IDLE_MS||(data.state==='submitting'&&data.submittingUntil>time))continue;
        // Claim once with CAS before contacting external services. Do not send twice on an uncertain network result.
        data.notice={state:'sending',claimedAt:time,form:false,whatsapp:false};
        if(!(await store.setJSON(key,data,{onlyIfMatch:old.etag})).modified)continue;
        const claimed=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
        if(claimed?.data.state==='completed'){await store.delete(pendingKey);continue;}
        const conversation=data.history.map(m=>(m.role==='user'?'CLIENTE: ':'ATENDENTE: ')+m.content).join('\n\n');
        const resumo='ATENDIMENTO PARCIAL — cliente sem atividade há pelo menos 10 minutos.\nReferência: '+data.id+'\nCliente: '+data.contact.nome+'\nE-mail: '+data.contact.email+'\nWhatsApp: '+data.contact.whatsapp+(data.files.length?'\nArquivos selecionados, ainda não enviados: '+data.files.join(' + '):'')+'\n\n'+(conversation||'Cliente informou seus contatos, mas ainda não iniciou a conversa.');
        let form=false,whatsapp=false;
        try{
          const body=new URLSearchParams({'form-name':'atendimento-idy',...data.contact,resumo});
          form=(await fetchImpl(origin+'/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:origin},body,signal:AbortSignal.timeout(8000)})).ok;
        }catch{}
        try{
          const response=await fetchImpl(origin+'/.netlify/functions/notify-idy-whatsapp',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({nome:data.contact.nome,whatsapp:data.contact.whatsapp,resumo:resumo.slice(0,2600),arquivo:''}),signal:AbortSignal.timeout(10000)});
          whatsapp=response.ok&&(await response.json()).ok===true;
        }catch{}
        // Keep newer messages/completion if the client resumed while we were sending.
        for(let i=0;i<8;i++){
          const latest=await store.getWithMetadata(key,{type:'json',consistency:'strong'});if(!latest)break;
          latest.data.notice={state:form&&whatsapp?'sent':'unconfirmed',claimedAt:time,form,whatsapp,finishedAt:now()};
          if((await store.setJSON(key,latest.data,{onlyIfMatch:latest.etag})).modified)break;
        }
        if(form&&whatsapp)report.notified++;else report.failed++;
        await store.delete(pendingKey);
      }
    }return report;
  };
}
