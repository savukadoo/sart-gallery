// Independent client engine; never changes the existing phone-upload TLS server.
export async function nativeArtTlsEngine(identity,wasmBytes){
 if(!identity?.certificate||!Number.isFinite(identity.notBefore)||!Number.isFinite(identity.notAfter)||identity.notAfter<=identity.notBefore||Date.now()<identity.notBefore||Date.now()>=identity.notAfter)throw new Error('The native Art certificate needs verification.');
 let api;
 const result=await WebAssembly.instantiate(wasmBytes||await(await fetch('native-art-tls.wasm')).arrayBuffer(),{
  sart:{random:(pointer,length)=>{try{const data=new Uint8Array(api.memory.buffer,pointer,length);for(let i=0;i<length;i+=65536)crypto.getRandomValues(data.subarray(i,i+65536));return 0;}catch{return -1;}}},
  wasi_snapshot_preview1:{proc_exit:()=>{throw new Error('Native Art TLS stopped.');},fd_close:()=>8,fd_seek:()=>8,fd_write:()=>8}
 });
 api=result.instance.exports;api._initialize?.();const scratch=api.malloc(16384);if(!scratch)throw new Error('Native Art TLS memory unavailable.');
 const view=(p,n)=>new Uint8Array(api.memory.buffer,p,n),certificate=Uint8Array.from(atob(identity.certificate),c=>c.charCodeAt(0)),pointer=api.malloc(certificate.length);
 try{if(!pointer)throw new Error('Native Art TLS memory unavailable.');view(pointer,certificate.length).set(certificate);const status=api.sart_init(pointer,certificate.length);if(status)throw new Error('Native Art certificate could not load ('+status+').');}
 catch(error){api.sart_destroy();api.free(scratch);throw error;}finally{if(pointer)api.free(pointer);}
 let destroyed=false;
 return {
  feed(bytes){view(scratch,bytes.length).set(bytes);if(api.sart_feed(scratch,bytes.length))throw new Error('Native Art TLS input limit exceeded.');},
  drain(){const count=api.sart_drain(scratch,16384);if(count<0)throw new Error('Native Art TLS closed.');return view(scratch,count).slice();},
  handshake(){const status=api.sart_handshake();if(status<0)throw new Error('Samsung’s native transfer certificate or TLS connection was rejected ('+status+').');return status;},
  write(bytes){const data=bytes.subarray(0,16384);view(scratch,data.length).set(data);const count=api.sart_write(scratch,data.length);if(count===-2)return 0;if(count<=0)throw new Error('Native Art TLS write failed.');return count;},
  read(){const count=api.sart_read(scratch,16384);if(count===-2)return null;if(count<0)throw new Error('Native Art TLS read failed.');return view(scratch,count).slice();},
  notify:()=>api.sart_notify(),
  destroy(){if(destroyed)return;destroyed=true;api.sart_destroy();new Uint8Array(api.memory.buffer).fill(0);}
 };
}
