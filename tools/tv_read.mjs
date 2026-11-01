import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const port=Number(process.env.SART_INSPECTOR_PORT||9223);
const targets=await(await fetch(`http://127.0.0.1:${port}/json`,{signal:AbortSignal.timeout(15000)})).json();
const target=targets.find(t=>(t.title||'').includes('SART')||(t.url||'').includes('SartGal001'));
if(!target?.webSocketDebuggerUrl)throw new Error('The SDK inspector did not expose SART Gallery.');
const endpoint=new URL(target.webSocketDebuggerUrl);endpoint.hostname='127.0.0.1';endpoint.port=String(port);
const ws=new WebSocket(endpoint);let sequence=0;const pending=new Map();
await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
ws.addEventListener('message',event=>{
  const message=JSON.parse(String(event.data));const request=pending.get(message.id);
  if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(new Error(JSON.stringify(message.error))):request.resolve(message.result);}
});
function command(method,params={}){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},15000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
const expression=`JSON.stringify({title:document.title,readyState:document.readyState,visibility:document.visibilityState,width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,screen:{width:screen.width,height:screen.height},userAgent:navigator.userAgent,hasTizen:typeof tizen!=='undefined',hasAppCommon:!!window.webapis?.appcommon,cards:document.querySelectorAll('.art-card').length,player:!!document.querySelector('.player'),images:Array.from(document.querySelectorAll('#app img')).map(i=>({complete:i.complete,width:i.naturalWidth,height:i.naturalHeight,source:i.getAttribute('src')})),bodyText:document.body.innerText.slice(0,2400)})`;
const output=root+'/.local/qa';fs.mkdirSync(output,{recursive:true});
try{
  const evaluation=await command('Runtime.evaluate',{expression,returnByValue:true});
  if(evaluation.exceptionDetails)throw new Error(JSON.stringify(evaluation.exceptionDetails));
  const result=JSON.parse(evaluation.result.value);
  fs.writeFileSync(output+'/tv-runtime.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  try{
    await command('Page.enable');const capture=await command('Page.captureScreenshot',{format:'png'});
    if(capture.data){fs.writeFileSync(output+'/tv-gallery.png',Buffer.from(capture.data,'base64'));console.log('Saved TV-rendered image: .local/qa/tv-gallery.png');}
  }catch(error){console.log('SDK screenshot unavailable: '+error.message);}
}finally{ws.close();}
