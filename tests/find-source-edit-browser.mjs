// Exercise the compiled app and real settings service in isolated browser storage.
// Only museum responses are fixtures. No physical TV or user library is changed.
import fs from'node:fs/promises';import assert from'node:assert/strict';
const {chromium}=await import(process.env.SART_PLAYWRIGHT_MODULE||('file://'+process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const out=process.env.SART_QA_OUTPUT||'.local/qa/source-edit-0.20.2/browser',base=process.env.SART_PREVIEW||'http://127.0.0.1:8767';await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),checks=[],requests=[];
const check=(name,value)=>{assert(value,name);checks.push(name);console.log(name)};
const id='commons-0123456789abcdef',other='commons-fedcba9876543210',asset=(await fs.readdir('app/assets')).find(n=>n.endsWith('.jpg')),jpeg=await fs.readFile('app/assets/'+asset);let error;
try{
 const context=await browser.newContext({viewport:{width:1920,height:1080}}),p=await context.newPage();
 await context.route('https://commons.wikimedia.org/w/api.php*',async route=>{
  const u=new URL(route.request().url());if(u.searchParams.get('prop')==='categoryinfo'){await route.fulfill({json:{query:{pages:[{ns:14,title:u.searchParams.get('titles'),categoryinfo:{files:1}}]}},headers:{'Access-Control-Allow-Origin':'*'}});return;}
  const q=u.searchParams.get('gsrsearch'),category=/incategory:"([^"]+)"/.exec(q)?.[1]||'Category A';requests.push({query:q,normalSearch:q.startsWith('(')});
  const field=value=>({value}),record={pageid:category==='Category B'?8:7,title:'File:Fixture.jpg',imageinfo:[{mime:'image/jpeg',width:160,height:90,size:jpeg.length,url:'https://upload.wikimedia.org/source-edit.jpg',thumburl:'https://upload.wikimedia.org/source-edit.jpg',thumbwidth:160,thumbheight:90,extmetadata:{ObjectName:field(category+' artwork'),LicenseShortName:field('Public domain'),Copyrighted:field('False')}}]};
  await route.fulfill({json:{batchcomplete:'',query:{pages:{[record.pageid]:record}},continue:{gsroffset:8}},headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await context.route('https://upload.wikimedia.org/source-edit.jpg',r=>r.fulfill({body:jpeg,contentType:'image/jpeg',headers:{'Access-Control-Allow-Origin':'*'}}));
 await p.goto(base+'/preview/');await p.waitForSelector('.collection-card');
 await p.evaluate(({id,other})=>new Promise((r,j)=>{const q=indexedDB.open('sart-gallery',1);q.onsuccess=()=>{const d=q.result,t=d.transaction('settings','readwrite');t.objectStore('settings').put({v:1,revision:0,defaultId:id,sources:[{id,name:'My source',category:'Category A',kind:'commons',enabled:true},{id:other,name:'Other source',category:'Category C',kind:'commons',enabled:true}]},'findArtSourcesV1');t.oncomplete=()=>{d.close();r()};t.onerror=()=>j(t.error)};}),{id,other});
 await p.reload();await p.waitForSelector('.collection-card');await p.locator('[data-tab=find]').click();
 const search=async()=>{await p.locator('[data-action=find-search]').click();await p.waitForSelector('.find-result');};
 await p.locator('[data-action=find-edit]').click();await p.locator('#find-query-input').evaluate(n=>{n.value='landscape'});await p.locator('#find-query-form').evaluate(n=>n.requestSubmit());await p.waitForSelector('.find-result');
 check('Original category A results are shown',(await p.locator('.find-result strong').innerText())==='Category A artwork');
 await p.locator('[data-action=find-next]').click();await p.waitForFunction(()=>document.querySelector('.find-pagination').textContent.includes('Page 2'));
 const edit=async(sourceId,field,value)=>{
  await p.locator('[data-action=sources-open]').click();if(sourceId===other)await p.locator('[data-action=sources-next]').click();await p.locator('[data-action=sources-detail][data-id="'+sourceId+'"]').click();await p.locator('[data-field="'+field+'"]').click();await p.locator('#source-text-input').evaluate((n,v)=>{n.value=v},value);await p.locator('#source-text-form').evaluate(n=>n.requestSubmit());await p.locator('[data-action=sources-test]').click();await p.locator('[data-action=sources-save]:enabled').waitFor();await p.locator('[data-action=sources-save]').click();await p.waitForSelector('.source-row');await p.locator('[data-action=sources-close]').click();
 };
 const count=()=>requests.filter(x=>x.normalSearch).length;
 const beforeEdit=count();await edit(id,'category','Category B');
 check('Editing the active category removes stale tiles',await p.locator('.find-result').count()===0);
 check('Category edit keeps the query',await p.locator('.find-query-copy').innerText()==='landscape');
 check('Category edit clears old pagination',await p.locator('[data-action=find-next]').count()===0&&!(await p.locator('.find-pagination').innerText()).includes('Page 2'));
 check('Saving a source does not silently run another search',count()===beforeEdit);
 await search();check('The next explicit search uses category B',(await p.locator('.find-result strong').innerText())==='Category B artwork');check('Fresh search restarts at page one',(await p.locator('.find-pagination').innerText()).includes('Page 1'));
 const beforeOther=count();await edit(other,'category','Category D');check('Editing another source preserves the selected source results',(await p.locator('.find-result strong').innerText())==='Category B artwork');check('Editing another source does not rerun the selected search',count()===beforeOther);
 await edit(id,'name','Renamed source');check('Renaming the active source invalidates old result attribution',await p.locator('.find-result').count()===0);await search();await p.locator('.find-result').click();await p.waitForSelector('[data-focus=find-collection-picker]');check('Fresh result credits use the new source name',(await p.locator('#dialog').innerText()).includes('Renamed source'));await p.keyboard.press('Escape');
 await p.locator('[data-action=sources-open]').click();await p.locator('[data-action=sources-detail][data-id="'+id+'"]').click();await p.locator('[data-action=sources-remove]').click();await p.locator('[data-action=sources-remove-confirm]').click();await p.waitForSelector('.source-row');await p.locator('[data-action=sources-close]').click();check('Removing the selected source still clears its result list',await p.locator('.find-result').count()===0);check('Removal falls back to the configured source',(await p.locator('[data-action=find-source-picker]').innerText()).includes('National Gallery'));
 await context.close();
}catch(e){error=String(e.stack||e);throw e}
finally{await fs.writeFile(out+'/results.json',JSON.stringify({passed:!error,checks,error,requests},null,2));await browser.close();}
