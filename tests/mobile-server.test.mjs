import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import {MobileHost} from '../app/mobile-host.mjs';
import {mobileTlsEngine} from '../app/mobile-tls.mjs';
import {tlsIdentityReady} from '../app/mobile-identity.mjs';
import {tlsFixture} from './tls-fixture.mjs';
const source=['compat.mjs','mobile-http.mjs','mobile-setup.mjs','mobile-native.mjs'].map(name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8').replace(/^import .+;\s*$/gm,'').replace(/\bexport /g,'')).join('\n');
async function server(identity){
 let fd=10,pending=[],records=new Map(),messages=[],tick,now=Date.now();const wire=[];
 const listener=net.createServer(socket=>{const id=++fd,r={socket,input:Buffer.alloc(0),ended:false,blocked:false};records.set(id,r);pending.push(id);socket.on('data',data=>{wire.push(data);r.input=Buffer.concat([r.input,data]);});socket.on('end',()=>r.ended=true);socket.on('error',()=>r.ended=true);});
 await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
 const sockets={create:()=>1,bind(){},listen(){},setSockOpt(){},close:id=>{if(id===1){listener.close();return;}records.get(id)?.socket.destroy();records.delete(id);},accept4:()=>{if(!pending.length)throw Error('EAGAIN');return pending.shift();},
  recv:(id,target)=>{const r=records.get(id);if(!r.input.length){if(r.ended)return 0;throw Error('EAGAIN');}const n=Math.min(target.length,r.input.length,311);target.set(r.input.subarray(0,n));r.input=r.input.subarray(n);return n;},
  send:(id,bytes)=>{const r=records.get(id);if(!r.blocked){r.blocked=true;throw Error('EAGAIN');}const n=Math.min(700,bytes.length);r.socket.write(bytes.subarray(0,n));return n;}};
 class Clock extends Date{static now(){return now;}}
 const self={tizentvwasm:{SocketsManager:sockets,SockFlags:{SOCK_NONBLOCK:1},NetAddress:class{}},close(){}};
 const context={self,postMessage:value=>messages.push(value),TextEncoder,TextDecoder,Uint8Array,Date:Clock,atob,
  setInterval:fn=>(tick=setInterval(fn,1),tick),clearInterval,mobileTlsEngine:record=>mobileTlsEngine(record,readFileSync(new URL('../app/tls.wasm',import.meta.url))),
  MOBILE_ASSETS:{'/':{body:'<h1>SART</h1>',type:'text/html'},'/icon.png':{base64:'AAECAw==',type:'image/png'}}};
 vm.runInNewContext(source,context);await self.onmessage({data:{type:'start',ip:'10.20.30.80',port:8768,host:'10.20.30.80:8768',token:'a'.repeat(48),identity}});
 return {port:listener.address().port,messages,wire,reply:(id,body)=>self.onmessage({data:{type:'response',id,body}}),advance:ms=>{now+=ms;},expire:()=>{now+=600001;},stop:async()=>{await self.onmessage({data:{type:'stop'}});clearInterval(tick);for(const r of records.values())r.socket.destroy();listener.close();}};
}
function request(s,ca,path='/',{method='GET',auth=false,body='',ip='10.20.30.80',...extra}={}){
 return new Promise((resolve,reject)=>{const req=https.request({host:'127.0.0.1',port:s.port,path,method,ca,agent:false,
  checkServerIdentity:(_host,cert)=>tls.checkServerIdentity(ip,cert),headers:{Host:'10.20.30.80:8768',...(auth?{Authorization:'Bearer '+'a'.repeat(48)}:{}),...(body?{'Content-Length':Buffer.byteLength(body)}:{})},...extra},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,text:Buffer.concat(chunks).toString()}));response.on('error',reject);});req.setTimeout(5000,()=>req.destroy(Error('TLS test timeout')));req.on('error',reject);req.end(body);});
}
test('real TLS verifies CA and address, encrypts content, tolerates fragmented input and partial writes',async()=>{
 const f=await tlsFixture(),s=await server(f.identity);
 try{
  assert.ok(s.messages.some(v=>v.type==='listening'));
  assert.match((await request(s,f.ca)).text,/<h1>SART/);
  assert.equal((await request(s,f.ca,'/api/status')).status,401);
  assert.ok((await request(s,f.ca,'/icon.png')).text.endsWith('\0\x01\x02\x03'));
  const pending=request(s,f.ca,'/api/status',{auth:true});
  while(!s.messages.some(v=>v.type==='request'))await new Promise(r=>setTimeout(r,5));
  const message=s.messages.find(v=>v.type==='request');s.reply(message.id,{phase:'approval'});assert.match((await pending).text,/approval/);
  assert.ok(!Buffer.concat(s.wire).includes(Buffer.from('Bearer '+'a'.repeat(48))));
  await assert.rejects(request(s,undefined),/certificate|issuer|verify/i);
  await assert.rejects(request(s,f.ca,'/',{ip:'10.20.30.81'}),/IP|certificate|altname/i);
  await assert.rejects(request(s,f.ca,'/',{maxVersion:'TLSv1.1',minVersion:'TLSv1'}));
  const plain=await new Promise(resolve=>{const socket=net.connect(s.port,'127.0.0.1',()=>socket.write('GET / HTTP/1.1\r\nHost: 10.20.30.80:8768\r\n\r\n'));let out='';socket.on('data',data=>out+=data);socket.on('close',()=>resolve(out));socket.setTimeout(1000,()=>socket.destroy());});assert.ok(!plain.includes('200 OK')&&!plain.includes('SART'));
 }finally{await s.stop();f.cleanup();}
});
test('HTTPS code pairing is rate limited; expiry closes the listener',async()=>{
 const f=await tlsFixture(),s=await server(f.identity);
 try{
  const replies=setInterval(()=>{for(const message of s.messages.filter(v=>v.type==='request'&&!v.replied)){message.replied=true;s.reply(message.id,{phase:'approval'});}},2);
  try{for(let i=0;i<5;i++)assert.equal((await request(s,f.ca,'/api/pair',{method:'POST',body:'{"code":"000000"}'})).status,200);
   assert.equal((await request(s,f.ca,'/api/pair',{method:'POST',body:'{}'})).status,429);
  }finally{clearInterval(replies);}
  s.expire();await new Promise(r=>setTimeout(r,20));assert.ok(s.messages.some(v=>v.type==='expired'));await assert.rejects(request(s,f.ca));
 }finally{await s.stop();f.cleanup();}
});
test('HTTPS identity fails closed for missing, expired and changed-address certificates',()=>{
 assert.throws(()=>tlsIdentityReady(null,'10.20.30.80'),/setup/);
 const record={certificate:'public',ip:'10.20.30.80',notBefore:1000,notAfter:2000};
 assert.equal(tlsIdentityReady(record,record.ip,1500),record);
 assert.throws(()=>tlsIdentityReady(record,'10.20.30.81',1500),/address changed/);
 assert.throws(()=>tlsIdentityReady(record,record.ip,2000),/renewal/);
});
test('knowing the short code requests TV approval and never bypasses it or replaces another device',async()=>{
 const replies=[],host=new MobileHost({onChange(){},save(){throw new Error('not approved');}});host.active=true;host.phase='waiting';host.code='123456';host.token='a'.repeat(48);host.expires=Date.now()+10000;host.worker={postMessage:value=>replies.push(value)};
 const req=(path,body={},client='b'.repeat(48))=>host.request({id:replies.length+1,path,client,body});
 await req('/api/pair',{code:'000000'});assert.equal(replies.at(-1).status,401);assert.ok(!host.client);
 await req('/api/pair',{code:'123456',name:'Test PC'});assert.equal(host.phase,'approval');assert.equal(host.peer,undefined);assert.equal(replies.at(-1).body.token,host.token);
 await req('/api/answer',{answer:{type:'answer',sdp:'invalid'}});assert.equal(replies.at(-1).status,409);
 await req('/api/pair',{code:'123456'},'c'.repeat(48));assert.equal(replies.at(-1).status,409);
});
test('a cancelled old session cannot close a new connection opened immediately afterwards',async()=>{
 const host=new MobileHost({onChange(){},save(){}});host.active=true;host.expires=Date.now()+10000;host.client='b'.repeat(48);host.worker={postMessage(){}};let closed=0;host.close=()=>closed++;
 await host.request({id:1,path:'/api/cancel',client:host.client,body:{}});host.worker={postMessage(){}};
 await new Promise(resolve=>setTimeout(resolve,320));assert.equal(closed,0);
});
test('collection names are available only to the claimed client after TV approval and connection',async()=>{
 const replies=[];let calls=0;const host=new MobileHost({onChange(){},save(){},collections:()=>{calls++;return [{id:'my-photos',name:'My photos',private:'omitted'}]}});host.active=true;host.phase='approval';host.client='b'.repeat(48);host.expires=Date.now()+10000;host.worker={postMessage:value=>replies.push(value)};
 const request=client=>host.request({id:replies.length+1,path:'/api/collections',body:{},client});
 await request(host.client);assert.equal(replies.at(-1).status,403);assert.equal(calls,0);
 host.phase='connected';await request('c'.repeat(48));assert.equal(replies.at(-1).status,401);assert.equal(calls,0);
 await request(host.client);assert.equal(replies.at(-1).status,200);assert.deepEqual(replies.at(-1).body,{collections:[{id:'my-photos',name:'My photos'}]});assert.equal(calls,1);
});

test('source-control routes stay behind TLS/bearer checks and only source testing gets a longer response budget',async()=>{
 const f=await tlsFixture(),s=await server(f.identity);
 try{
  assert.equal((await request(s,f.ca,'/api/sources')).status,401);
  assert.equal((await request(s,f.ca,'/api/sources/change',{auth:true})).status,404);
  for(const path of ['/api/sources','/api/sources/test','/api/sources/change','/api/sources/cancel']){
   const count=s.messages.length,pending=request(s,f.ca,path,{auth:true,method:path==='/api/sources'?'GET':'POST',body:path==='/api/sources'?'':'{}'});
   for(let i=0;i<500&&!s.messages.slice(count).some(m=>m.type==='request');i++)await new Promise(r=>setTimeout(r,2));
   const message=s.messages.slice(count).find(m=>m.type==='request');assert.equal(message?.path,path);
   if(path.endsWith('/test')){s.advance(13000);await new Promise(r=>setTimeout(r,10));}
   s.reply(message.id,{accepted:true});assert.equal((await pending).status,200);
  }
  assert.ok(!Buffer.concat(s.wire).includes(Buffer.from('Bearer '+'a'.repeat(48))));
 }finally{await s.stop();f.cleanup();}
});
