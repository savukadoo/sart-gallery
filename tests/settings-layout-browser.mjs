// Settings geometry and paint hit-tests in disposable browser storage.
// Native support is stubbed only to cover both UI branches; hardware QA is separate.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.SART_PLAYWRIGHT||'playwright');
const out=process.env.SART_QA_OUTPUT||'.local/qa/settings-layout-0.20.4';await fs.mkdir(out,{recursive:true});
const fixture=process.env.SART_TEST_URL?null:JSON.parse(await fs.readFile(out+'/browser-fixture.json','utf8'));
const base=process.env.SART_TEST_URL||'http://127.0.0.1:'+fixture.port;
const browser=await chromium.launch({headless:true,...(process.env.SART_CHROME?{executablePath:process.env.SART_CHROME}:{})}),checks=[],errors=[];let failure='';
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log(name)};
try{
 for(const viewport of [{width:1920,height:1080},{width:1280,height:720}])for(const native of [false,true])for(const extras of [false,true]){
  const context=await browser.newContext({viewport}),p=await context.newPage(),tag=viewport.width+'-'+(native?'frame':'standard')+(extras?'-restore':'');
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/preview/bundle.js',async route=>{let source=await fs.readFile('dist/widget/bundle.js','utf8');const needle='const nativeArt=new NativeArt(window);';assert(source.includes(needle));source=source.replace(needle,`const nativeArt=Object.assign(new NativeArt(window),{async detect(){this.support={supported:${native}};return this.support}});`);await route.fulfill({contentType:'text/javascript',body:source})});
  await p.goto(base+'/preview/');await p.locator('.collection-card').first().waitFor();
  await p.evaluate(async extras=>{const blob=await(await fetch('assets/16568-thumb.jpg')).blob();await new Promise((resolve,reject)=>{const q=indexedDB.open('sart-gallery',1);q.onsuccess=()=>{const d=q.result,t=d.transaction(['photos','settings'],'readwrite');for(let i=0;i<3;i++)t.objectStore('photos').put({id:'qa-layout-'+i,title:'Layout fixture '+i,blob,thumbnailBlob:blob,width:800,height:600,source:'mobile',collectionId:'my-photos'});if(extras)t.objectStore('settings').put(['demo-16568'],'hiddenArtworkV1');t.oncomplete=()=>{d.close();resolve()};t.onerror=()=>reject(t.error)}})},extras);
  await p.reload();await p.locator('.collection-card').first().waitFor();await p.locator('[data-tab=settings]').click();await p.locator('.settings-side').waitFor();
  const state=await p.evaluate(()=>{const b=e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right}};const panel=document.querySelector('.library-panel');return{panel:b(panel),children:[...panel.children].map(b),overflow:panel.scrollHeight-panel.clientHeight,viewport:[innerWidth,innerHeight],cards:[...document.querySelectorAll('.settings-side>.settings-panel')].map(b)}});
  check(tag+': side cards remain inside the viewport and do not overlap',state.cards.every((r,i,a)=>r.top>=0&&r.bottom<=viewport.height&&(!i||r.top>=a[i-1].bottom)));
  if(!extras)check(tag+': the complete library and conditional native section fit without clipping',state.overflow<=1&&state.children.every(r=>r.top>=state.panel.top&&r.bottom<=state.panel.bottom));
  check(tag+': native action matches detected capability',(await p.locator('[data-focus=native-manager-open]').count())===(native?1:0));
  const keys=['library-manage','library-add','library-advanced',...(extras?['restore-included']:[]),...(native?['native-manager-open']:[]),'settings-sources','about'];
  await p.locator('[data-focus=setting-matte]').focus();
  for(const key of keys){await p.keyboard.press('ArrowDown');check(tag+': remote reaches '+key,await p.evaluate(key=>document.activeElement.dataset.focus===key,key));
   const visible=await p.evaluate(()=>{const e=document.activeElement,r=e.getBoundingClientRect(),pts=[[.5,.5],[.1,.1],[.9,.9]];if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)return false;return pts.every(([x,y])=>e.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height*y)))});
   check(tag+': '+key+' is painted and unobscured when focused',visible);
  }
  check(tag+': focusing the last action does not displace the TV shell',await p.evaluate(()=>scrollY===0));
  if(!extras)await p.screenshot({path:out+'/settings-'+tag+'.png'});
  await p.locator('[data-focus=about]').click();
  const about=await p.locator('#dialog').evaluate(e=>{const r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,overflow:e.scrollHeight-e.clientHeight,source:e.textContent.includes('https://github.com/savukadoo/sart-gallery')}});
  check(tag+': About and source address fit inside the viewport',about.top>=0&&about.bottom<=viewport.height&&about.left>=0&&about.right<=viewport.width&&about.overflow<=1);
  check(tag+': About provides the public source address',about.source);
  await context.close();
 }
 check('No application errors during layout checks',errors.length===0);
}catch(e){failure=String(e.stack||e);throw e}finally{await fs.writeFile(out+'/browser.json',JSON.stringify({passed:!failure,checks,errors,failure},null,2));await browser.close()}
