export async function mobileTlsEngine(identity,wasmBytes){
 let api;
 const result=await WebAssembly.instantiate(wasmBytes||await(await fetch('tls.wasm')).arrayBuffer(),{
  sart:{random:(pointer,length)=>{try{const bytes=new Uint8Array(api.memory.buffer,pointer,length);for(let offset=0;offset<length;offset+=65536)crypto.getRandomValues(bytes.subarray(offset,offset+65536));return 0;}catch{return -1;}}},
  wasi_snapshot_preview1:{proc_exit:()=>{throw new Error('TLS engine stopped.');},fd_close:()=>8,fd_seek:()=>8,fd_write:()=>8}
 });
 api=result.instance.exports;api._initialize?.();
 const scratch=api.malloc(16384);if(!scratch)throw new Error('TLS memory is unavailable.');
 const view=(pointer,length)=>new Uint8Array(api.memory.buffer,pointer,length);
 const from64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
 let privateBytes,certificate,cp=0,kp=0;
 try{
  const privateKey=await crypto.subtle.unwrapKey('pkcs8',identity.wrapped,identity.wrappingKey,{name:'AES-GCM',iv:identity.iv},{name:'ECDSA',namedCurve:'P-256'},true,['sign']);
  privateBytes=new Uint8Array(await crypto.subtle.exportKey('pkcs8',privateKey));certificate=from64(identity.certificate);
  cp=api.malloc(certificate.length);kp=api.malloc(privateBytes.length);if(!cp||!kp)throw new Error('TLS memory is unavailable.');
  view(cp,certificate.length).set(certificate);view(kp,privateBytes.length).set(privateBytes);
  const status=api.sart_init(cp,certificate.length,kp,privateBytes.length);if(status)throw new Error('The TV’s TLS identity could not be loaded ('+status+').');
 }catch(error){api.sart_destroy();api.free(scratch);throw error;}
 finally{if(kp){view(kp,privateBytes.length).fill(0);api.free(kp);}if(cp)api.free(cp);privateBytes?.fill(0);}
 let destroyed=false;
 return {
  open:()=>api.sart_open(),close:id=>api.sart_close(id),handshake:id=>api.sart_handshake(id),notify:id=>api.sart_notify(id),
  feed(id,bytes){for(let offset=0;offset<bytes.length;offset+=16384){const chunk=bytes.subarray(offset,offset+16384);view(scratch,chunk.length).set(chunk);if(api.sart_feed(id,scratch,chunk.length))throw new Error('TLS input limit exceeded.');}},
  drain(id){const n=api.sart_drain(id,scratch,16384);if(n<0)throw new Error('TLS closed.');return view(scratch,n).slice();},
  read(id){const n=api.sart_read(id,scratch,16384);if(n===-2)return null;if(n<=0)throw new Error('TLS closed.');return view(scratch,n).slice();},
  write(id,bytes){const chunk=bytes.subarray(0,16384);view(scratch,chunk.length).set(chunk);const n=api.sart_write(id,scratch,chunk.length);if(n===-2)return 0;if(n<=0)throw new Error('TLS closed.');return n;},
  destroy(){if(destroyed)return;destroyed=true;api.sart_destroy();view(scratch,16384).fill(0);api.free(scratch);new Uint8Array(api.memory.buffer).fill(0);}
 };
}
