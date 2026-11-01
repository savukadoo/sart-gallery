import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeArtEligible,nativeArtHost,nativeArtHosts,nativeArtList,nativeArtTarget,NativeArtClient,NativeArt,NATIVE_ART_ENDPOINT,NATIVE_ART_APP} from '../app/native-art.mjs';

test('native integration requires the verified Frame model and an explicit capability',()=>{
 assert.equal(nativeArtEligible({device:{modelName:'QA55LS03BAWXXY',FrameTVSupport:'true'}}),true);
 for(const device of [{modelName:'UA50DU7700WXXY',FrameTVSupport:'false'},{modelName:'UA50DU7700WXXY',FrameTVSupport:'true'},{modelName:'QA55LS03BAWXXY'},{}])assert.equal(nativeArtEligible({device}),false);
 assert.equal(nativeArtEligible(null),false);
});
test('loopback routing chooses the native Art host and never the SART host',()=>{
 const data={id:'sart',clients:[{id:'native',isHost:true,attributes:{name:null}},{id:'sart',isHost:true,attributes:{name:'SART'}}]};
 assert.equal(nativeArtHost(data),'native');
 assert.throws(()=>nativeArtHost({id:'sart',clients:data.clients.slice(1)}),/not ready/);
 assert.throws(()=>nativeArtHost({id:'sart',clients:[...data.clients,{id:'ambiguous',isHost:true}]}),/not ready/);
});
test('Art candidates exclude named apps and self, deduplicate IDs and bound discovery',()=>{
 const clients=[{id:'native-a',isHost:true},{id:'native-a',isHost:true},{id:'native-b',isHost:true,attributes:{name:null}},{id:'sart',isHost:true},{id:'other-app',isHost:true,attributes:{name:'Other app'}},{id:'guest',isHost:false},null];
 assert.deepEqual(nativeArtHosts({id:'sart',clients}),['native-a','native-b']);
 assert.deepEqual(nativeArtHosts({clients:{}}),[]);
 assert.throws(()=>nativeArtHosts({id:'sart',clients:Array.from({length:9},(_,i)=>({id:'native-'+i,isHost:true}))}),/too many/);
});
test('native photo transfers stay on the verified TV and never downgrade a requested TLS transfer',()=>{
 const info={ip:'10.20.30.61',port:49153,key:'temporary',secured:true};
 assert.deepEqual(nativeArtTarget({conn_info:info},info.ip),{ip:info.ip,port:49153,key:'temporary',secured:true});
 for(const change of [{ip:'10.20.30.80'},{ip:'8.8.8.8'},{port:80},{port:70000},{secured:false},{secured:'false'},{key:null}])assert.throws(()=>nativeArtTarget({conn_info:{...info,...change}},info.ip));
});
test('native library readback rejects malformed records instead of assuming a saved artwork',()=>{
 assert.deepEqual(nativeArtList({content_list:'[{"content_id":"MY_F0001"}]'}),[{content_id:'MY_F0001'}]);
 for(const content_list of ['{}','not JSON',[{}],null])assert.throws(()=>nativeArtList({content_list}));
});
class Socket{
 constructor(url){assert.equal(url,NATIVE_ART_ENDPOINT);this.sent=[];queueMicrotask(()=>{this.emit('ms.channel.connect',{id:'sart',clients:[{id:'native',isHost:true,attributes:{name:null}},{id:'sart',isHost:true,attributes:{name:'SART'}}]});this.emit('ms.channel.ready',{});});}
 emit(event,data){this.onmessage?.({data:JSON.stringify({event,data})});}
 send(value){this.sent.push(JSON.parse(value));}
 close(){this.closed=true;}
}
function multipleHosts(routes,{readyFirst=false,wrongEvent=false}={}){
 return class{
  constructor(url){assert.equal(url,NATIVE_ART_ENDPOINT);this.sent=[];queueMicrotask(()=>{if(readyFirst)this.emit('ms.channel.ready',{});this.emit('ms.channel.connect',{id:'sart',clients:[...Object.keys(routes).map(id=>({id,isHost:true,attributes:{name:null}})),{id:'sart',isHost:true,attributes:{name:'SART'}},{id:'named-app',isHost:true,attributes:{name:'Other app'}}]});if(!readyFirst)this.emit('ms.channel.ready',{});});}
  emit(event,data){this.onmessage?.({data:JSON.stringify({event,data})});}
  send(value){const frame=JSON.parse(value);this.sent.push(frame);const data=JSON.parse(frame.params.data),route=routes[frame.params.to];if(data.request!=='api_version'||route==='silent')return;
   queueMicrotask(()=>{if(route==='error'){this.emit('d2d_service_message',{event:'error',request_id:data.id,error_code:1});return;}if(wrongEvent)this.emit('d2d_service_message',{event:'get_artmode_status',request_id:data.id,version:route,value:'off'});this.emit('d2d_service_message',{event:'api_version',request_id:data.id,version:route});});
  }
  close(){this.closed=true;}
 };
}
test('multiple internal hosts are probed read-only; writes use exactly one verified route',async()=>{
 const client=new NativeArtClient({WebSocket:multipleHosts({stale:'error',unverified:'4.6.1.0',native:'4.3.4.0'})});await client.connect();const socket=client.socket;
 assert.equal(client.host,'native');assert.equal(client.pending.size,0);assert.equal(socket.sent.length,3);
 assert.ok(socket.sent.every(frame=>JSON.parse(frame.params.data).request==='api_version'&&frame.params.to!=='sart'&&frame.params.to!=='named-app'));
 const action=client.request('select_image',{content_id:'own-copy'}),sent=socket.sent.at(-1);assert.equal(socket.sent.length,4);assert.equal(sent.params.to,'native');
 socket.emit('d2d_service_message',{request_id:JSON.parse(sent.params.data).id,event:'select_image'});await action;client.close();
});
test('verified host choice is stable and handles ready arriving before connect',async()=>{
 const client=new NativeArtClient({WebSocket:multipleHosts({first:'4.3.4.0',second:'4.3.4.0',third:'4.3.4.0'},{readyFirst:true,wrongEvent:true})});await client.connect();assert.equal(client.host,'first');assert.equal(client.pending.size,0);client.close();
});
test('unverified Art host replies fail closed without any artwork requests',async()=>{
 const Type=multipleHosts({old:'4.2.1.0',unknown:'not-a-version'});let socket;class Capture extends Type{constructor(url){super(url);socket=this;}}
 const client=new NativeArtClient({WebSocket:Capture});await assert.rejects(client.connect(),/verified Art service/);assert.equal(client.host,'');assert.equal(client.pending.size,0);assert.ok(socket.closed);assert.ok(socket.sent.every(f=>JSON.parse(f.params.data).request==='api_version'));
});
test('nonresponding Art hosts time out and their probes are cleaned up',async()=>{
 const client=new NativeArtClient({WebSocket:multipleHosts({one:'silent',two:'silent'})});await assert.rejects(client.connect(),/verified Art service/);assert.equal(client.pending.size,0);assert.equal(client.host,'');
});
test('cancelling host discovery rejects immediately and cannot select a late reply',async()=>{
 const client=new NativeArtClient({WebSocket:multipleHosts({one:'silent',two:'silent'})}),connecting=client.connect(),rejected=assert.rejects(connecting,/cancelled/);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(client.pending.size,2);const socket=client.socket;
 client.close();await rejected;assert.equal(client.pending.size,0);assert.equal(client.host,'');assert.ok(socket.closed);socket.emit('d2d_service_message',{event:'api_version',request_id:'late',version:'4.3.4.0'});assert.equal(client.host,'');
});
test('encrypted native requests route to the exact native client and correlate out-of-order replies',async()=>{
 const client=new NativeArtClient({WebSocket:Socket});await client.connect();
 const first=client.request('get_artmode_status'),second=client.request('api_version');
 const [a,b]=client.socket.sent;assert.equal(a.params.to,'native');assert.equal(b.params.to,'native');
 client.socket.emit('d2d_service_message',JSON.stringify({request_id:JSON.parse(b.params.data).id,version:'4.3.4.0'}));
 client.socket.emit('d2d_service_message',JSON.stringify({request_id:JSON.parse(a.params.data).id,value:'off'}));
 assert.equal((await first).value,'off');assert.equal((await second).version,'4.3.4.0');client.close();
});
test('cancellation rejects pending reads and storage acknowledgements and closes its connection',async()=>{
 const client=new NativeArtClient({WebSocket:Socket});await client.connect();const socket=client.socket;
 const request=client.request('get_current_artwork'),saved=client.waitUpload('own-upload');
 const one=assert.rejects(request,/cancelled/),two=assert.rejects(saved,/cancelled/);client.close();await Promise.all([one,two]);
 assert.equal(socket.closed,true);assert.equal(client.pending.size,0);assert.equal(client.upload,null);
});
test('showing an already selected copy asks native Art Mode to switch on without selecting or uploading again',async()=>{
 const art=new NativeArt({}),requests=[];art.client={async request(name,fields){requests.push({name,fields});return name==='get_current_artwork'?{content_id:'own-copy'}:{value:'on'};},close(){}};
 await art.show('own-copy');assert.deepEqual(requests,[{name:'get_current_artwork',fields:undefined},{name:'set_artmode_status',fields:{value:'on'}}]);
});
test('native mode-on broadcast acknowledges only an active mode-on request',async()=>{
 const client=new NativeArtClient({WebSocket:Socket});await client.connect();
 const pending=client.request('set_artmode_status',{value:'on'});
 client.socket.emit('d2d_service_message',JSON.stringify({event:'art_mode_changed',status:'off'}));assert.equal(client.pending.size,1);
 client.socket.emit('d2d_service_message',JSON.stringify({event:'art_mode_changed',status:'on'}));assert.equal((await pending).status,'on');assert.equal(client.pending.size,0);client.close();
});
test('a mismatched native selection never hands off to another artwork',async()=>{
 let launched=false;const art=new NativeArt({tizen:{application:{launchAppControl(){launched=true;}}}});
 art.client={async request(){return {content_id:'original-artwork'};},close(){}};
 await assert.rejects(art.show('own-copy'),/did not confirm/);assert.equal(launched,false);
});
