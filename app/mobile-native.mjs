import {hasOwn} from './compat.mjs';
import {mobileParseRequest,mobileHttpResponse} from './mobile-http.mjs';
import {mobileTlsEngine} from './mobile-tls.mjs';
import {mobileSetupResponse} from './mobile-setup.mjs';
// Samsung Emscripten's documented Tizen Socket extension uses this engine
// binding. Always run in a worker, as required by Samsung. No daemon or root.
let listener=null,tick=null,tls=null,generation=0,host='',token='',clients=new Map(),sequence=0,deadline=0,pairAttempts=[];
let setupListener=null,setupClients=new Map(),setupAssets=null,setupHost='';
const sockets=()=>self.tizentvwasm.SocketsManager;
function closeClient(fd){const client=clients.get(fd);if(client)tls?.close(client.tlsId);try{sockets().close(fd);}catch{}clients.delete(fd);}
function stopSetup(){for(const fd of setupClients.keys()){try{sockets().close(fd);}catch{}}setupClients.clear();if(setupListener!==null){try{sockets().close(setupListener);}catch{}setupListener=null;}setupAssets=null;setupHost='';}
function stopServer(){generation++;stopSetup();clearInterval(tick);tick=null;for(const fd of clients.keys())closeClient(fd);if(listener!==null){try{sockets().close(listener);}catch{}listener=null;}tls?.destroy();tls=null;token='';}
function pollSetup(){
 if(setupListener===null)return;
 const close=fd=>{try{sockets().close(fd);}catch{}setupClients.delete(fd);};
 for(let i=0;i<2&&setupClients.size<2;i++){let fd;try{fd=sockets().accept4(setupListener,self.tizentvwasm.SockFlags.SOCK_NONBLOCK);}catch{break;}if(fd<0)break;setupClients.set(fd,{input:new Uint8Array(),output:null,sent:0,started:Date.now()});}
 for(const [fd,client] of setupClients){
  if(Date.now()-client.started>8000){close(fd);continue;}
  try{
   if(client.output){const n=sockets().send(fd,client.output.subarray(client.sent),0);if(n>0)client.sent+=n;if(client.sent===client.output.length)close(fd);continue;}
   const bytes=new Uint8Array(8192);let n;try{n=sockets().recv(fd,bytes,0);}catch{continue;}if(n===0){close(fd);continue;}if(n<0)continue;
   if(client.input.length+n>8192){close(fd);continue;}
   const input=new Uint8Array(client.input.length+n);input.set(client.input);input.set(bytes.subarray(0,n),client.input.length);client.input=input;
   client.output=mobileSetupResponse(input,setupHost,setupAssets);
  }catch{close(fd);}
 }
}
function queueResponse(client,status,body,type){client.output=mobileHttpResponse(status,typeof body==='object'&&!(body instanceof Uint8Array)?JSON.stringify(body):body,type);client.sent=0;}
function processRequest(client,request){
 if(request.method==='GET'&&hasOwn(MOBILE_ASSETS,request.path)){const asset=MOBILE_ASSETS[request.path];queueResponse(client,200,asset.base64?Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)):asset.body,asset.type);return;}
 if(!request.path.startsWith('/api/')){queueResponse(client,404,{error:'Page not found.'});return;}
 const pairing=request.method==='POST'&&request.path==='/api/pair';
 if(pairing){pairAttempts=pairAttempts.filter(time=>Date.now()-time<60000);if(pairAttempts.length>=5){queueResponse(client,429,{error:'Too many code attempts. Wait a minute or create a new code on the TV.'});return;}pairAttempts.push(Date.now());}
 if(!pairing&&request.headers.authorization!=='Bearer '+token){queueResponse(client,401,{error:'Scan the QR code or enter the code on the TV to connect.'});return;}
 if(!['GET /api/status','GET /api/collections','GET /api/sources','POST /api/sources/test','POST /api/sources/change','POST /api/sources/cancel','POST /api/pair','POST /api/claim','POST /api/answer','POST /api/cancel'].includes(request.method+' '+request.path)){queueResponse(client,404,{error:'Unknown request.'});return;}
 let body={};try{if(request.body)body=JSON.parse(request.body);}catch{queueResponse(client,400,{error:'Invalid request.'});return;}
 if(request.path==='/api/sources/test')client.maxAge=32000;
 client.request=++sequence;postMessage({type:'request',id:client.request,path:request.path,body,client:request.headers['x-sart-client']||''});
}
function pollServer(){
 if(Date.now()>deadline){stopServer();postMessage({type:'expired'});return;}
 pollSetup();
 for(let i=0;i<4&&clients.size<8;i++){let fd;try{fd=sockets().accept4(listener,self.tizentvwasm.SockFlags.SOCK_NONBLOCK);}catch{break;}if(fd<0)break;const tlsId=tls.open();if(tlsId<0){try{sockets().close(fd);}catch{}continue;}clients.set(fd,{fd,tlsId,input:new Uint8Array(),output:null,sent:0,wire:null,wireSent:0,finished:false,started:Date.now(),request:null});}
 for(const [fd,client] of clients){
  if(Date.now()-client.started>(client.maxAge||12000)){closeClient(fd);continue;}
  try{
   // Only encrypted TLS records cross the native socket. Retain partial writes.
   if(client.wire){let written;try{written=sockets().send(fd,client.wire.subarray(client.wireSent),0);}catch{continue;}if(written>0)client.wireSent+=written;if(client.wireSent!==client.wire.length)continue;client.wire=null;client.wireSent=0;}
   const encrypted=tls.drain(client.tlsId);if(encrypted.length){client.wire=encrypted;continue;}
   if(client.finished){closeClient(fd);continue;}
   if(client.output){
    if(client.sent<client.output.length)client.sent+=tls.write(client.tlsId,client.output.subarray(client.sent));
    if(client.sent===client.output.length&&tls.notify(client.tlsId)===0)client.finished=true;
    continue;
   }
   const chunk=new Uint8Array(8192);let count=-1;try{count=sockets().recv(fd,chunk,0);}catch{}
   if(count===0){closeClient(fd);continue;}if(count>0)tls.feed(client.tlsId,chunk.subarray(0,count));
   const handshake=tls.handshake(client.tlsId);if(handshake<0){closeClient(fd);continue;}if(handshake>0||client.request!==null)continue;
   for(let i=0;i<8;i++){
    const plain=tls.read(client.tlsId);if(!plain)break;
    if(client.input.length+plain.length>70000){queueResponse(client,413,{error:'Request too large.'});break;}
    const data=new Uint8Array(client.input.length+plain.length);data.set(client.input);data.set(plain,client.input.length);client.input=data;
    let request;try{request=mobileParseRequest(data,host);}catch(error){queueResponse(client,Number(error.message)||400,{error:'Invalid request.'});break;}
    if(request){processRequest(client,request);break;}
   }
  }catch{closeClient(fd);}
 }
}
self.onmessage=async event=>{
 const message=event.data;
 if(message.type==='start'){
  stopServer();host=message.host;token=message.token;pairAttempts=[];deadline=Date.now()+10*60*1000;
  const startGeneration=generation;
  try{if(!self.tizentvwasm?.SocketsManager)throw new Error('Direct photo uploads are unavailable on this TV. Your saved art is still available.');const t=self.tizentvwasm;
   const engine=await mobileTlsEngine(message.identity);if(startGeneration!==generation){engine.destroy();return;}tls=engine;
   listener=sockets().create('af_inet','sock_stream',t.SockFlags.SOCK_NONBLOCK);
   sockets().setSockOpt(listener,'sol_socket','so_reuseaddr',1);
   sockets().bind(listener,new t.NetAddress('af_inet',new Uint8Array(message.ip.split('.').map(Number)),message.port));sockets().listen(listener,8);
   tick=setInterval(pollServer,20);postMessage({type:'listening'});
  }catch(error){stopServer();postMessage({type:'error',message:error.message||'The TV could not start the mobile connection.'});}
 }else if(message.type==='setup-open'){
  stopSetup();
  try{if(listener===null)throw new Error('Open a new connection first.');const t=self.tizentvwasm;
   setupHost=message.host;setupAssets=message.assets;
   setupListener=sockets().create('af_inet','sock_stream',t.SockFlags.SOCK_NONBLOCK);sockets().setSockOpt(setupListener,'sol_socket','so_reuseaddr',1);
   sockets().bind(setupListener,new t.NetAddress('af_inet',new Uint8Array(host.split(':')[0].split('.').map(Number)),8769));sockets().listen(setupListener,2);postMessage({type:'setup-listening'});
  }catch(error){stopSetup();postMessage({type:'setup-error',message:error.message||'The certificate download could not open.'});}
 }else if(message.type==='setup-close'){stopSetup();
 }else if(message.type==='response'){
  for(const client of clients.values())if(client.request===message.id){queueResponse(client,message.status||200,message.body);break;}
 }else if(message.type==='extend'){deadline=Date.now()+10*60*1000;}
 else if(message.type==='stop'){stopServer();postMessage({type:'stopped'});self.close();}
};
