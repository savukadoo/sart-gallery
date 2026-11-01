// Metadata only: full-size images are decoded and stored one at a time.
export const FIND_ART_BATCH_LIMIT=50;
export class FindArtSelection {
  constructor(){this.records=new Map();}
  get size(){return this.records.size;}
  has(id){return this.records.has(id);}
  values(){return [...this.records.values()];}
  clear(){this.records.clear();}
  remove(ids){for(const id of ids)this.records.delete(id);}
  add(record){
    if(!record||typeof record.id!=='string'||record.publicDomain!==true)return false;
    if(this.has(record.id))return true;
    if(this.size>=FIND_ART_BATCH_LIMIT)throw new Error('Select up to 50 images per download.');
    this.records.set(record.id,{...record});return true;
  }
  toggle(record){if(this.has(record.id)){this.records.delete(record.id);return false;}return this.add(record);}
}
export class FindArtBatch {
  constructor(){this.running=false;this.cancelled=false;}
  cancel(){this.cancelled=true;}
  async run(records,save,progress=()=>{}){
    if(this.running)throw new Error('A download is already running.');
    if(!records.length||records.length>FIND_ART_BATCH_LIMIT||new Set(records.map(r=>r.id)).size!==records.length)throw new Error('Choose between 1 and 50 different images.');
    const items=records.map(r=>({...r})),result={saved:[],skipped:[],failed:[],remaining:[],cancelled:false,stoppedReason:''};
    this.running=true;this.cancelled=false;
    try{
      for(let i=0;i<items.length;i++){
        if(this.cancelled)break;
        const item=items[i];try{progress({total:items.length,index:i+1,title:item.title,saved:result.saved.length,failed:result.failed.length});}catch{}
        try{
          // A durable save is acknowledged even if Stop arrives while committing.
          const status=await save(item,()=>!this.cancelled);
          if(status==='saved')result.saved.push(item.id);else if(status==='skipped')result.skipped.push(item.id);else throw new Error('This image could not be saved.');
        }catch(error){
          if(this.cancelled||error.name==='AbortError'){this.cancelled=true;break;}
          result.failed.push({id:item.id,title:item.title,error:String(error.message||error)});
          if(/gallery is full|200-photo limit|QuotaExceeded/i.test(String(error.name)+' '+error.message)){result.stoppedReason=error.message;break;}
        }
      }
      result.cancelled=this.cancelled;
      const done=new Set([...result.saved,...result.skipped]);result.remaining=items.filter(item=>!done.has(item.id));return result;
    }finally{this.running=false;}
  }
}
export function normaliseHiddenArtwork(value,bundled){
  const allowed=new Set(bundled.map(p=>p.id));return Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&allowed.has(id)))]:[];
}
