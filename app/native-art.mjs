import {requestTimeout} from './compat.mjs';
import {mobileId} from './mobile-shared.mjs';
import {nativeArtIds,nativePersonalArt} from './native-art-library.mjs';

export const NATIVE_ART_APP='org.tizen.art-app';
export const NATIVE_ART_ENDPOINT='wss://127.0.0.1:8002/api/v2/channels/com.samsung.art-app?name=U0FSVCBHYWxsZXJ5';
export function nativeArtEligible(info){
 const d=info?.device;
 return d?.modelName==='QA55LS03BAWXXY'&&String(d.FrameTVSupport).toLowerCase()==='true';
}
export function nativeArtHosts(data){
 const clients=Array.isArray(data?.clients)?data.clients:[];
 const hosts=[...new Set(clients.filter(c=>c&&c.isHost===true&&c.id!==data.id&&!c.attributes?.name&&typeof c.id==='string'&&c.id.length>0&&c.id.length<200).map(c=>c.id))];
 if(hosts.length>8)throw new Error('Samsung returned too many Art service connections. Restart Art Mode and try again.');
 return hosts;
}
export function nativeArtHost(data){
 const hosts=nativeArtHosts(data);
 if(hosts.length!==1)throw new Error('Samsung Art Mode is not ready. Open Art Mode once, then return to SART and try again.');
 return hosts[0];
}
export function nativeArtList(data){
 const records=typeof data?.content_list==='string'?JSON.parse(data.content_list):data?.content_list;
 if(!Array.isArray(records)||records.length>2000||records.some(x=>typeof x.content_id!=='string'))throw new Error('Samsung did not return a valid artwork list.');
 return records;
}
export function nativeArtTarget(data,ip,requiresKey=true){
 const info=typeof data?.conn_info==='string'?JSON.parse(data.conn_info):data?.conn_info;
 if(!info||!['127.0.0.1',ip].includes(info.ip)||!Number.isInteger(Number(info.port))||Number(info.port)<1024||Number(info.port)>65535)throw new Error('Samsung returned an unexpected artwork transfer address.');
 if(!(info.secured===true||String(info.secured).toLowerCase()==='true'))throw new Error('Samsung did not offer the verified encrypted Art transfer protocol.');
 if(requiresKey&&(!['string','number'].includes(typeof info.key)||String(info.key).length>256))throw new Error('Samsung returned an invalid artwork transfer key.');
 // COSS binds the TV's own assigned interface, rather than 127.0.0.1.
 // The worker independently verifies that this address belongs to this TV.
 return {ip,port:Number(info.port),key:info.key,secured:true};
}

