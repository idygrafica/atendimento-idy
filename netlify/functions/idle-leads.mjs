import {createIdleNotifier} from '../../lib/partial-leads.mjs';
export default async (req,context)=>{
  if(!context?.deploy?.published||context.deploy.context!=='production')return Response.json({skipped:true});
  const report=await createIdleNotifier({env:{...process.env,CONTEXT:context.deploy.context}})();
  console.log('IDLE_LEADS_RUN',JSON.stringify(report));
  return Response.json(report);
};
export const config={schedule:'* * * * *'};
