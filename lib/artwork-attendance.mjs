import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';

export const HUMAN_WHATSAPP='5551981687562';
export const HUMAN_MESSAGE='Olá! Vim pelo Atendimento com IA da IDY Gráfica e gostaria de falar com um atendente.';
export const humanUrl='https://wa.me/'+HUMAN_WHATSAPP+'?text='+encodeURIComponent(HUMAN_MESSAGE);
export class AttendanceError extends Error{
  constructor(status,message,code){super(message);this.status=status;this.code=code;}
}
function verify(secret,ticket){
  const [id,sig,...extra]=String(ticket||'').split('.');
  if(extra.length||!/^[0-9a-f-]{36}$/.test(id)||!/^[0-9a-f]{64}$/.test(sig||''))throw new AttendanceError(403,'Inicie seu atendimento antes de criar a prévia.','ATTENDANCE_REQUIRED');
  const expected=createHmac('sha256',secret).update(id).digest('hex');
  if(!timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))throw new AttendanceError(403,'Atendimento não autorizado.','ATTENDANCE_REQUIRED');return id;
}
async function defaultStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-partial-leads',consistency:'strong'});}
export function createAttendanceGate({secret,storeFactory=defaultStore,now=Date.now,uuid=randomUUID}){
  async function change(attendanceId,edit){
    const store=await storeFactory(),key='drafts/'+attendanceId;
    for(let attempt=0;attempt<12;attempt++){
      const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});
      if(!old||now()-old.data.createdAt>30*86400000)throw new AttendanceError(410,'Este atendimento expirou. Inicie uma nova conversa.','ATTENDANCE_EXPIRED');
      const result=edit(old.data);if(result.noWrite)return result.value;
      if((await store.setJSON(key,old.data,{onlyIfMatch:old.etag})).modified)return result.value;
    }throw new AttendanceError(503,'Não consegui confirmar a prévia deste atendimento. Tente novamente em instantes.','ATTENDANCE_BUSY');
  }
  return {
    async reserve(ticket){
      const attendanceId=verify(secret,ticket),id=uuid();
      return change(attendanceId,data=>{
        if(data.state==='completed')throw new AttendanceError(409,'Este atendimento já foi encaminhado. A equipe humana pode ajudar com a arte.','ATTENDANCE_COMPLETED');
        const art=data.artwork;
        if(art?.state==='completed')throw new AttendanceError(409,'A única prévia de arte disponível para este atendimento já foi utilizada. Para novas propostas ou ajustes, fale com o atendimento humano.','ARTWORK_ALREADY_USED');
        if(['queued','uncertain'].includes(art?.state)&&art.responseId&&art.quota)return {noWrite:true,value:{id:art.id,attendanceId,existing:true,responseId:art.responseId,quota:art.quota,contact:data.contact,history:data.history}};
        if(art&&['starting','queued','uncertain','unavailable'].includes(art.state))throw new AttendanceError(409,'A prévia deste atendimento está em preparação ou ainda precisa ter o resultado confirmado. Não vou iniciar outra geração. Você pode falar com o atendimento humano.','ARTWORK_PENDING');
        data.artwork={id,state:'starting',startedAt:now()};
        return {value:{id,attendanceId,contact:data.contact,history:data.history}};
      });
    },
    async settle(claim,state,responseId,quota){
      if(!claim)return;
      return change(claim.attendanceId,data=>{
        const art=data.artwork;if(!art||art.id!==claim.id)throw new AttendanceError(409,'A prévia não pertence a este atendimento.','ARTWORK_MISMATCH');
        if(art.responseId&&responseId&&art.responseId!==responseId)throw new AttendanceError(409,'A prévia não pertence a este atendimento.','ARTWORK_MISMATCH');
        if(['completed','failed'].includes(art.state))return {noWrite:true};
        Object.assign(art,{state,updatedAt:now()});if(responseId)art.responseId=responseId;if(quota)art.quota=quota;
        if(state==='completed')art.usedAt=now();return {value:undefined};
      });
    },
    async details(claim){
      return change(claim.attendanceId,data=>{
        if(data.artwork?.id!==claim.id)throw new AttendanceError(403,'Prévia não autorizada.','ARTWORK_MISMATCH');
        return {noWrite:true,value:{attendanceId:claim.attendanceId,contact:data.contact,history:data.history}};
      });
    }
  };
}
