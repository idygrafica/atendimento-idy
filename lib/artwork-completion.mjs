import {createAttendanceGate} from './artwork-attendance.mjs';
import {createQuota,quotaLimits} from './artwork-quota.mjs';
import {createArtworkNotifications} from './artwork-notification.mjs';
import {resultImage} from './artwork-result.mjs';

async function notificationStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-artwork-notifications',consistency:'strong'});}
async function quotaStore(){const {getStore}=await import('@netlify/blobs');return getStore({name:'idy-artwork-usage',consistency:'strong'});}
export function createArtworkCompletion({env=process.env,now=Date.now,fetchImpl=fetch,whatsappFetchImpl=fetch,notificationStoreFactory=notificationStore,quotaStoreFactory=quotaStore,attendanceStoreFactory}={}){
  const gate=createAttendanceGate({secret:env.OPENAI_API_KEY,storeFactory:attendanceStoreFactory,now}),notifications=createArtworkNotifications({storeFactory:notificationStoreFactory,env,now,fetchImpl:whatsappFetchImpl});
  async function edit(id,change){
    const store=await notificationStoreFactory(),key='generations/'+id;
    for(let attempt=0;attempt<12;attempt++){
      const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});const data=old?.data||null,result=change(data);
      if(result.skip)return data;
      if((await store.setJSON(key,result.data,old?{onlyIfMatch:old.etag}:{onlyIfNew:true})).modified)return result.data;
    }throw Error('Acompanhamento de arte ocupado');
  }
  const api={
    async track(claim,responseId,quota){
      const details=claim.contact?claim:await gate.details(claim);
      return edit(claim.attendanceId,old=>old?.responseId===responseId?{skip:true}:{data:{id:claim.attendanceId,claim:{id:claim.id,attendanceId:claim.attendanceId},responseId,quota,contact:{nome:details.contact?.nome,whatsapp:details.contact?.whatsapp},history:details.history,createdAt:now(),state:'pending',lastCheckedAt:0}});
    },
    async finish(claim,state){
      if(!claim)return;
      return edit(claim.attendanceId,old=>!old||old.claim.id!==claim.id?{skip:true}:{data:{...old,state,finishedAt:now()}});
    },
    async snapshot(claim){
      const old=await(await notificationStoreFactory()).getWithMetadata('generations/'+claim.attendanceId,{type:'json',consistency:'strong'});
      if(old?.data.claim.id===claim.id)return {attendanceId:claim.attendanceId,contact:old.data.contact,history:old.data.history};
      return gate.details(claim);
    },
    async processPending(){
      const store=await notificationStoreFactory(),candidates=[],started=Date.now();
      for await(const page of store.list({prefix:'generations/',paginate:true})){
        for(const {key} of page.blobs){
          if(Date.now()-started>3000||candidates.length>=100)break;
          const old=await store.getWithMetadata(key,{type:'json',consistency:'strong'});if(!old)continue;
          if(now()-old.data.createdAt>30*86400000){await store.delete(key);continue;}
          if(old.data.state==='pending'&&!(old.data.nextCheckAt>now()))candidates.push(old.data);
        }
        if(Date.now()-started>3000||candidates.length>=100)break;
      }
      candidates.sort((a,b)=>a.lastCheckedAt-b.lastCheckedAt||a.createdAt-b.createdAt);
      const job=candidates[0];if(!job)return {processed:false};
      const current=await edit(job.id,old=>!old||old.claim.id!==job.claim.id||old.state!=='pending'?{skip:true}:{data:{...old,lastCheckedAt:now(),nextCheckAt:now()+60000}});
      if(!current||current.claim.id!==job.claim.id||current.state!=='pending')return {processed:false};
      const report={processed:true,generated:false,notification:'pending'};
      let response,data;
      try{
        response=await fetchImpl('https://api.openai.com/v1/responses/'+job.responseId,{headers:{Authorization:'Bearer '+env.OPENAI_API_KEY},signal:AbortSignal.timeout(7000)});
        if(!response.ok)return report;data=await response.json();
      }catch{return report;}
      if(['queued','in_progress'].includes(data.status))return report;
      const quota=createQuota({store:await quotaStoreFactory(),limits:quotaLimits(env),now});
      const item=data.output?.find(o=>o.type==='image_generation_call'&&o.result);
      const settle=async state=>{await gate.settle(job.claim,state,job.responseId,job.quota);await quota.settle(job.quota,state,job.responseId);await api.finish(job.claim,state);};
      if(['failed','cancelled','incomplete'].includes(data.status)){await settle(item?'unavailable':'failed');return {...report,failed:true};}
      if(data.status!=='completed')return report;
      if(!item){await settle('failed');return {...report,failed:true};}
      let image;try{image=resultImage(item.result);}catch{await settle('unavailable');return {...report,failed:true};}
      await notifications.enqueue({attendanceId:job.id,responseId:job.responseId,image,contact:job.contact,history:job.history});
      await settle('completed');report.generated=true;report.notification=await notifications.process(job.id);return report;
    }
  };return api;
}
