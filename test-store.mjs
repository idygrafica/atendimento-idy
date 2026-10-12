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