export class NativeArtClient{
 constructor(scope=globalThis){this.scope=scope;this.pending=new Map();this.socket=null;this.host='';this.upload=null;this.connectCancel=null;}
 connect(){
  return new Promise((resolve,reject)=>{
   let ready=false,settled=false,selecting=false,hosts=[];
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);this.connectCancel=null;if(error){this.close(error);reject(error);}else resolve(this);};
   const timer=setTimeout(()=>finish(new Error('Samsung Art Mode did not answer. Open Art Mode once, then return to SART.')),8000);
   this.connectCancel=finish;
   const selectHost=async()=>{
    if(!ready||settled||selecting||!hosts.length)return;
    if(hosts.length===1){this.host=hosts[0];finish();return;}
    selecting=true;
    // Multiple internal Art clients can be active on one TV. Probe only API
    // version, then keep one verified route for every subsequent operation.
    const replies=await Promise.allSettled(hosts.map(host=>this.probeHost(host)));
    if(settled||this.socket!==socket)return;
    const selected=replies.find(r=>r.status==='fulfilled'&&r.value.data?.event==='api_version'&&/^4\.3\.\d+(?:\.\d+)*$/.test(r.value.data.version||''));
    if(!selected){finish(new Error('Samsung Art Mode did not return a verified Art service. Open Art Mode and try again.'));return;}
    this.host=selected.value.host;finish();
   };
   let socket;try{socket=new this.scope.WebSocket(NATIVE_ART_ENDPOINT);this.socket=socket;}catch(error){finish(error);return;}
   socket.onmessage=event=>{
    try{
     const frame=JSON.parse(event.data),data=typeof frame.data==='string'?JSON.parse(frame.data):frame.data;
     if(frame.event==='ms.channel.connect'){hosts=nativeArtHosts(data);if(!hosts.length)throw new Error('Samsung Art Mode is not ready. Open Art Mode once, then return to SART and try again.');}
     if(frame.event==='ms.channel.ready')ready=true;
     if(!settled)void selectHost();
     if(frame.event==='ms.channel.unauthorized')finish(new Error('Samsung declined the Art Mode connection.'));
     if(frame.event==='d2d_service_message')this.receive(data);
    }catch(error){if(!settled)finish(error);else this.close(error);}
   };
   socket.onerror=()=>finish(new Error('The secure Samsung Art connection could not open.'));
   socket.onclose=()=>{const error=new Error('The Samsung Art connection closed.');finish(error);this.rejectPending(error);};
  });
 }
 probeHost(host){
  const id=mobileId();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Art service did not answer its version check.'));},1500);
   this.pending.set(id,{resolve:data=>resolve({host,data}),reject,timer,request:'api_version',probe:true});
   try{this.socket.send(JSON.stringify({method:'ms.channel.emit',params:{event:'art_app_request',to:host,data:JSON.stringify({request:'api_version',id,request_id:id})}}));}
   catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 receive(data){
  if(!data||typeof data!=='object')return;
  const id=data.request_id||data.id;
  let pending=this.pending.get(id),pendingId=id;
  if(!pending&&data.event==='art_mode_changed'&&(data.status||data.value)==='on'){
   const entry=[...this.pending.entries()].find(([,p])=>p.request==='set_artmode_status'&&p.value==='on');
   if(entry){pendingId=entry[0];pending=entry[1];}
  }
  if(data.event==='error'){
   const error=new Error('Samsung Art Mode declined the request'+(Number.isFinite(data.error_code)?' ('+data.error_code+')':'')+'.');
   if(pending){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(error);}
   if(this.upload&&(!id||id===this.upload.id))this.finishUpload(error);
   return;
  }
  if(pending?.probe&&data.event!=='api_version')return;
  if(pending){clearTimeout(pending.timer);this.pending.delete(pendingId);pending.resolve(data);}
  if(data.event==='image_added'&&this.upload)this.finishUpload(null,data);
 }
 request(request,fields={},timeout=6000,id=mobileId()){
  return new Promise((resolve,reject)=>{
   if(!this.socket||!this.host){reject(new Error('Samsung Art Mode is disconnected.'));return;}
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Samsung Art Mode did not confirm '+request+'.'));},timeout);
   this.pending.set(id,{resolve,reject,timer,request,value:fields.value});
   try{this.socket.send(JSON.stringify({method:'ms.channel.emit',params:{event:'art_app_request',to:this.host,data:JSON.stringify({...fields,request,id,request_id:id})}}));}
   catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 waitUpload(id){
  if(this.upload)throw new Error('An artwork is already being transferred.');
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.finishUpload(new Error('Samsung did not confirm that the artwork was saved.')),45000);this.upload={id,resolve,reject,timer};});
 }
 finishUpload(error,data){const upload=this.upload;if(!upload)return;this.upload=null;clearTimeout(upload.timer);error?upload.reject(error):upload.resolve(data);}
 rejectPending(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.finishUpload(error);}
 close(error=new Error('Art Mode transfer cancelled.')){
  const cancel=this.connectCancel;this.connectCancel=null;cancel?.(error);
  this.rejectPending(error);const socket=this.socket;this.socket=null;this.host='';
  if(socket){socket.onmessage=socket.onerror=socket.onclose=null;try{socket.close();}catch{}}
 }
}

