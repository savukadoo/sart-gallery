// Shared by the TV receiver and the phone page. No external services or libraries.
export const MOBILE_LIMITS=Object.freeze({photoBytes:12*1024*1024,sourceBytes:25*1024*1024,batch:50,collections:300,chunk:16384,buffer:262144});
export const mobileToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('');
export function mobileId(){const a=crypto.getRandomValues(new Uint8Array(16));a[6]=(a[6]&15)|64;a[8]=(a[8]&63)|128;const h=Array.from(a,v=>v.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
export const mobileName=(value,fallback='Untitled photograph',limit=120)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,limit)||fallback;
export const mobileCollectionId=id=>typeof id==='string'&&/^(?:light-water|japan-print|botanical-cabinet|shape-colour|my-photos|(?:mobile|museum)-[A-Za-z0-9-]{1,100})$/.test(id);
export function mobileCollections(value){
 if(!Array.isArray(value)||value.length>MOBILE_LIMITS.collections)throw new Error('The TV returned an invalid collection list.');
 const seen=new Set();return value.map(group=>{
  if(!group||!mobileCollectionId(group.id)||seen.has(group.id)||typeof group.name!=='string'||!group.name.trim()||group.name.length>80)throw new Error('The TV returned an invalid collection list.');
  const name=mobileName(group.name,'',80);if(!name)throw new Error('The TV returned an invalid collection list.');seen.add(group.id);return {id:group.id,name};
 });
}
export function mobileUploadCollection(meta,groups){
 const current=mobileCollections(groups).find(g=>g.id===meta.collectionId);
 if(meta.collectionMode==='existing'&&!current)throw new Error('That collection is no longer available. Refresh collections and try again.');
 return current||{id:meta.collectionId,name:mobileName(meta.collectionName,'My collection',80)};
}

// HTTPS uses WebCrypto. Keep the hash fallback for older packaged TV runtimes;
// it never permits a plaintext uploader or replaces TLS authentication.
export async function mobileHash(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(globalThis.crypto?.subtle)return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 return mobileSha256(bytes);
}
export function mobileSha256(bytes){
 const k=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
 const h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
 const length=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(length);data.set(bytes);data[bytes.length]=128;
 const view=new DataView(data.buffer);view.setUint32(length-8,Math.floor(bytes.length/0x20000000));view.setUint32(length-4,(bytes.length*8)>>>0);
 const w=new Uint32Array(64),ror=(v,n)=>(v>>>n)|(v<<(32-n));
 for(let offset=0;offset<length;offset+=64){
  for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
  for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(ror(x,7)^ror(x,18)^(x>>>3))+w[i-7]+(ror(y,17)^ror(y,19)^(y>>>10)))>>>0;}
  let[a,b,c,d,e,f,g,z]=h;
  for(let i=0;i<64;i++){const t1=(z+(ror(e,6)^ror(e,11)^ror(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((ror(a,2)^ror(a,13)^ror(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  [a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
 }
 return Array.from(h,v=>v.toString(16).padStart(8,'0')).join('');
}
export function validateMobilePhoto(value){
 const existing=value?.collectionMode==='existing',mode=value?.collectionMode;
 if(!value||value.v!==1||value.type!=='photo'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.id)||!Number.isSafeInteger(value.bytes)||value.bytes<4||value.bytes>MOBILE_LIMITS.photoBytes||!/^[a-f0-9]{64}$/.test(value.sha256)||typeof value.title!=='string'||value.title.length>120||(mode!==undefined&&!['existing','new'].includes(mode))||!(existing?mobileCollectionId(value.collectionId):/^mobile-[a-f0-9-]{36}$/.test(value.collectionId))||typeof value.collectionName!=='string'||!value.collectionName.trim()||value.collectionName.length>80)throw new Error('Invalid photo details. Choose the photos again.');
 return {...value,title:mobileName(value.title),collectionName:mobileName(value.collectionName,'My mobile photos',80)};
}
export function mobileJpegSize(bytes){
 if(bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new Error('That photo is not a complete JPEG.');
 for(let i=2;i+4<bytes.length;){
  if(bytes[i++]!==255)break;while(bytes[i]===255)i++;const marker=bytes[i++];if(marker===218||marker===217)break;
  const len=(bytes[i]<<8)|bytes[i+1];if(len<2||i+len>bytes.length)break;
  if([192,193,194].includes(marker)){if(len<8)break;const height=(bytes[i+3]<<8)|bytes[i+4],width=(bytes[i+5]<<8)|bytes[i+6];if(!width||!height||width>3840||height>2160)throw new Error('The display copy must fit within 3840 × 2160 pixels.');return {width,height};}
  i+=len;
 }
 throw new Error('That JPEG could not be read.');
}
export async function mobileIce(peer,timeout=4500){
 if(peer.iceGatheringState==='complete')return;
 await new Promise(resolve=>{const finish=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',change);resolve();},change=()=>{if(peer.iceGatheringState==='complete')finish();},timer=setTimeout(finish,timeout);peer.addEventListener('icegatheringstatechange',change);});
}

export function mobileReceiver(channel,{save,onProgress=()=>{},onSaved=()=>{},onError=()=>{},timeout=45000}){
 let active=null,busy=false,closed=false,timer,receivedCount=0;
 channel.binaryType='arraybuffer';
 const send=value=>{if(channel.readyState==='open')channel.send(JSON.stringify(value));};
 const reset=()=>{active=null;clearTimeout(timer);};
 const fail=message=>{reset();send({type:'error',message});onError(message);};
 const touch=()=>{clearTimeout(timer);timer=setTimeout(()=>fail('The transfer paused for too long. Please send that photo again.'),timeout);};
 const message=async event=>{
  if(closed)return;
  try{
   if(typeof event.data==='string'){
    if(event.data.length>4096)throw new Error('Invalid transfer message.');const value=JSON.parse(event.data);
    if(value.type==='cancel'){if(!busy){reset();send({type:'cancelled'});onProgress({phase:'cancelled'});}return;}
    if(value.type==='photo'){
     if(active||busy)throw new Error('Wait for the current photo to finish.');
     if(receivedCount>=200)throw new Error('Start a new connection to send more photos.');
     active={meta:validateMobilePhoto(value),parts:[],bytes:0};touch();send({type:'ready',id:value.id});onProgress({phase:'receiving',title:active.meta.title,bytes:0,total:active.meta.bytes});return;
    }
    if(value.type==='end'){
     if(!active||busy||value.id!==active.meta.id||active.bytes!==active.meta.bytes)throw new Error('The photo transfer was incomplete. Please try again.');
     busy=true;clearTimeout(timer);const current=active;active=null;
     try{
      const bytes=new Uint8Array(current.bytes);let offset=0;for(const part of current.parts){bytes.set(part,offset);offset+=part.byteLength;}current.parts=[];
      if(await mobileHash(bytes)!==current.meta.sha256)throw new Error('The photo failed its integrity check. Please try again.');
      if(closed)return;
      mobileJpegSize(bytes);onProgress({phase:'saving',title:current.meta.title,bytes:current.bytes,total:current.bytes});
      const saved=await save(current.meta,new Blob([bytes],{type:'image/jpeg'}));
      if(closed)return;
      receivedCount++;send({type:'saved',id:current.meta.id,status:saved?.alreadySaved?'existing':'added',...(saved?.alreadySaved?{existingId:saved.id,reason:saved.duplicateReason}:{})});onSaved(saved||current.meta);
     }finally{busy=false;}
     return;
    }
    throw new Error('Unknown transfer message.');
   }
   if(!(event.data instanceof ArrayBuffer)||!active||busy||event.data.byteLength<1||event.data.byteLength>MOBILE_LIMITS.chunk||active.bytes+event.data.byteLength>active.meta.bytes)throw new Error('Invalid photo chunk. Please try again.');
   active.parts.push(new Uint8Array(event.data));active.bytes+=event.data.byteLength;touch();onProgress({phase:'receiving',title:active.meta.title,bytes:active.bytes,total:active.meta.bytes});
  }catch(error){if(!closed)fail(error.message||'The photo could not be saved.');}
 };
 channel.addEventListener('message',message);
 const hello=()=>send({type:'hello',v:1,maxPhotoBytes:MOBILE_LIMITS.photoBytes});channel.addEventListener('open',hello);if(channel.readyState==='open')hello();
 const dispose=()=>{closed=true;reset();channel.removeEventListener('message',message);channel.removeEventListener('open',hello);};channel.addEventListener('close',dispose,{once:true});
 return {dispose,get busy(){return busy;}};
}

export class MobileSender{
 constructor(channel){this.channel=channel;this.pending=null;this.stopped=false;this.hello=false;
  channel.addEventListener('message',event=>{if(typeof event.data!=='string'||event.data.length>4096)return;let value;try{value=JSON.parse(event.data);}catch{return;}if(value.type==='hello')this.hello=value.v===1;const p=this.pending;if(p&&(value.type==='error'||(value.type===p.type&&(!p.id||value.id===p.id)))){this.pending=null;clearTimeout(p.timer);value.type==='error'?p.reject(new Error(value.message)):p.resolve(value);}});
  channel.addEventListener('close',()=>this.reject(new Error('The TV disconnected. Scan a new QR code to reconnect.')));
 }
 reject(error){if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(error);this.pending=null;}}
 wait(type,id='',timeout=45000){if(this.pending)throw new Error('A transfer is already running.');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending=null;reject(new Error('The TV did not confirm the photo. Reconnect and try again.'));},timeout);this.pending={type,id,resolve,reject,timer};});}
 cancel(){this.stopped=true;if(this.channel.readyState==='open')this.channel.send(JSON.stringify({type:'cancel'}));this.reject(new Error('Transfer cancelled. Photos already saved stay on the TV.'));}
 async send(photo,onProgress=()=>{}){
  this.stopped=false;const meta=validateMobilePhoto(photo.meta),data=new Uint8Array(await photo.blob.arrayBuffer());
  if(this.channel.readyState!=='open'||!this.hello)throw new Error('Wait for the TV connection before sending photos.');
  if(data.length!==meta.bytes)throw new Error('The display copy changed. Select the photo again.');
  let reply=this.wait('ready',meta.id);this.channel.send(JSON.stringify(meta));await reply;
  for(let offset=0;offset<data.length;offset+=MOBILE_LIMITS.chunk){
   const started=Date.now();while(this.channel.bufferedAmount>MOBILE_LIMITS.buffer){if(this.stopped)throw new Error('Transfer cancelled.');if(this.channel.readyState!=='open'||Date.now()-started>30000)throw new Error('The TV connection stalled. Reconnect and try again.');await new Promise(resolve=>setTimeout(resolve,20));}
   if(this.stopped)throw new Error('Transfer cancelled.');this.channel.send(data.subarray(offset,offset+MOBILE_LIMITS.chunk));onProgress(Math.min(data.length,offset+MOBILE_LIMITS.chunk),data.length);
  }
  reply=this.wait('saved',meta.id);this.channel.send(JSON.stringify({type:'end',id:meta.id}));return await reply;
 }
}
