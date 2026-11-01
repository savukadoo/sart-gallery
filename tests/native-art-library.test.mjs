import test from 'node:test';import assert from 'node:assert/strict';
import {nativeArtIds,nativePersonalArt,nativeExportMatch,NativeThumbnailReader} from '../app/native-art-library.mjs';
import {NativeArt} from '../app/native-art.mjs';
const photo=id=>({content_id:id,category_id:'MY-C0002'});
const frame=(id,data=new Uint8Array([255,216,255,217]),total=1)=>{const h=new TextEncoder().encode(JSON.stringify({fileID:id,fileType:'jpg',fileLength:data.length,total,num:0})),r=new Uint8Array(4+h.length+data.length);new DataView(r.buffer).setUint32(0,h.length);r.set(h,4);r.set(data,4+h.length);return r;};
test('native management accepts only bounded explicit personal-photo IDs and filters Art Store records',()=>{
 assert.deepEqual(nativeArtIds(['MY_F001','MY_F002']),['MY_F001','MY_F002']);
 for(const ids of [[],['MY_F001','MY_F001'],['STORE_1'],['MY_../x'],Array.from({length:51},(_,i)=>'MY_F'+i)])assert.throws(()=>nativeArtIds(ids));
 assert.deepEqual(nativePersonalArt([photo('MY_F001'),{content_id:'STORE_1',category_id:'ART'}]),[photo('MY_F001')]);
});
test('native previews parse fragmented headers and JPEG bytes without mixing identities',()=>{
 const p=new NativeThumbnailReader(['MY_F001','MY_F002']),bytes=new Uint8Array([...frame('MY_F001',undefined,2),...frame('MY_F002',undefined,2)]);
 for(const b of bytes)p.push(new Uint8Array([b]));assert.equal(p.complete,true);assert.deepEqual(p.images.map(p=>p.id),['MY_F001','MY_F002']);assert.equal(p.images[0].mime,'image/jpeg');assert.throws(()=>p.push(new Uint8Array([1])),/extra/);
});
test('native previews accept the Frame’s decimal-string size/count headers and reject non-decimal values',()=>{
 const make=(fileLength,total)=>{const h=new TextEncoder().encode(JSON.stringify({fileID:'MY_F001',fileLength,total,num:'0'})),b=new Uint8Array(4+h.length+4);new DataView(b.buffer).setUint32(0,h.length);b.set(h,4);b.set([255,216,255,217],4+h.length);return b;};
 const p=new NativeThumbnailReader(['MY_F001']);p.push(make('4','1'));assert.equal(p.complete,true);
 for(const size of ['4e0','',null,'-4','999999999'])assert.throws(()=>new NativeThumbnailReader(['MY_F001']).push(make(size,'1')),/size/);
});
test('native previews reject foreign IDs, oversized headers, duplicate files and non-image payloads',()=>{
 assert.throws(()=>new NativeThumbnailReader(['MY_F001']).push(frame('MY_F999')),/identity/);
 const big=new Uint8Array(4);new DataView(big.buffer).setUint32(0,5000);assert.throws(()=>new NativeThumbnailReader(['MY_F001']).push(big),/header/);
 assert.throws(()=>new NativeThumbnailReader(['MY_F001']).push(frame('MY_F001',new TextEncoder().encode('<html>bad</html>'))),/invalid photo/);
 const p=new NativeThumbnailReader(['MY_F001','MY_F002']);p.push(frame('MY_F001',undefined,2));assert.throws(()=>p.push(frame('MY_F001',undefined,2)),/identity/);
});
test('duplicate export lookup requires identical bytes and can reuse a tracked copy after a SART record is re-added',()=>{
 const known={old:{sha256:'hash',contentId:'MY_F001'},new:{sha256:'other',contentId:'MY_F002'}};
 assert.equal(nativeExportMatch(known,'new','hash').contentId,'MY_F001');assert.equal(nativeExportMatch(known,'old','changed'),null);
 assert.equal(nativeExportMatch({x:{sha256:'hash',contentId:'STORE_1'}},'x','hash'),null);
});
function fakeArt(sequence){const art=new NativeArt({}),requests=[];let list=0;const client={async request(name,fields){requests.push({name,fields});if(name==='get_content_list')return {content_list:sequence[Math.min(list++,sequence.length-1)]};return {};},close(){this.closed=true;}};art.open=async()=>{art.client=client;return {};};return {art,requests,client};}
test('native deletion sends exactly the confirmed IDs and succeeds only after readback preserves every other photo',async()=>{
 const {art,requests}=fakeArt([[photo('MY_F001'),photo('MY_F002')],[photo('MY_F002')]]);const result=await art.remove(['MY_F001']);assert.deepEqual(result.removed,['MY_F001']);assert.deepEqual(requests.find(x=>x.name==='delete_image_list').fields,{content_id_list:[{content_id:'MY_F001'}]});
 for(const after of [[photo('MY_F001'),photo('MY_F002')],[]]){const f=fakeArt([[photo('MY_F001'),photo('MY_F002')],after]);await assert.rejects(f.art.remove(['MY_F001']),/did not confirm/);}
});
test('a stale or unknown native photo cannot trigger deletion or automatic re-upload',async()=>{
 const f=fakeArt([[photo('MY_F002')]]);await assert.rejects(f.art.remove(['MY_F001']),/changed/);assert.equal(f.requests.some(x=>x.name==='delete_image_list'),false);
 const s=fakeArt([[photo('MY_F002')]]);await assert.rejects(s.art.showExisting('MY_F001'),/no longer/);assert.deepEqual(s.requests.map(x=>x.name),['get_content_list']);
});
test('cancelling a native operation before delete cannot affect a newer connection',async()=>{
 const art=new NativeArt({});let resolve,deleted=false;const old={request:()=>new Promise(r=>resolve=r),close(){this.closed=true}},fresh={close(){this.closed=true}};art.open=async()=>{art.client=old;return {}};
 const pending=art.remove(['MY_F001']);await new Promise(r=>setTimeout(r,0));art.cancel();art.client=fresh;resolve({content_list:[photo('MY_F001')]});await assert.rejects(pending,/cancelled/);assert.equal(deleted,false);assert.equal(fresh.closed,undefined);assert.equal(art.client,fresh);
});