export class NativeArt{
 constructor(scope=globalThis){this.scope=scope;this.support={supported:false};this.client=null;this.transferCancel=null;this.generation=0;}
 async identity(){
  if(!this.scope.tizen?.application)return null;
  const deadline=requestTimeout(4000,this.scope);
  try{const response=await this.scope.fetch('http://127.0.0.1:8001/api/v2/',{signal:deadline.signal});if(!response.ok)throw new Error('TV identity unavailable.');const info=await response.json();if(!nativeArtEligible(info))return null;const app=this.scope.tizen.application.getAppInfo(NATIVE_ART_APP);if(app.id!==NATIVE_ART_APP)return null;return info.device;}
  finally{deadline.cancel();}
 }
 release(client){client?.close();if(this.client===client)this.client=null;}
 async open(expected=this.generation){
  const identity=await this.identity();if(expected!==this.generation)throw new Error('Art Mode request cancelled.');if(!identity)throw new Error('Samsung Art Mode is unavailable on this TV.');
  const client=new NativeArtClient(this.scope);this.client=client;
  try{await client.connect();const version=await client.request('api_version');if(!/^4\.3\./.test(version.version||''))throw new Error('This Samsung Art Mode version has not been verified.');const mode=await client.request('get_artmode_status');if(!['on','off','nav'].includes(mode.value))throw new Error('Samsung did not confirm its Art Mode status.');return {model:identity.modelName,ip:identity.ip,apiVersion:version.version,mode:mode.value};}
  catch(error){this.release(client);throw error;}
 }
 socketWorker(message,transfer=[]){
  return new Promise((resolve,reject)=>{
   const worker=new this.scope.Worker('native-art-worker.js');let settled=false;
   const finish=(error,data)=>{if(settled)return;settled=true;clearTimeout(timer);this.transferCancel=null;worker.terminate();error?reject(error):resolve(data);};
   const timer=setTimeout(()=>finish(new Error('The native artwork transfer timed out.')),45000);
   this.transferCancel=()=>finish(new Error('Art Mode transfer cancelled.'));
   worker.onerror=()=>finish(new Error('The native artwork transfer could not start.'));
   worker.onmessage=event=>{const data=event.data;if(data.type==='ready'){if(!data.available){finish(new Error('Native Art transfer is unavailable on this TV.'));return;}if(message.type==='probe'){finish(null,true);return;}worker.postMessage(message,transfer);}else if(data.type==='done')finish(null,data.images||true);else if(data.type==='error')finish(new Error(data.message));};
  });
 }
 async detect(){
  try{const info=await this.open();await this.socketWorker({type:'probe'});this.support={supported:true,...info};}
  catch{this.support={supported:false};}
  finally{this.client?.close();this.client=null;}
  return this.support;
 }
 cancel(){this.generation++;this.transferCancel?.();this.client?.close();this.client=null;}
 async library(){
  const generation=++this.generation;let client;
  try{await this.open();if(generation!==this.generation)throw new Error('Native library request cancelled.');client=this.client;const items=nativePersonalArt(nativeArtList(await client.request('get_content_list',{category_id:'MY-C0002'}))),current=await client.request('get_current_artwork');if(generation!==this.generation)throw new Error('Native library request cancelled.');return {items,currentId:current.content_id};}
  finally{this.release(client);}
 }
 async thumbnails(ids){
  ids=nativeArtIds(ids,6);const generation=++this.generation;let client;
  try{
   const info=await this.open();if(generation!==this.generation)throw new Error('Native previews cancelled.');client=this.client;const id=mobileId(),random=new Uint32Array(1);this.scope.crypto.getRandomValues(random);
   const response=await client.request('get_thumbnail_list',{content_id_list:ids.map(content_id=>({content_id})),conn_info:{d2d_mode:'socket',connection_id:random[0]||1,id}},6000,id);
   if(generation!==this.generation)throw new Error('Native previews cancelled.');
   const images=await this.socketWorker({type:'receive',target:nativeArtTarget(response,info.ip,false),ids});if(generation!==this.generation)throw new Error('Native previews cancelled.');return images;
  }finally{this.release(client);}
 }
 async remove(ids){
  ids=nativeArtIds(ids);const generation=++this.generation;let client;
  try{
   await this.open();if(generation!==this.generation)throw new Error('Native deletion cancelled.');client=this.client;const before=nativePersonalArt(nativeArtList(await client.request('get_content_list',{category_id:'MY-C0002'})));
   if(generation!==this.generation)throw new Error('Native deletion cancelled.');if(ids.some(id=>!before.some(p=>p.content_id===id)))throw new Error('The Samsung Art collection changed. Refresh before deleting.');
   await client.request('delete_image_list',{content_id_list:ids.map(content_id=>({content_id}))});
   const after=nativePersonalArt(nativeArtList(await client.request('get_content_list',{category_id:'MY-C0002'})));
   if(ids.some(id=>after.some(p=>p.content_id===id))||before.some(p=>!ids.includes(p.content_id)&&!after.some(a=>a.content_id===p.content_id)))throw new Error('Samsung did not confirm the expected deletion. Refresh to check the collection.');return {removed:ids,items:after};
  }finally{this.release(client);}
 }
 async showExisting(contentId,options={}){
  nativeArtIds([contentId]);const generation=++this.generation;await this.open();const client=this.client;
  try{const items=nativePersonalArt(nativeArtList(await client.request('get_content_list',{category_id:'MY-C0002'})));if(generation!==this.generation)throw new Error('Native Art request cancelled.');if(!items.some(p=>p.content_id===contentId))throw new Error('This copy is no longer in Samsung Art. Refresh to add it again.');return await this.show(contentId,options);}
  catch(error){this.release(client);throw error;}
 }
 async save(bytes,cachedId){
  const generation=++this.generation;const active=()=>{if(generation!==this.generation)throw new Error('Art Mode transfer cancelled.');};
  try{
   const info=await this.open();active();
   if(!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>12*1024*1024||bytes[0]!==255||bytes[1]!==216)throw new Error('Choose a JPEG artwork under 12 MB.');
   const before=nativeArtList(await this.client.request('get_content_list',{category_id:'MY-C0002'}));active();
   if(cachedId&&before.some(x=>x.content_id===cachedId))return {contentId:cachedId,reused:true,info};
   const id=mobileId(),added=this.client.waitUpload(id);added.catch(()=>{});
   const random=new Uint32Array(1);this.scope.crypto.getRandomValues(random);
   const date=new Date().toISOString().slice(0,19).replace('T',' ').replace(/-/g,':');
   const ready=await this.client.request('send_image',{file_type:'jpg',file_size:bytes.length,image_date:date,matte_id:'none',portrait_matte_id:'none',conn_info:{d2d_mode:'socket',connection_id:random[0]||1,id}},10000,id);active();
   const target=nativeArtTarget(ready,info.ip);
   const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
   await this.socketWorker({type:'send',target,buffer},[buffer]);active();
   const result=await added;active();
   if(typeof result.content_id!=='string'||before.some(x=>x.content_id===result.content_id))throw new Error('Samsung did not confirm a new artwork copy.');
   const after=nativeArtList(await this.client.request('get_content_list',{category_id:'MY-C0002'}));active();
   if(!after.some(x=>x.content_id===result.content_id)||before.some(x=>!after.some(y=>y.content_id===x.content_id)))throw new Error('The native artwork library could not be verified.');
   return {contentId:result.content_id,reused:false,info};
  }catch(error){if(generation===this.generation)this.cancel();throw error;}
 }
 async show(contentId,{noMat=false}={}){
  const generation=this.generation;
  if(!this.client)await this.open(generation);
  const client=this.client,active=()=>{if(generation!==this.generation||this.client!==client)throw new Error('Native Art request cancelled.');};
  const plain=value=>['none','none_none'].includes(String(value).toLowerCase()),none=p=>p&&plain(p.matte_id)&&plain(p.portrait_matte_id);
  try{
  active();
  if(noMat){
   nativeArtIds([contentId]);
   let items=nativePersonalArt(nativeArtList(await client.request('get_content_list',{category_id:'MY-C0002'}))),photo=items.find(p=>p.content_id===contentId);active();
   if(!photo)throw new Error('The styled copy is no longer in Samsung Art.');
   if(!none(photo)){
    // This Frame rejects a redundant portrait change. Its success reply can
    // precede the stored library update, so verify with a bounded retry.
    await client.request('change_matte',{content_id:contentId,matte_id:'none',...(!plain(photo.portrait_matte_id)?{portrait_matte_id:'none'}:{})});active();
    for(let attempt=0;attempt<6;attempt++){
     items=nativePersonalArt(nativeArtList(await client.request('get_content_list',{category_id:'MY-C0002'})));photo=items.find(p=>p.content_id===contentId);active();
     if(none(photo)||!photo||attempt===5)break;
     await new Promise(resolve=>setTimeout(resolve,250));active();
    }
    if(!none(photo))throw new Error('Samsung could not remove its extra mat. Your SART copy remains saved.');
   }
  }
  let current=await client.request('get_current_artwork');active();
  if(current.content_id!==contentId||noMat){
   await client.request('select_image',{content_id:contentId,category_id:'MY-C0002',show:false});active();
   current=await client.request('get_current_artwork');active();
  }
  if(current.content_id!==contentId)throw new Error('Samsung did not confirm the selected artwork.');
  if(noMat&&!none(current))throw new Error('Samsung did not confirm a mat-free display of this styled copy.');
  // Ask the native Art service to enter Art Mode itself, rather than merely
  // bringing its application window forward. It owns power/sensor behaviour.
  await client.request('set_artmode_status',{value:'on'});active();
  }finally{this.release(client);}
 }
}
