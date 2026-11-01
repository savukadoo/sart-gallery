import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {hasOwn,requestTimeout,directUploadSupport,setControlsAvailable,handleImeExit} from '../app/compat.mjs';
const script=name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8').replace(/^import .+;\s*$/gm,'').replace(/\bexport /g,'');

test('Samsung IME Done and Cancel blur the input before returning focus without suppressing the keyboard',()=>{
 for(const code of [65376,65385]){
  const calls=[],input={blur:()=>calls.push('blur')},event={target:input,keyCode:code,preventDefault:()=>calls.push('prevented')};
  assert.equal(handleImeExit(event,input,()=>calls.push('done'),()=>calls.push('cancel')),true);
  assert.deepEqual(calls,['blur',code===65376?'done':'cancel']);
 }
});
test('ordinary IME typing and unrelated controls retain their input focus',()=>{
 const input={blur(){throw Error('Typing must retain focus');}},event={target:input,keyCode:229};
 assert.equal(handleImeExit(event,input,()=>{},()=>{}),false);
 assert.equal(handleImeExit({target:{},keyCode:65376},input,()=>{},()=>{}),false);
 assert.equal(handleImeExit(event,null,()=>{},()=>{}),false);
});

test('older-engine settings and look handling work without Object.hasOwn and reject inherited choices',()=>{
 const result=vm.runInNewContext(`Object.hasOwn=undefined;${script('compat.mjs')}\n${script('core.mjs')}\nJSON.stringify({settings:normaliseSettings({interval:60,brightness:.65,contrast:1.2,motion:'gentle'}),look:normaliseLook(Object.create({matte:'toString',frame:'constructor'}))})`);
 const value=JSON.parse(result);assert.equal(value.settings.interval,60);assert.equal(value.settings.motion,'gentle');assert.equal(value.settings.brightness,.65);assert.equal(value.settings.contrast,1.2);assert.equal(value.look.matte,'paper');assert.equal(value.look.frame,'none');
 assert.equal(hasOwn(Object.create(null),'constructor'),false);assert.equal(hasOwn({toString:'own'},'toString'),true);
});

test('request deadlines abort on older engines and disposal prevents a later abort',()=>{
 const timers=new Map();let id=0;
 const scope={AbortController,setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:n=>timers.delete(n)};
 const pending=requestTimeout(100,scope);assert.equal(pending.signal.aborted,false);timers.get(1)();assert.equal(pending.signal.aborted,true);pending.cancel();assert.equal(timers.size,0);
 const completed=requestTimeout(100,scope);completed.cancel();assert.equal(timers.size,0);assert.equal(completed.signal.aborted,false);
});

test('direct uploads depend on actual secure transport capabilities, not a reported Tizen version',()=>{
 class Peer{createDataChannel(){}}
 const full={RTCPeerConnection:Peer,Worker:class{},WebAssembly:{instantiate(){}},crypto:{getRandomValues(){},subtle:{unwrapKey(){},digest(){}}}};
 assert.equal(directUploadSupport(full).supported,true);
 for(const feature of ['RTCPeerConnection','Worker','WebAssembly','crypto'])assert.equal(directUploadSupport({...full,[feature]:undefined}).supported,false,feature);
 assert.equal(directUploadSupport({...full,RTCPeerConnection:class{}}).supported,false);
 assert.equal(directUploadSupport({...full,crypto:{getRandomValues(){}}}).supported,false);
});

test('a partial Samsung Web API namespace loads the network and screensaver library once',async()=>{
 const scripts=[],window={tizen:{},webapis:{productinfo:{}}};
 const document={createElement:()=>({}),head:{appendChild:s=>scripts.push(s)}};
 const context=vm.createContext({window,document,Promise});
 vm.runInContext(script('platform.mjs'),context);
 const first=vm.runInContext('ready()',context),second=vm.runInContext('ready()',context);
 assert.equal(scripts.length,1);assert.equal(scripts[0].src,'$WEBAPIS/webapis/webapis.js');
 window.webapis.network={getIp:()=> '10.20.30.61'};window.webapis.appcommon={setScreenSaver(){}};
 scripts[0].onload();await Promise.all([first,second]);
 assert.equal(window.webapis.network.getIp(),'10.20.30.61');
});

test('fully loaded TV APIs need no reload and a failed API script can be retried',async()=>{
 const complete={window:{tizen:{},webapis:{network:{getIp(){}},appcommon:{setScreenSaver(){}}}},Promise};
 vm.runInNewContext(script('platform.mjs')+'\nready()',complete);
 const scripts=[],context=vm.createContext({window:{tizen:{},webapis:{}},document:{createElement:()=>({}),head:{appendChild:s=>scripts.push(s)}},Promise});
 vm.runInContext(script('platform.mjs'),context);
 const failed=vm.runInContext('ready()',context);scripts[0].onerror();await failed;
 const retried=vm.runInContext('ready()',context);assert.equal(scripts.length,2);scripts[1].onload();await retried;
});

test('HTTPS identity provisioning works without crypto.randomUUID while retaining wrapped private keys',async()=>{
 const records=new Map(),context={Uint8Array,btoa,crypto:{getRandomValues:array=>webcrypto.getRandomValues(array),subtle:webcrypto.subtle},getSetting:async key=>records.get(key),setSetting:async(key,value)=>records.set(key,value)};
 const result=await vm.runInNewContext(`${script('mobile-shared.mjs')}\n${script('mobile-identity.mjs')}\ntlsCertificateRequest()`,context);
 assert.match(result.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.ok(result.spki.length>50);const stored=records.get('httpsIdentityV1');assert.equal(stored.wrappingKey.extractable,false);assert.ok(stored.wrapped.byteLength>0);assert.equal(stored.privateKey,undefined);
 const again=await vm.runInNewContext('tlsCertificateRequest()',context);assert.equal(again.id,result.id);assert.equal(again.spki,result.spki);
});

test('hidden playback controls leave keyboard navigation even when the engine ignores inert',()=>{
 const control=value=>{const attrs=new Map(value===null?[]:[['tabindex',value]]);return {dataset:{},getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};};
 const controls=[control(null),control('0'),control('-1')],attrs=new Map(),container={querySelectorAll:()=>controls,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 setControlsAvailable(container,false);setControlsAvailable(container,false);assert.ok(controls.every(el=>el.getAttribute('tabindex')==='-1'));assert.equal(attrs.get('aria-hidden'),'true');
 setControlsAvailable(container,true);assert.deepEqual(controls.map(el=>el.getAttribute('tabindex')),[null,'0','-1']);assert.equal(attrs.get('aria-hidden'),'false');assert.equal(attrs.has('inert'),false);
});
