import {randomUUID,createHash} from 'node:crypto';
import {HUMAN_WHATSAPP} from './artwork-attendance.mjs';

const line=(value,max=180)=>String(value||'').replace(/[\r\n\t\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const products=[[/\bcart(?:ao|oes)(?: de visita)?\b/,'Cartões de visita'],[/\bpanfletos?\b/,'Panfletos'],[/\bfolders?\b/,'Folders'],[/\b(?:banners?|lonas?)\b/,'Banners / lonas'],[/\badesivos?\b/,'Adesivos'],[/\betiquetas?\b/,'Etiquetas'],[/\b(?:livros?|apostilas?)\b/,'Livros / apostilas'],[/\bfachadas?\b/,'Fachadas'],[/\b(?:sites?|website)\b/,'Site']];
export function quoteFields(contact,history,attendanceId,stamp){
  const messages=(history||[]).filter(m=>typeof m?.content==='string'),recent=[...messages].reverse();
  let product='A confirmar',quantity='A confirmar',value='A confirmar';
  for(const m of recent){const text=normalized(m.content),hits=products.filter(([pattern])=>pattern.test(text));if(hits.length===1){product=hits[0][1];break;}}
  for(const m of recent){
    const text=normalized(m.content),match=text.match(/\b(\d{1,6}(?:\.\d{3})?)\s*(?:unidades?\s*(?:de\s*)?)?(cartoes?|cartao|panfletos?|folders?|banners?|lonas?|adesivos?|etiquetas?|livros?|apostilas?|fachadas?|sites?)\b/);
    if(match){const hit=products.find(([pattern])=>pattern.test(match[2]));if(hit&&hit[1]===product){quantity=match[1];break;}}
  }
  for(const m of recent.filter(m=>m.role==='assistant')){
    const text=m.content,money=[...text.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)];
    const quotedProducts=products.filter(([pattern])=>pattern.test(normalized(text)));if(quotedProducts.length&&(!quotedProducts.some(([,label])=>label===product)||quotedProducts.length>1))continue;
    const total=text.match(/(?:valor\s+total|total(?:\s+do\s+orçamento)?|orçamento)\s*[:=–-]?\s*(R\$\s*[\d.]+(?:,\d{2})?)/i);
    if(total){value=line(total[1],60);break;}
    if(money.length===1&&!/\b(?:cada|unit[aá]rio|por unidade)\b/i.test(text)){value='R$ '+money[0][1];break;}
  }
  const date=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'}).format(new Date(stamp));
  return {name:line(contact?.nome,120)||'Não informado',phone:line(contact?.whatsapp,40)||'Não informado',product,quantity,value,attendanceId,date:date+' (America/Sao_Paulo)'};
}
class MetaError extends Error{
  constructor(code,{uncertain=false,retryable=false,configuration=false}={}){super('Notificação WhatsApp não confirmada.');Object.assign(this,{code,uncertain,retryable,configuration});}
}
function config(env){
  const token=env.WHATSAPP_ACCESS_TOKEN,phoneId=env.WHATSAPP_PHONE_NUMBER_ID,template=env.WHATSAPP_ARTWORK_TEMPLATE_NAME,language=env.WHATSAPP_ARTWORK_TEMPLATE_LANGUAGE||'pt_BR',version=env.META_GRAPH_VERSION||'v26.0';
  if(!token||!phoneId||!template)return {ok:false};
  if(!/^\d+$/.test(phoneId)||!/^[a-z0-9_]{1,512}$/.test(template)||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(language)||!/^v\d+\.\d+$/.test(version))return {ok:false};
  const fingerprint=createHash('sha256').update([token,phoneId,template,language,version].join('\0')).digest('hex');
  return {ok:true,token,phoneId,template,language,version,fingerprint};
}
function decodeImage(image){
  const match=typeof image==='string'&&image.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)throw Error('Imagem inválida');
  const bytes=Buffer.from(match[2],'base64');if(bytes.length>5*1024*1024)throw Error('Imagem excede o limite do WhatsApp');
  if(match[1]==='jpeg'?(bytes[0]!==255||bytes[1]!==216):!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Imagem inválida');
  return {bytes,type:'image/'+match[1],extension:match[1]==='jpeg'?'jpg':'png'};
}
async function defaultStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-artwork-notifications',consistency:'strong'});}
export function createArtworkNotifications({storeFactory=defaultStore,env=process.env,now=Date.now,fetchImpl=fetch,uuid=randomUUID}={}){
  async function update(store,key,edit){
    for(let attempt=0;attempt<12;attempt++){
      const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});if(!old)return null;
      const value=edit(old.data);if(value?.skip)return old.data;
      if((await store.setJSON(key,old.data,{onlyIfMatch:old.etag})).modified)return old.data;
    }throw Error('Armazenamento de notificação ocupado');
  }
  async function graph(cfg,path,body,send=false){
    let response;
    try{response=await fetchImpl('https://graph.facebook.com/'+cfg.version+'/'+path,{method:'POST',headers:{Authorization:'Bearer '+cfg.token,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});}
    catch{throw new MetaError('NETWORK_UNCONFIRMED',{uncertain:send,retryable:!send});}
    let data;try{data=await response.json()}catch{throw new MetaError('RESPONSE_UNCONFIRMED',{uncertain:send,retryable:!send});}
    if(!response.ok||data.error){
      if(send&&data.messages?.[0]?.id)throw new MetaError('MESSAGE_RESPONSE_UNCONFIRMED',{uncertain:true});
      const code=Number(data.error?.code)||response.status;
      if(response.status>=500)throw new MetaError('META_5XX',{uncertain:send,retryable:!send});
      throw new MetaError('META_'+code,{configuration:[401,403,190,131047,131071,132001,132000,132012,132015].includes(code)||[401,403].includes(response.status),retryable:response.status===429||[4,17,130429,131056].includes(code)});
    }return data;
  }
  const api={
    async enqueue({attendanceId,responseId,image,contact,history}){
      decodeImage(image);const store=await storeFactory(),key='notifications/'+attendanceId;
      await store.setJSON(key,{id:attendanceId,responseId,image,fields:quoteFields(contact,history,attendanceId,now()),createdAt:now(),state:'pending',attempts:0},{onlyIfNew:true});
      const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});if(old?.data.responseId!==responseId)throw Error('Prévia de atendimento divergente');return old.data.state;
    },
    async status(id){const old=await(await storeFactory()).getWithMetadata('notifications/'+id,{type:'json',consistency:'strong'});return old?.data.state||'pending';},
    async process(id){
      const store=await storeFactory(),key='notifications/'+id,cfg=config(env),lease=uuid();
      let acquired=false;
      const job=await update(store,key,data=>{
        acquired=false;
        if(['accepted','unconfirmed','expired'].includes(data.state))return {skip:true};
        if(cfg.ok&&data.configFingerprint&&data.configFingerprint!==cfg.fingerprint){data.attempts=0;data.nextAttemptAt=0;if(data.state==='failed')data.state='retry';}
        if(data.state==='failed')return {skip:true};
        if(data.state==='processing'){
          if(data.leaseUntil<=now()){data.state='unconfirmed';data.errorCode='PROCESSING_INTERRUPTED';return;}
          return {skip:true};
        }
        if(data.nextAttemptAt>now())return {skip:true};
        if(!cfg.ok){data.state='configuration_required';data.errorCode='WHATSAPP_CONFIGURATION_REQUIRED';return;}
        if(data.attempts>=3){data.state='failed';return;}
        Object.assign(data,{state:'processing',lease,leaseUntil:now()+30000,attempts:data.attempts+1,configFingerprint:cfg.fingerprint});acquired=true;
      });
      if(!job||!acquired||job.lease!==lease)return job?.state||'pending';
      let sendStarted=false;
      try{
        let mediaId=job.mediaId;
        if(!mediaId){
          const decoded=decodeImage(job.image),body=new FormData();body.append('messaging_product','whatsapp');body.append('type',decoded.type);body.append('file',new Blob([decoded.bytes],{type:decoded.type}),'previa-idy-'+job.id.slice(0,8)+'.'+decoded.extension);
          const uploaded=await graph(cfg,cfg.phoneId+'/media',body);
          if(!/^\d+$/.test(String(uploaded.id||'')))throw new MetaError('MEDIA_UNCONFIRMED',{retryable:true});
          mediaId=String(uploaded.id);await update(store,key,data=>{if(data.lease!==lease)throw Error('Notificação sem reserva');data.mediaId=mediaId;});
        }
        const f=job.fields,parameters=[f.name,f.phone,f.product,f.quantity,f.value,f.attendanceId,f.date].map(text=>({type:'text',text}));
        sendStarted=true;
        const result=await graph(cfg,cfg.phoneId+'/messages',{messaging_product:'whatsapp',recipient_type:'individual',to:HUMAN_WHATSAPP,type:'template',biz_opaque_callback_data:'idy-art:'+job.id,template:{name:cfg.template,language:{code:cfg.language},components:[{type:'header',parameters:[{type:'image',image:{id:mediaId}}]},{type:'body',parameters}]}},true);
        const messageId=result.messages?.[0]?.id;if(typeof messageId!=='string'||!messageId)throw new MetaError('MESSAGE_UNCONFIRMED',{uncertain:true});
        await update(store,key,data=>{if(data.lease!==lease)throw Error('Notificação sem reserva');Object.assign(data,{state:'accepted',messageId,acceptedAt:now(),image:null});});return 'accepted';
      }catch(error){
        const uncertain=error instanceof MetaError?error.uncertain:sendStarted,retryable=error instanceof MetaError?error.retryable:!sendStarted;
        const updated=await update(store,key,data=>{
          if(data.lease!==lease)return {skip:true};
          data.errorCode=error instanceof MetaError?error.code:'NOTIFICATION_UNCONFIRMED';
          data.state=uncertain?'unconfirmed':error.configuration?'configuration_required':retryable&&data.attempts<3?'retry':'failed';
          data.nextAttemptAt=now()+(error.configuration?3600000:60000*data.attempts);
        });return updated?.state||'unconfirmed';
      }
    },
    async processPending(){
      const store=await storeFactory(),report={checked:0,accepted:0,pending:0},cfg=config(env);const started=Date.now();
      for await(const page of store.list({prefix:'notifications/',paginate:true})){
        for(const {key} of page.blobs){
          if(report.checked>=100||Date.now()-started>8000)return report;
          const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});if(!old)continue;
          if(now()-old.data.createdAt>30*86400000){await store.delete(key);continue;}
          const configurationChanged=cfg.ok&&old.data.configFingerprint&&old.data.configFingerprint!==cfg.fingerprint;
          if(['accepted','unconfirmed','expired'].includes(old.data.state)||old.data.state==='failed'&&!configurationChanged||old.data.nextAttemptAt>now()&&!configurationChanged)continue;
          report.checked++;const state=await api.process(old.data.id);if(state==='accepted')report.accepted++;else report.pending++;
          // A scheduled function has 30 seconds; one media upload + send fits in this run.
          return report;
        }
      }return report;
    }
  };return api;
}
