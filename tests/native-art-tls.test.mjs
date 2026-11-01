import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {tlsFixture} from './tls-fixture.mjs';
import {nativeArtTlsEngine} from '../app/native-art-tls.mjs';

const pem=(label,base64)=>'-----BEGIN '+label+'-----\n'+base64.match(/.{1,64}/g).join('\n')+'\n-----END '+label+'-----\n';
test('the real Samsung RSA/SHA-512 native transfer pin loads in the client engine',async()=>{
 const identity=JSON.parse(await readFile(new URL('../app/assets/native-art-trust.json',import.meta.url),'utf8'));
 const engine=await nativeArtTlsEngine(identity,await readFile(new URL('../app/native-art-tls.wasm',import.meta.url)));engine.destroy();
});
async function runClient(port,identity,wasm,payload,replySize=0){
 const engine=await nativeArtTlsEngine(identity,wasm);
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({port,host:'127.0.0.1'}),wire=[],received=[];let sent=false,finished=false;
  const finish=error=>{if(finished)return;finished=true;clearInterval(poll);clearTimeout(deadline);socket.destroy();engine.destroy();error?reject(error):resolve(replySize?{wire:Buffer.concat(wire),received:Buffer.concat(received)}:Buffer.concat(wire));};
  const deadline=setTimeout(()=>finish(new Error('Native TLS fixture timed out')),4000);
  socket.on('data',bytes=>{try{for(let offset=0;offset<bytes.length;offset+=16384)engine.feed(bytes.subarray(offset,offset+16384));}catch(error){finish(error);}});
  socket.on('error',finish);
  const poll=setInterval(()=>{try{
   if(!sent&&engine.handshake()===0){engine.write(payload);sent=true;}
   for(let i=0;i<8;i++){const data=engine.drain();if(!data.length)break;wire.push(Buffer.from(data));socket.write(data);}
   if(sent&&replySize){for(let i=0;i<8;i++){const data=engine.read();if(!data?.length)break;received.push(Buffer.from(data));}if(Buffer.concat(received).length>=replySize)finish();}
  }catch(error){finish(error);}},2);
  socket.on('end',()=>finish());
 });
}
test('pinned native TLS reads fragmented encrypted thumbnail data',async()=>{
 const fixture=await tlsFixture(),wasm=await readFile(new URL('../app/native-art-tls.wasm',import.meta.url));
 const key=await crypto.subtle.unwrapKey('pkcs8',fixture.identity.wrapped,fixture.identity.wrappingKey,{name:'AES-GCM',iv:fixture.identity.iv},{name:'ECDSA',namedCurve:'P-256'},true,['sign']);
 const reply=Buffer.from('fragmented-native-thumbnail-payload'),privatePem=pem('PRIVATE KEY',Buffer.from(await crypto.subtle.exportKey('pkcs8',key)).toString('base64'));
 const server=tls.createServer({key:privatePem,cert:pem('CERTIFICATE',fixture.identity.certificate),minVersion:'TLSv1.2',maxVersion:'TLSv1.2'},socket=>{socket.once('data',()=>{socket.write(reply.subarray(0,3));setTimeout(()=>socket.write(reply.subarray(3)),10);});});server.on('tlsClientError',()=>{});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));try{const result=await runClient(server.address().port,fixture.identity,wasm,Buffer.from('preview'),reply.length);assert.deepEqual(result.received,reply);assert.equal(result.wire.includes(reply),false);}finally{await new Promise(r=>server.close(r));fixture.cleanup();}
});
test('native Art TLS authenticates the exact pinned peer and keeps artwork bytes encrypted',async()=>{
 const fixture=await tlsFixture(),wasm=await readFile(new URL('../app/native-art-tls.wasm',import.meta.url));
 const key=await crypto.subtle.unwrapKey('pkcs8',fixture.identity.wrapped,fixture.identity.wrappingKey,{name:'AES-GCM',iv:fixture.identity.iv},{name:'ECDSA',namedCurve:'P-256'},true,['sign']);
 const privatePem=pem('PRIVATE KEY',Buffer.from(await crypto.subtle.exportKey('pkcs8',key)).toString('base64'));
 const payload=Buffer.from('native-art-test-photograph-plaintext');let received=Buffer.alloc(0);
 const server=tls.createServer({key:privatePem,cert:pem('CERTIFICATE',fixture.identity.certificate),minVersion:'TLSv1.2',maxVersion:'TLSv1.2',ciphers:'ECDHE-ECDSA-AES128-GCM-SHA256'},socket=>{
  socket.on('data',data=>{received=Buffer.concat([received,data]);socket.end();});
 });
 server.on('tlsClientError',()=>{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const wire=await runClient(server.address().port,fixture.identity,wasm,payload);
  assert.deepEqual(received,payload);assert.equal(wire.includes(payload),false);
  const wrong=await tlsFixture();received=Buffer.alloc(0);
  try{await assert.rejects(runClient(server.address().port,wrong.identity,wasm,payload),/certificate|rejected/);assert.equal(received.length,0);}finally{wrong.cleanup();}
  await assert.rejects(nativeArtTlsEngine({...fixture.identity,notAfter:Date.now()-1},wasm),/certificate/);
 }finally{await new Promise(resolve=>server.close(resolve));fixture.cleanup();}
});
