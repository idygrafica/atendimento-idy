import {createIdleNotifier} from '../../lib/partial-leads.mjs';
export default async ()=>Response.json(await createIdleNotifier()());
export const config={schedule:'* * * * *'};
