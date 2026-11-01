// Configuration only. New source types cannot introduce executable code or hosts.
export const FIND_SOURCE_NAMES={nga:'National Gallery of Art',artvee:'Artvee',met:'The Metropolitan Museum of Art'};
export const FIND_SOURCE_KEY='findArtSourcesV1',FIND_SOURCE_LIMIT=12;
const sourceOwn=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const sourceId=id=>typeof id==='string'&&(sourceOwn(FIND_SOURCE_NAMES,id)||/^commons-[a-f0-9-]{16,40}$/.test(id));
export function commonsCategory(value){
 let text=String(value||'').trim();
 if(/^https?:/i.test(text)){
  const u=new URL(text);
  if(u.protocol!=='https:'||u.hostname!=='commons.wikimedia.org'||u.port||u.username||u.password||u.search||u.hash||!u.pathname.startsWith('/wiki/Category:'))throw new Error('Use a Wikimedia Commons category URL, or its category name.');
  try{text=decodeURIComponent(u.pathname.slice('/wiki/'.length));}catch{throw new Error('That category address is not valid.');}
 }
 text=text.replace(/^Category:/i,'').replace(/_/g,' ').replace(/\s+/g,' ').trim();
 if(!text||text.length>160||/[\u0000-\u001f\u007f<>\[\]{}|#"\\]/.test(text)||text.includes('://'))throw new Error('Enter a category name of up to 160 characters.');
 return text[0].toUpperCase()+text.slice(1);
}
export function findSourceDraft(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Enter a name and a Wikimedia Commons category.');
 const id=value.id||'';if(id&&!/^commons-[a-f0-9-]{16,40}$/.test(id))throw new Error('This source cannot be edited.');
 const name=String(value.name||'').trim().replace(/\s+/g,' ');
 if(!name||name.length>60||/[\u0000-\u001f\u007f<>]/.test(name))throw new Error('Enter a source name of up to 60 characters.');
 return {id,name,kind:'commons',category:commonsCategory(value.category)};
}
export function normaliseFindSources(value){
 const rows=Array.isArray(value?.sources)?value.sources:[],sources=Object.entries(FIND_SOURCE_NAMES).map(([id,name])=>({id,name,kind:'builtin',enabled:rows.find(s=>s?.id===id)?.enabled!==false}));
 for(const row of rows){
  if(sources.length>=FIND_SOURCE_LIMIT)break;
  try{const d=findSourceDraft(row);if(!d.id||sources.some(s=>s.id===d.id||s.kind==='commons'&&s.category.toLowerCase()===d.category.toLowerCase()))continue;sources.push({...d,enabled:row.enabled!==false});}catch{}
 }
 const defaultId=sources.some(s=>s.id===value?.defaultId&&s.enabled)?value.defaultId:sources.find(s=>s.enabled)?.id||'';
 return {v:1,revision:Number.isSafeInteger(value?.revision)&&value.revision>=0?value.revision:0,defaultId,sources};
}
export const enabledFindSources=value=>normaliseFindSources(value).sources.filter(s=>s.enabled);
export const validFindSourceId=sourceId;
export function changeFindSources(value,action,newId){
 const state=normaliseFindSources(value);
 if(!action||action.revision!==state.revision)throw new Error('Sources changed on another screen. Refresh and try again.');
 const source=state.sources.find(s=>s.id===action.id);
 if(action.type==='enabled'){if(!source||typeof action.enabled!=='boolean')throw new Error('Choose a source.');source.enabled=action.enabled;}
 else if(action.type==='default'){if(!source?.enabled)throw new Error('Enable this source before choosing it as the default.');state.defaultId=source.id;}
 else if(action.type==='remove'){if(source?.kind!=='commons')throw new Error('Included sources can be turned off, but cannot be removed.');state.sources=state.sources.filter(s=>s.id!==source.id);}
 else if(action.type==='save'){
  const draft=findSourceDraft(action.draft),existing=state.sources.find(s=>s.id===draft.id);
  if(draft.id&&!existing)throw new Error('This source was removed. Refresh before editing.');
  if(state.sources.some(s=>s.id!==draft.id&&(s.name.toLowerCase()===draft.name.toLowerCase()||s.kind==='commons'&&s.category.toLowerCase()===draft.category.toLowerCase())))throw new Error('This source name or category is already in your list.');
  if(existing)Object.assign(existing,draft);
  else{if(state.sources.length>=FIND_SOURCE_LIMIT)throw new Error('You can keep up to 12 sources. Remove a custom source first.');if(!sourceId(newId)||sourceOwn(FIND_SOURCE_NAMES,newId))throw new Error('The source identifier could not be created.');state.sources.push({...draft,id:newId,enabled:true});}
 }else throw new Error('Choose a source action.');
 state.revision++;return normaliseFindSources(state);
}
// A successful test grants one short-lived save ticket for its exact draft and
// approved session. Atomic storage revision/abort guards are supplied by the app.
export class FindSourcesService{
 constructor({read,update,test,changed=()=>{}}){Object.assign(this,{read,update,test,changed});this.tickets=new Map();this.testing=false;}
 async snapshot(){return normaliseFindSources(await this.read());}
 async handle(action,body={},guard=()=>true){
  const current=()=>{if(!guard()||guard.signal?.aborted)throw new DOMException('The connection or screen was closed.','AbortError');};current();
  if(action==='list')return this.snapshot();
  if(action==='cancel'){if(this.testSession===(guard.session||'tv'))this.testAbort?.abort();return {cancelled:true};}
  if(action==='test'){
   if(this.testing)throw new Error('A source test is already running. Please wait.');
   const draft=body.builtin?{id:body.builtin,kind:'builtin'}:findSourceDraft(body.draft);
   if(draft.kind==='builtin'&&!sourceOwn(FIND_SOURCE_NAMES,draft.id))throw new Error('Choose a source.');
   this.testing=true;this.testSession=guard.session||'tv';const abort=this.testAbort=new AbortController(),cancel=()=>abort.abort();guard.signal?.addEventListener('abort',cancel,{once:true});
   try{
    const sample=await this.test(draft,abort.signal);current();if(abort.signal.aborted)throw new DOMException('Source test cancelled.','AbortError');
    for(const [key,value]of this.tickets)if(value.expires<Date.now())this.tickets.delete(key);
    const ticket=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const canonical=draft.kind==='commons'?findSourceDraft({...draft,category:sample.category}):draft;
    this.tickets.set(ticket,{draft:canonical,session:guard.session||'tv',expires:Date.now()+300000});while(this.tickets.size>8)this.tickets.delete(this.tickets.keys().next().value);
    return {ticket,draft:canonical,sample:{title:sample.title,rights:sample.rights,thumbnail:sample.thumbnail},message:'Search, preview and JPEG access checked.'};
   }finally{guard.signal?.removeEventListener('abort',cancel);this.testing=false;this.testAbort=null;this.testSession='';}
  }
  if(action!=='change')throw new Error('Unknown source action.');
  const change={...body};
  if(change.type==='save'){
   const ticket=this.tickets.get(change.ticket),draft=findSourceDraft(change.draft);
   if(!ticket||ticket.expires<Date.now()||ticket.session!==(guard.session||'tv')||JSON.stringify(ticket.draft)!==JSON.stringify(draft))throw new Error('Test this source before saving.');
  }
  current();const newId='commons-'+[...crypto.getRandomValues(new Uint8Array(12))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const value=await this.update(old=>{current();return changeFindSources(old,change,newId);},guard);
  if(change.ticket)this.tickets.delete(change.ticket);this.changed(value);return value;
 }
}
