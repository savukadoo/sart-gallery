// Standard Samsung web-app SDK inspector, forwarded to loopback by tv_inspector.py.
import http from 'node:http';
export async function connectTvInspector(port=9223) {
  const targets=await new Promise((resolve,reject)=>{
    const request=http.get({hostname:'127.0.0.1',port,path:'/json',agent:false,headers:{Connection:'close'}},response=>{
      let data='';response.setEncoding('utf8');response.on('data',chunk=>{data+=chunk;});
      response.on('end',()=>{try{resolve(JSON.parse(data));}catch(error){reject(error);}});
      response.on('error',reject);
    });
    request.setTimeout(15000,()=>request.destroy(new Error('Inspector discovery timed out')));request.on('error',reject);
  });
  const target=targets.find(t=>(t.title||'').includes('SART')||(t.url||'').includes('SartGal001'));
  if(!target?.webSocketDebuggerUrl)throw new Error('SART Gallery is not exposed by the SDK inspector.');
  const endpoint=new URL(target.webSocketDebuggerUrl);endpoint.hostname='127.0.0.1';endpoint.port=String(port);
  const ws=new WebSocket(endpoint);let sequence=0;const pending=new Map();
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('close',()=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(new Error('TV inspector target closed; reconnect after normal app relaunch.'));}pending.clear();});
  ws.addEventListener('message',event=>{
    const message=JSON.parse(String(event.data)),request=pending.get(message.id);
    if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(JSON.stringify(message.error))):request.resolve(message.result);}
  });
  function command(method,params={}){return new Promise((resolve,reject)=>{
    const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},15000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });}
  async function read(expression){
    const response=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function key(key){
    const keys={ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Enter:13,Escape:27};
    const code=key==='Enter'?'Enter':key;
    const params={key,code,windowsVirtualKeyCode:keys[key],nativeVirtualKeyCode:keys[key]};
    await command('Input.dispatchKeyEvent',{type:'keyDown',...params,text:key==='Enter'?'\r':undefined});
    await command('Input.dispatchKeyEvent',{type:'keyUp',...params});
  }
  async function focus(selector){
    const {root}=await command('DOM.getDocument');
    const {nodeId}=await command('DOM.querySelector',{nodeId:root.nodeId,selector});
    if(!nodeId)throw new Error('Missing visible TV control: '+selector);
    await command('DOM.focus',{nodeId});
  }
  return {command,read,key,focus,close:()=>ws.close()};
}
