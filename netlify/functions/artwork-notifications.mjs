import {createArtworkNotifications} from '../../lib/artwork-notification.mjs';
export default async (req,context)=>{
  if(!context?.deploy?.published||context.deploy.context!=='production')return Response.json({skipped:true});
  const report=await createArtworkNotifications().processPending();
  console.log('ARTWORK_NOTIFICATIONS_RUN',JSON.stringify(report));return Response.json(report);
};
export const config={schedule:'* * * * *'};
