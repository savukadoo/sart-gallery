import {nativeArtTlsEngine} from './native-art-tls.mjs';
import {nativeArtIds,NativeThumbnailReader} from './native-art-library.mjs';
// Only pinned TLS to this TV's own assigned interface is permitted. COSS
// does not listen on 127.0.0.1; connecting to our own address stays on the TV.
let fd=null,timer=null,tls=null;
function stop(){clearInterval(timer);timer=null;if(fd!==null){try{self.tizentvwasm.SocketsManager.close(fd);}catch{}fd=null;}tls?.destroy();tls=null;}
self.onmessage=async event=>{
 const {type,target,buffer,ids}=event.data;if(!['send','receive'].includes(type))return;
 try{
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(target?.ip||'')||target.secured!==true||!Number.isInteger(target.port)||target.port<1024||target.port>65535)throw new Error('Invalid encrypted local Art transfer.');
  if(type==='send'&&(!(buffer instanceof ArrayBuffer)||buffer.byteLength>12*1024*1024||buffer.byteLength<4))throw new Error('Invalid artwork size.');
  if(type==='receive')nativeArtIds(ids,6);
  const selfInfo=await(await fetch('http://127.0.0.1:8001/api/v2/')).json();
  if(selfInfo.device?.modelName!=='QA55LS03BAWXXY'||String(selfInfo.device.FrameTVSupport).toLowerCase()!=='true'||selfInfo.device.ip!==target.ip)throw new Error('The artwork transfer address is not this Frame TV.');
  const bytes=type==='send'?new Uint8Array(buffer):null;if(bytes&&(bytes[0]!==255||bytes[1]!==216))throw new Error('Use a JPEG artwork.');
  if(type==='send'&&(!['string','number'].includes(typeof target.key)||String(target.key).length>256))throw new Error('Invalid native transfer key.');
  const identity=await(await fetch('assets/native-art-trust.json')).json();tls=await nativeArtTlsEngine(identity);
  const header=new TextEncoder().encode(JSON.stringify({num:0,total:1,fileLength:bytes?.length||0,fileName:'sart-gallery',fileType:'jpg',secKey:target.key,version:'0.0.1'}));
  const prefix=new Uint8Array(4+header.length);new DataView(prefix.buffer).setUint32(0,header.length);prefix.set(header,4);
  const api=self.tizentvwasm,sockets=api.SocketsManager;fd=sockets.create('af_inet','sock_stream',api.SockFlags.SOCK_NONBLOCK);
  if(fd<0)throw new Error('The native Art socket could not open.');
  try{sockets.connect(fd,new api.NetAddress('af_inet',new Uint8Array(target.ip.split('.').map(Number)),target.port));}catch{/* Nonblocking connection may be pending. */}
  const chunks=[prefix,bytes],reader=type==='receive'?new NativeThumbnailReader(ids):null;let chunk=0,offset=0,wire=null,wireOffset=0,closing=false;const deadline=Date.now()+40000;
  const fail=message=>{stop();postMessage({type:'error',message});};
  timer=setInterval(()=>{
   if(Date.now()>deadline){fail('Samsung did not accept the encrypted local artwork transfer.');return;}
   try{
    if(wire){let n;try{n=sockets.send(fd,wire.subarray(wireOffset),0);}catch{return;}if(n>0)wireOffset+=n;if(wireOffset<wire.length)return;wire=null;wireOffset=0;}
    const encrypted=tls.drain();if(encrypted.length){wire=encrypted;return;}
    if(closing){stop();postMessage({type:'done'});return;}
    const incoming=new Uint8Array(16384);let n=-1;try{n=sockets.recv(fd,incoming,0);}catch{}
    if(n===0){fail('Samsung closed the native Art connection.');return;}if(n>0)tls.feed(incoming.subarray(0,n));
    if(tls.handshake())return;
    if(reader){
     for(let i=0;i<4;i++){const data=tls.read();if(data===null)break;if(!data.length)throw new Error('Samsung ended the preview transfer early.');reader.push(data);if(reader.complete){const images=reader.images;stop();postMessage({type:'done',images},images.map(p=>p.buffer));return;}}
     return;
    }
    for(let i=0;i<2&&chunk<chunks.length;i++){
     const data=chunks[chunk],written=tls.write(data.subarray(offset));if(!written)return;offset+=written;if(offset===data.length){chunk++;offset=0;}
    }
    if(chunk===chunks.length){tls.notify();closing=true;}
   }catch(error){fail(error.message||'The native Art TLS connection failed.');}
  },20);
 }catch(error){stop();postMessage({type:'error',message:error.message||'The encrypted local artwork transfer failed.'});}
};
// Do not advertise a working action merely because WebAssembly exists. Validate
// the shipped binary and real service pin in this worker on the actual engine.
void (async()=>{
 try{
  if(!self.tizentvwasm?.SocketsManager?.connect||typeof WebAssembly?.instantiate!=='function')throw new Error('Native Art networking is unavailable.');
  const identity=await(await fetch('assets/native-art-trust.json')).json(),check=await nativeArtTlsEngine(identity);check.destroy();
  postMessage({type:'ready',available:true});
 }catch(error){postMessage({type:'ready',available:false,message:error.message});}
})();
