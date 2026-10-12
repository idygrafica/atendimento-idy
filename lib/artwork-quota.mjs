import {randomUUID} from 'node:crypto';

const timeZone='America/Sao_Paulo';
const calendar=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const parts=stamp=>Object.fromEntries(calendar.formatToParts(new Date(stamp)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
export function dayWindow(stamp){
  const p=parts(stamp),day=p.year+'-'+p.month+'-'+p.day,target=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)+1);
  let resetAt=target+3*3600000;
  for(let i=0;i<3;i++){
    const q=parts(resetAt),offset=Date.UTC(Number(q.year),Number(q.month)-1,Number(q.day),Number(q.hour),Number(q.minute),Number(q.second))-resetAt;
    const next=target-offset;if(next===resetAt)break;resetAt=next;
  }
  return {day,resetAt,timeZone};
}
export class QuotaError extends Error{
  constructor(status,message,code,window){super(message);this.status=status;this.code=code;this.resetAt=window?.resetAt;}
}
export function quotaLimits(env){
  const setting=(name,fallback,max)=>{
    const raw=env[name],n=raw===undefined||raw===null||raw===''?fallback:Number(raw);
    if(!Number.isInteger(n)||n<1||n>max)throw new QuotaError(503,'O limite de criação precisa ser configurado pela IDY.','QUOTA_CONFIGURATION');return n;
  };
  const daily=setting('IDY_ARTWORK_DAILY_LIMIT',20,100),perIP=setting('IDY_ARTWORK_PER_IP_LIMIT',3,10);
  return {daily,perIP,attemptsDaily:daily*3,attemptsPerIP:perIP*4};
}
const used=job=>['starting','queued','completed','uncertain','unavailable'].includes(job.state);
const blank=window=>({version:2,day:window.day,resetAt:window.resetAt,attempts:0,ips:{},jobs:{}});

export function createQuota({store,limits,now=Date.now,uuid=randomUUID}){
  async function transaction(day,change){
    const key='quota-v2/'+day;
    for(let attempt=0;attempt<12;attempt++){
      const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
      const data=old?.data||blank(dayWindow(now()));
      const result=change(data);
      if(result.noWrite)return result.value;
      if((await store.setJSON(key,data,old?{onlyIfMatch:old.etag}:{onlyIfNew:true})).modified)return result.value;
    }
    throw new QuotaError(503,'A criação de prévias está ocupada. Tente novamente em instantes.','QUOTA_BUSY');
  }
  return {
    async reserve(ip){
      const window=dayWindow(now()),id=uuid();
      return transaction(window.day,data=>{
        for(const job of Object.values(data.jobs))if(['starting','queued'].includes(job.state)&&now()-job.createdAt>=1200000)job.state='uncertain';
        const all=Object.values(data.jobs),mine=all.filter(j=>j.ip===ip),globalUsed=all.filter(used).length,ipUsed=mine.filter(used).length;
        if(globalUsed>=limits.daily||ipUsed>=limits.perIP){
          const scope=globalUsed>=limits.daily?all:mine,limit=globalUsed>=limits.daily?limits.daily:limits.perIP;
          if(scope.filter(j=>j.state==='completed').length>=limit)throw new QuotaError(429,'O limite de prévias concluídas de hoje foi atingido. Ele renova à meia-noite, no horário de Brasília.','PREVIEW_DAILY_LIMIT',window);
          if(scope.some(j=>['starting','queued'].includes(j.state)))throw new QuotaError(429,'Há pedidos de arte em preparação. Aguarde a conclusão antes de iniciar outra prévia.','PREVIEW_PENDING',window);
          throw new QuotaError(429,'Há criações cujo resultado não pôde ser confirmado. Por segurança, a reserva desses pedidos fica mantida até a meia-noite, no horário de Brasília.','PREVIEW_UNCONFIRMED',window);
        }
        const ipData=data.ips[ip]||{attempts:0};
        if(data.attempts>=limits.attemptsDaily||ipData.attempts>=limits.attemptsPerIP)throw new QuotaError(429,'Houve muitas tentativas de criação hoje. Por segurança, tente novamente após a meia-noite, no horário de Brasília, ou fale com a equipe da IDY.','PREVIEW_ATTEMPT_LIMIT',window);
        data.attempts++;ipData.attempts++;data.ips[ip]=ipData;
        data.jobs[id]={ip,state:'starting',createdAt:now()};
        return {value:{id,day:window.day}};
      });
    },
    async settle(reservation,state,responseId){
      if(!reservation)return;
      if(!['queued','completed','failed','uncertain','unavailable'].includes(state))throw Error('Invalid quota state');
      return transaction(reservation.day,data=>{
        const job=data.jobs[reservation.id];if(!job)return {noWrite:true};
        if(job.responseId&&responseId&&job.responseId!==responseId)throw Error('Quota response mismatch');
        // Successful and confirmed failed jobs are terminal. Repeated polls cannot count/refund twice.
        if(['completed','failed'].includes(job.state))return {noWrite:true};
        job.state=state;job.updatedAt=now();if(responseId)job.responseId=responseId;
        return {value:undefined};
      });
    }
  };
}
