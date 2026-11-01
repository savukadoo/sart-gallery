import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {mobileSha256,mobileHash,mobileId,mobileToken,validateMobilePhoto,mobileReceiver,MobileSender,mobileJpegSize,MOBILE_LIMITS,mobileCollections,mobileUploadCollection} from '../app/mobile-shared.mjs';
import {mobileParseRequest,mobileHttpResponse} from '../app/mobile-http.mjs';
import {MobileHost} from '../app/mobile-host.mjs';
const jpeg=new Uint8Array(await readFile(new URL('../app/assets/16568.jpg',import.meta.url)));
const photo=()=>({v:1,type:'photo',id:mobileId(),bytes:jpeg.length,sha256:createHash('sha256').update(jpeg).digest('hex'),title:'My photograph',collectionId:'mobile-'+mobileId(),collectionName:'Weekend moments'});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
class Channel extends EventTarget{
 constructor(){super();this.readyState='open';this.bufferedAmount=0;this.sent=[];}
 send(data){if(this.readyState!=='open')throw new Error('closed');this.sent.push(data);const copy=ArrayBuffer.isView(data)?data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength):data;queueMicrotask(()=>this.other?.dispatchEvent(new MessageEvent('message',{data:copy})));}
 close(){this.readyState='closed';this.dispatchEvent(new Event('close'));}
}
function channels(){const a=new Channel(),b=new Channel();a.other=b;b.other=a;return [a,b];}
test('closing and reopening an upload invalidates delayed saves and stale receipts',async t=>{
 const original=globalThis.RTCPeerConnection,[phone,tv]=channels();
 globalThis.RTCPeerConnection=class extends EventTarget{constructor(){super();this.iceGatheringState='complete'}createDataChannel(){return tv}async createOffer(){return{type:'offer',sdp:'fixture'}}async setLocalDescription(d){this.localDescription=d}close(){}};
 let release,entered=false,commits=0;const gate=new Promise(r=>release=r);
 const host=new MobileHost({onChange(){},save:async(meta,blob,current)=>{entered=true;await gate;if(!current()||current.signal.aborted)throw new DOMException('closed','AbortError');commits++;return meta;}});
 Object.assign(host,{active:true,phase:'approval',savedIds:new Set(),skippedIds:new Set(),saved:0,skipped:0,worker:{postMessage(){},terminate(){}}});
 t.after(()=>{host.close();phone.close();globalThis.RTCPeerConnection=original});
 const sender=new MobileSender(phone);await host.approve();const transfer=sender.send({meta:photo(),blob:new Blob([jpeg],{type:'image/jpeg'})}).catch(()=>{});
 const deadline=Date.now()+2000;while(!entered){assert.ok(Date.now()<deadline,'save was entered');await delay(1);}
 host.close();phone.close();Object.assign(host,{active:true,phase:'waiting',savedIds:new Set(),skippedIds:new Set(),receipt:null,worker:{postMessage(){},terminate(){}}});release();await transfer;await delay(5);
 assert.equal(commits,0);assert.equal(host.receipt,null);assert.equal(host.savedIds.size,0);assert.equal(host.phase,'waiting');
});
test('TV receipt names the stored image and canonical collection only after commit, and survives the next transfer',async t=>{
 const original=globalThis.RTCPeerConnection,[phone,tv]=channels();
 globalThis.RTCPeerConnection=class extends EventTarget{constructor(){super();this.iceGatheringState='complete'}createDataChannel(){return tv}async createOffer(){return {type:'offer',sdp:'fixture'}}async setLocalDescription(d){this.localDescription=d}close(){}};
 let commit,duplicate=false;
 const host=new MobileHost({onChange(){},save:async(meta)=>{if(!duplicate)await new Promise(r=>commit=r);return {...meta,title:'Stored sunset',collectionName:'TV collection',alreadySaved:duplicate}}});
 t.after(()=>{host.close();globalThis.RTCPeerConnection=original});host.active=true;host.phase='approval';host.savedIds=new Set();host.skippedIds=new Set();host.saved=0;host.skipped=0;
 const sender=new MobileSender(phone);await host.approve();await delay(0);
 const first=sender.send({meta:photo(),blob:new Blob([jpeg],{type:'image/jpeg'})});while(!commit)await delay(1);
 assert.equal(host.receipt,undefined);commit();await first;
 assert.deepEqual(host.receipt,{phase:'saved',title:'Stored sunset',collectionName:'TV collection'});
 duplicate=true;const next=photo();phone.send(JSON.stringify(next));await delay(1);
 assert.equal(host.progress.phase,'receiving');assert.equal(host.receipt.title,'Stored sunset');phone.send(JSON.stringify({type:'cancel'}));await delay(1);
 await sender.send({meta:photo(),blob:new Blob([jpeg],{type:'image/jpeg'})});assert.equal(host.receipt.phase,'existing');assert.equal(host.receipt.collectionName,'TV collection');assert.equal(host.saved,1);assert.equal(host.skipped,1);
});
test('SHA-256 fallback matches published vectors and WebCrypto for display-sized bytes',async()=>{
 for(const value of ['', 'abc','hello 🌿', 'a'.repeat(1000000)]){const bytes=new TextEncoder().encode(value),expected=createHash('sha256').update(bytes).digest('hex');assert.equal(mobileSha256(bytes),expected);assert.equal(await mobileHash(bytes),expected);}
 assert.equal(mobileSha256(jpeg),createHash('sha256').update(jpeg).digest('hex'));
});
test('mobile metadata has bounded dimensions, size, IDs and collection names',()=>{
 const p=photo();assert.equal(validateMobilePhoto(p).collectionName,'Weekend moments');assert.ok(mobileJpegSize(jpeg).width>0);assert.match(mobileToken(),/^[a-f0-9]{48}$/);
 for(const change of [{id:'../../file'},{bytes:MOBILE_LIMITS.photoBytes+1},{sha256:'bad'},{collectionName:'x'.repeat(81)},{collectionId:'light-water'},{v:2}])assert.throws(()=>validateMobilePhoto({...p,...change}));
 assert.throws(()=>mobileJpegSize(jpeg.slice(0,-1)));const bomb=jpeg.slice();for(let i=2;i<bomb.length-10;i++)if(bomb[i]===255&&[192,193,194].includes(bomb[i+1])){bomb[i+7]=255;bomb[i+8]=255;break;}assert.throws(()=>mobileJpegSize(bomb));
});
test('approved existing destinations support builtin and personal IDs; legacy headers remain new-only',()=>{
 for(const collectionId of ['light-water','my-photos','museum-found','mobile-example'])assert.equal(validateMobilePhoto({...photo(),collectionId,collectionMode:'existing'}).collectionId,collectionId);
 for(const change of [{collectionId:'../private',collectionMode:'existing'},{collectionId:'MY_F0001',collectionMode:'existing'},{collectionId:'light-water',collectionMode:'new'},{collectionMode:'anything'}])assert.throws(()=>validateMobilePhoto({...photo(),...change}));
});
test('collection lists are bounded names/IDs and uploads use the TV canonical name',()=>{
 const groups=mobileCollections([{id:'light-water',name:'Light & Water',secret:'excluded'},{id:'my-photos',name:'My photos'}]);assert.deepEqual(groups,[{id:'light-water',name:'Light & Water'},{id:'my-photos',name:'My photos'}]);
 assert.deepEqual(mobileUploadCollection({collectionMode:'existing',collectionId:'light-water',collectionName:'Client rename'},groups),groups[0]);
 assert.throws(()=>mobileUploadCollection({collectionMode:'existing',collectionId:'mobile-deleted',collectionName:'Deleted'},groups),/no longer/);
 for(const value of [null,[{id:'../bad',name:'X'}],[{id:'my-photos',name:'\0'}],Array(301).fill(groups[0]),[groups[0],groups[0]]])assert.throws(()=>mobileCollections(value));
});
test('an existing-image acknowledgement is distinct from adding another photo',async()=>{
 const [phone,tv]=channels(),sender=new MobileSender(phone),receiver=mobileReceiver(tv,{save:async meta=>({id:'previous-id',title:meta.title,alreadySaved:true,duplicateReason:'content'})});await delay(0);
 const result=await sender.send({meta:photo(),blob:new Blob([jpeg],{type:'image/jpeg'})});assert.equal(result.status,'existing');assert.equal(result.existingId,'previous-id');assert.equal(result.reason,'content');receiver.dispose();
});
test('sender and receiver transfer real JPEG chunks and acknowledge only after durable save',async()=>{
 const [phone,tv]=channels(),sender=new MobileSender(phone);let commit;const stored=[];
 const receiver=mobileReceiver(tv,{save:async(meta,blob)=>{await new Promise(resolve=>commit=resolve);stored.push({meta,blob});},timeout:500});await delay(0);
 let complete=false;const operation=sender.send({meta:photo(),blob:new Blob([jpeg],{type:'image/jpeg'})}).then(()=>complete=true);
 while(!commit)await delay(1);assert.equal(complete,false);assert.equal(tv.sent.some(x=>JSON.parse(x).type==='saved'),false);commit();await operation;
 assert.equal(complete,true);assert.equal(stored.length,1);assert.deepEqual(new Uint8Array(await stored[0].blob.arrayBuffer()),jpeg);assert.ok(phone.sent.filter(x=>typeof x!=='string').every(x=>x.byteLength<=16384));receiver.dispose();
});
test('corrupt and incomplete photos are rejected without calling storage',async()=>{
 const [phone,tv]=channels();let saved=0;const receiver=mobileReceiver(tv,{save:()=>saved++,timeout:500});const meta={...photo(),sha256:'0'.repeat(64)};
 phone.send(JSON.stringify(meta));for(let i=0;i<jpeg.length;i+=16384)phone.send(jpeg.subarray(i,i+16384));phone.send(JSON.stringify({type:'end',id:meta.id}));await delay(30);
 assert.equal(saved,0);assert.ok(tv.sent.some(x=>JSON.parse(x).type==='error'));
 phone.send(JSON.stringify(photo()));phone.send(JSON.stringify({type:'end',id:meta.id}));await delay(1);assert.equal(saved,0);receiver.dispose();
});
test('storage failure is reported to sender without a false saved acknowledgement',async()=>{
 const [phone,tv]=channels(),sender=new MobileSender(phone);const receiver=mobileReceiver(tv,{save:async()=>{throw new Error('Your gallery is full.');},timeout:500});await delay(0);
 await assert.rejects(sender.send({meta:photo(),blob:new Blob([jpeg],{type:'image/jpeg'})}),/full/);assert.equal(tv.sent.some(x=>JSON.parse(x).type==='saved'),false);receiver.dispose();
});
test('cancel and idle timeout discard partial data and allow a new photo',async()=>{
 const [phone,tv]=channels();let saved=0;const receiver=mobileReceiver(tv,{save:()=>saved++,timeout:20});phone.send(JSON.stringify(photo()));phone.send(jpeg.subarray(0,100));phone.send(JSON.stringify({type:'cancel'}));await delay(1);assert.equal(saved,0);assert.ok(tv.sent.some(x=>JSON.parse(x).type==='cancelled'));
 phone.send(JSON.stringify(photo()));await delay(35);assert.ok(tv.sent.some(x=>JSON.parse(x).message?.includes('paused')));assert.equal(saved,0);receiver.dispose();
});
test('receiver bounds chunks and rejects binary data before a photo header',async()=>{
 const [phone,tv]=channels();let saved=0;const receiver=mobileReceiver(tv,{save:()=>saved++,timeout:500});phone.send(new Uint8Array(100));await delay(0);phone.send(JSON.stringify(photo()));phone.send(new Uint8Array(16385));await delay(0);assert.equal(saved,0);assert.equal(tv.sent.filter(x=>JSON.parse(x).type==='error').length,2);receiver.dispose();
});
const encode=value=>new TextEncoder().encode(value);
test('HTTP parser waits for fragmented bodies and enforces host, origin and framing',()=>{
 const host='10.20.30.80:8768',text=`POST /api/claim HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 2\r\nOrigin: https://${host}\r\n\r\n{}`;
 for(let i=0;i<text.length;i++)assert.equal(mobileParseRequest(encode(text.slice(0,i)),host),null);
 assert.equal(mobileParseRequest(encode(text),host).body,'{}');
 for(const bad of [text.replace(host,'evil.example'),text.replace('Origin: https://'+host,'Origin: https://evil.example'),text.replace('Content-Length: 2','Content-Length: 2\r\nContent-Length: 2'),text.replace('Content-Length: 2','Transfer-Encoding: chunked'),text.replace('Content-Length: 2','Content-Length: 70001'),text+'x',text.replace('/api/claim','/../private?file=secret')])assert.throws(()=>mobileParseRequest(encode(bad),host));
 const reply=new TextDecoder().decode(mobileHttpResponse(401,JSON.stringify({error:'Scan again.'})));assert.ok(reply.includes('Content-Length: 23'));assert.ok(reply.includes("frame-ancestors 'none'"));assert.ok(!reply.includes('Access-Control-Allow-Origin'));
});
