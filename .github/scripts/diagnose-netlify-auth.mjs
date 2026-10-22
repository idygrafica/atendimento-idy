
import { mkdir, writeFile } from 'node:fs/promises';
const token=process.env.NETLIFY_AUTH_TOKEN || '';
const siteId=process.env.NETLIFY_SITE_ID || '';
const report={readOnly:true,tokenConfigured:!!token,siteIdConfigured:!!siteId,tokenHasEdgeWhitespace:token!==token.trim(),tokenHasLineBreak:/[\r\n]/.test(token),checks:[]};
async function check(label,path,inspectSite=false){
  if(!token) {report.checks.push({label,skipped:'missing-token'});return;}
  try {
    const response=await fetch('https://api.netlify.com/api/v1'+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000),redirect:'error'});
    const entry={label,status:response.status};
    if(inspectSite&&response.ok){try {const body=await response.json();entry.expectedProject=body.name==='atendimento-idy';entry.expectedSiteId=body.id===siteId;entry.linkedRepository=!!body.build_settings?.repo_url;entry.publishedDeployReady=body.published_deploy?.state==='ready';}catch{entry.responseJsonReadable=false;}}
    else await response.body?.cancel();
    report.checks.push(entry);
  }catch{report.checks.push({label,requestFailed:true});}
}
await check('account-authentication','/user');
if(siteId&&/^[a-zA-Z0-9-]+$/.test(siteId))await check('target-project','/sites/'+siteId,true);
else report.checks.push({label:'target-project',skipped:'missing-or-invalid-id'});
await check('account-access','/accounts');
await mkdir('diagnostico-netlify',{recursive:true});
await writeFile('diagnostico-netlify/report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
