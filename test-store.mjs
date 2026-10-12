import {createHmac,randomUUID} from 'node:crypto';
export async function testAttendance(store,secret,{now=Date.now(),id=randomUUID(),contact={nome:'Cliente fictício',whatsapp:'(51) 99999-0000',email:'cliente@example.invalid'},history=[]}={}){
  await store.setJSON('drafts/'+id,{id,contact,history,createdAt:now,lastActivity:now,state:'active',sequence:0});
  return id+'.'+createHmac('sha256',secret).update(id).digest('hex');
}
export class MemoryStore{
  values=new Map();version=0;
  async getWithMetadata(key){const value=this.values.get(key);return value?structuredClone(value):null;}
  async setJSON(key,data,options={}){
    const old=this.values.get(key);
    if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};
    this.values.set(key,{data:structuredClone(data),etag:String(++this.version)});return {modified:true};
  }
  async delete(key){this.values.delete(key);}
  async *list({prefix}){yield {blobs:[...this.values.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
}
