import {directUploadSupport} from './compat.mjs';
import {mobileToken,mobileIce,mobileReceiver,mobileName,mobileCollections} from './mobile-shared.mjs';
import {tlsServerIdentity} from './mobile-identity.mjs';
import {mobileSetupAssets} from './mobile-setup.mjs';
export class MobileHost{
 constructor({onChange,save,collections=()=>[],sources}){this.onChange=onChange;this.save=save;this.collections=collections;this.sources=sources;this.phase='idle';this.saved=0;this.active=false;this.lastNotify=0;}
 emit(force=true){if(force||Date.now()-this.lastNotify>180){this.lastNotify=Date.now();this.onChange(this);}}
 async start(ip){
  this.close();const serial=this.startSerial;
  if(!directUploadSupport().supported)throw new Error('Direct photo uploads are unavailable on this TV. Your saved art is still available.');
  if(!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d/.test(ip))throw new Error('Connect the TV to your home network and try again.');
  const identity=await tlsServerIdentity(ip);
  if(serial!==this.startSerial)throw new DOMException('Connection closed.','AbortError');
  this.active=true;this.phase='starting';this.saved=0;this.skipped=0;this.savedIds=new Set();this.skippedIds=new Set();this.progress=null;this.receipt=null;this.error='';this.client='';this.offer=null;this.deviceName='';
  this.token=mobileToken();this.code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
  this.expires=Date.now()+600000;this.url='https://'+ip+':8768/#'+this.token;
  this.setupUrl='http://'+ip+':8769/';this.setupPhase='closed';this.setupError='';this.setupAssets=null;
  this.certificateName='SART TV '+identity.id.slice(0,8)+' Local Authority';this.rootFingerprint=identity.rootFingerprint;
  try{this.setupAssets=await mobileSetupAssets(identity);}catch(error){this.setupError=error.message;}
  if(serial!==this.startSerial)throw new DOMException('Connection closed.','AbortError');
  const worker=this.worker=new Worker('mobile-worker.js');
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('The TV’s mobile server did not start. Please try again.')),10000);
   worker.onerror=()=>{clearTimeout(timer);if(this.worker!==worker)return;this.close('error');this.error='The TV’s mobile server could not be loaded.';reject(new Error(this.error));this.emit();};
   worker.onmessage=event=>{if(this.worker!==worker)return;const message=event.data;
    if(message.type==='listening'){clearTimeout(timer);this.phase='waiting';resolve();this.emit();}
    else if(message.type==='request')void this.request(message);
    else if(message.type==='error'){clearTimeout(timer);this.error=message.message;this.phase='error';reject(new Error(message.message));this.emit();}
    else if(message.type==='expired'){this.close('expired');this.error='This connection has expired. Create a new QR code to connect again.';this.emit();}
    else if(message.type==='setup-listening'){this.setupPhase='ready';this.emit();}
    else if(message.type==='setup-error'){this.setupPhase='error';this.setupError=message.message;this.emit();}
   };
   worker.postMessage({type:'start',ip,port:8768,host:ip+':8768',token:this.token,identity});
  }).catch(error=>{if(this.worker!==worker)throw new DOMException('Connection closed.','AbortError');this.close('error');this.error=error.message;throw error;});
  this.expiryTimer=setInterval(()=>{if(this.active&&Date.now()>this.expires){this.close('expired');this.error='This connection has expired. Create a new QR code.';this.emit();}},1000);
 }
 openSetup(){
  if(!this.active||this.phase!=='waiting')return;
  if(this.setupPhase==='ready'){this.emit();return;}
  if(!this.setupAssets){this.setupPhase='error';this.emit();return;}
  this.setupPhase='starting';this.touch();this.emit();
  this.worker?.postMessage({type:'setup-open',host:new URL(this.setupUrl).host,assets:this.setupAssets});
 }
 closeSetup(){this.worker?.postMessage({type:'setup-close'});this.setupPhase='closed';}
 touch(){if(!this.active)return;this.expires=Date.now()+600000;if(Date.now()-(this.lastExtend||0)>10000){this.lastExtend=Date.now();this.worker?.postMessage({type:'extend'});}}
 async request(message){
  const worker=this.worker;
  let status=200,body;
  try{
   if(!this.active||Date.now()>this.expires){status=410;throw new Error('This connection has expired. Scan a new QR code.');}
   if(!/^[a-f0-9]{48}$/.test(message.client)){status=401;throw new Error('Scan the QR code again.');}
   if(message.path==='/api/pair'&&(!/^\d{6}$/.test(message.body.code)||message.body.code!==this.code)){status=401;throw new Error('That code does not match. Check the code on your TV.');}
   if(message.path==='/api/claim'||message.path==='/api/pair'){
    if(this.client&&this.client!==message.client){status=409;throw new Error('Another device is using this code. Ask the TV for a new code.');}
    if(!this.client){this.client=message.client;this.deviceName=mobileName(message.body.name,'A browser',40);this.closeSetup();this.phase='approval';this.emit();}
   }else if(this.client!==message.client){status=401;throw new Error('Scan the QR code or enter the TV code to connect this device.');}
   if(message.path==='/api/answer'){
    const answer=message.body.answer;
    if(this.phase!=='connecting'||!this.peer||!answer||answer.type!=='answer'||typeof answer.sdp!=='string'||answer.sdp.length>50000){status=409;throw new Error('Wait for approval on the TV, then reconnect.');}
    if(!this.peer.remoteDescription)await this.peer.setRemoteDescription(answer);
   }
   if(['/api/sources','/api/sources/test','/api/sources/change','/api/sources/cancel'].includes(message.path)){
    if(this.phase!=='connected'||!this.sources){status=403;throw new Error('Approve and connect this device on the TV first.');}
    const serial=this.startSerial,client=this.client,signal=this.uploadAbort?.signal;
    const current=Object.assign(()=>this.active&&this.worker===worker&&this.startSerial===serial&&this.client===client&&this.phase==='connected'&&!signal?.aborted,{signal,session:serial+':'+client});
    body=await this.sources(message.path==='/api/sources'?'list':message.path.endsWith('/test')?'test':message.path.endsWith('/cancel')?'cancel':'change',message.body,current);this.touch();
   }
   else if(message.path==='/api/collections'){
    if(this.phase!=='connected'){status=403;throw new Error('Approve and connect this device on the TV first.');}
    body={collections:mobileCollections(await this.collections())};this.touch();
   }
   else if(message.path==='/api/cancel'){body={phase:'closed'};setTimeout(()=>{if(this.worker===worker){this.close('closed');this.emit();}},300);}
   else body={phase:this.phase,code:this.code,expires:this.expires,saved:this.saved,offer:this.offer,error:this.error||'',...(message.path==='/api/pair'?{token:this.token}:{})};
  }catch(error){status=status===200?400:status;body={error:error.message};}
  if(this.worker===worker)worker?.postMessage({type:'response',id:message.id,status,body});
 }
 async approve(){
  if(!this.active||this.phase!=='approval')return;
  this.phase='connecting';this.touch();this.emit();
  const serial=this.startSerial,worker=this.worker;
  try{
   const peer=this.peer=new RTCPeerConnection({iceServers:[]});
   const abort=this.uploadAbort=new AbortController();
   const current=Object.assign(()=>this.active&&this.startSerial===serial&&this.peer===peer&&this.worker===worker&&!abort.signal.aborted,{signal:abort.signal});
   const channel=this.channel=peer.createDataChannel('sart-photos',{ordered:true});
   this.receiver=mobileReceiver(channel,{
    save:async(meta,blob)=>{if(!current())throw new DOMException('The connection was closed.','AbortError');return await this.save(meta,blob,current);},
    onProgress:progress=>{if(!current())return;this.progress=progress;this.touch();this.emit(false);},
    onSaved:photo=>{if(!current())return;if(photo.alreadySaved){this.skippedIds.add(photo.id);this.skipped=this.skippedIds.size;}else{this.savedIds.add(photo.id);this.saved=this.savedIds.size;}this.receipt={phase:photo.alreadySaved?'existing':'saved',title:photo.title,collectionName:photo.collectionName};this.progress=this.receipt;this.touch();this.emit();},
    onError:message=>{if(!current())return;this.progress={phase:'error',message};this.emit();}
   });
   channel.addEventListener('open',()=>{if(!this.active||this.peer!==peer)return;this.phase='connected';this.touch();this.emit();});
   channel.addEventListener('close',()=>{if(this.active&&this.peer===peer){this.close('disconnected');this.error='The device disconnected. Saved photos stay in your gallery.';this.emit();}});
   peer.addEventListener('connectionstatechange',()=>{if(this.active&&this.peer===peer&&peer.connectionState==='failed'){this.close('error');this.error='The direct connection failed. Use the same home Wi-Fi and avoid a guest network.';this.emit();}});
   await peer.setLocalDescription(await peer.createOffer());await mobileIce(peer);
   if(!current())return;this.offer={type:peer.localDescription.type,sdp:peer.localDescription.sdp};
   this.connectTimer=setTimeout(()=>{if(this.phase==='connecting'){this.close('error');this.error='Could not reach the device. Check that both devices use the same home Wi-Fi, then try a new code.';this.emit();}},60000);
  }catch(error){if(!this.active||this.startSerial!==serial||this.worker!==worker)return;this.close('error');this.error=error.message||'The connection could not be started.';this.emit();}
 }
 close(phase='closed'){
  this.startSerial=(this.startSerial||0)+1;
  this.uploadAbort?.abort();this.uploadAbort=null;
  this.active=false;clearTimeout(this.connectTimer);clearInterval(this.expiryTimer);this.receiver?.dispose();this.receiver=null;
  if(this.channel){try{this.channel.close();}catch{}this.channel=null;}
  if(this.peer){try{this.peer.close();}catch{}this.peer=null;}
  if(this.worker){const worker=this.worker;worker.postMessage({type:'stop'});setTimeout(()=>worker.terminate(),250);this.worker=null;}
  this.phase=phase;this.offer=null;this.token='';this.setupPhase='closed';this.setupAssets=null;
 }
}
