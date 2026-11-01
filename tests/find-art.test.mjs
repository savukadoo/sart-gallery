import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {FindArtCatalog,findArtRecord,findArtUrl,findArtJpegSize,findArtArtveeSearch,findArtArtveeRecord,FIND_ART_PAGE_SIZE,FIND_ART_SOURCES,normaliseFindArtHistory,rememberFindArtSearch} from '../app/find-art.mjs';
const meta=value=>({value});
const nga=(id=1)=>({pageid:id,index:id,title:'File:A landscape.jpg',imageinfo:[{mime:'image/jpeg',size:900000,width:2000,height:1500,url:'https://upload.wikimedia.org/a.jpg',thumburl:'https://thumb.wikimedia.org/a.jpg',thumbwidth:640,thumbheight:480,extmetadata:{ObjectName:meta('A landscape'),Artist:meta('<b>Artist</b>'),DateTimeOriginal:meta('1890<div>date QS: hidden</div>'),LicenseShortName:meta('CC0'),LicenseUrl:meta('http://creativecommons.org/publicdomain/zero/1.0/deed.en')}}]});
const met=(id=1)=>({objectID:id,title:'A painting',artistDisplayName:'Artist',isPublicDomain:true,objectURL:'https://www.metmuseum.org/art/collection/search/'+id,primaryImage:'https://images.metmuseum.org/a.jpg',primaryImageSmall:'https://images.metmuseum.org/b.jpg'});
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const jpeg=(w=1920,h=1080)=>new Uint8Array([255,216,255,192,0,11,8,h>>8,h&255,w>>8,w&255,1,1,17,0,255,217]);
const seed=(id=1)=>({id,source:'https://artvee.com/dl/art-'+id+'/'});
const searchHtml=ids=>ids.map(id=>`<article id="post-${id}"><h3><a href="${seed(id).source}" rel="bookmark">Title</a></h3></article>`).join('');
const detail=(id=1,signature='fresh')=>`<meta property="og:image" content="https://mdl.artvee.com/sftb/123fg.jpg"><div id="product-${id}"><h1 class="product_title entry-title"><a href="${seed(id).source}">Art &amp; Flowers (1890)</a></h1><div class="tartist"><a href="https://artvee.com/artist/test/">An Artist</a></div><div class="w3eden dl_med"><span>Standard, 1800 x 1400px</span>JPG, Size: 2.9 MB<a href="https://mdl.artvee.com/sdl/123fgsdl.jpg?signature=${signature}">Download</a></div><div class="w3eden dl_med">Max Size, 4000 x 3000px</div><p>All public domain files can be freely used for personal and commercial projects.</p></div>`;

test('sources replace Cleveland without offering unsupported providers',()=>{
 assert.deepEqual(Object.keys(FIND_ART_SOURCES),['nga','artvee','met']);
 assert.equal(findArtRecord('cleveland',{id:1,share_license_status:'CC0'}),null);
});
test('NGA accepts only explicit public-domain/CC0 rights and bounded JPEG previews',()=>{
 const record=findArtRecord('nga',nga());assert.equal(record.rights,'CC0 1.0');assert.equal(record.artist,'Artist');assert.equal(record.date,'1890');
 for(const field of ['LicenseShortName','LicenseUrl']){const item=nga();item.imageinfo[0].extmetadata[field]=meta('unknown');assert.equal(findArtRecord('nga',item),null);}
 const pd=nga();pd.imageinfo[0].extmetadata={LicenseShortName:meta('Public domain'),Copyrighted:meta('False')};assert.equal(findArtRecord('nga',pd).rights,'Public domain');
 pd.imageinfo[0].extmetadata.Copyrighted=meta('True');assert.equal(findArtRecord('nga',pd),null);
 const big=nga();big.imageinfo[0].width=10000;assert.equal(findArtRecord('nga',big).image,big.imageinfo[0].thumburl);
 big.imageinfo[0].thumbheight=99999;assert.equal(findArtRecord('nga',big),null);
 assert.equal(findArtRecord('met',met()).publicDomain,true);assert.equal(findArtRecord('met',{...met(),isPublicDomain:'true'}),null);
 assert.equal(findArtRecord('met',{...met(),primaryImage:'https://evil.example/a.jpg'}),null);
});
test('source allowlists reject credentials, ports, insecure, paid and local paths',()=>{
 for(const url of ['http://images.metmuseum.org/a','https://images.metmuseum.org:8443/a','https://user@images.metmuseum.org/a','https://images.metmuseum.org.evil.test/a','https://10.20.30.80/a','file:///tmp/art'])assert.throws(()=>findArtUrl(url,'met'));
 for(const url of ['https://mdl.artvee.com/hdl/paid.jpg','https://mdl.artvee.com/sdl/../../a.jpg','https://artvee.com/lg/','https://evil.example/sdl/a.jpg'])assert.throws(()=>findArtUrl(url,'artvee'));
 assert.equal(findArtUrl('https://mdl.artvee.com/sdl/abc.jpg?expires=123','artvee'),'https://mdl.artvee.com/sdl/abc.jpg?expires=123');
});
test('Artvee reads known fields only and never executes or displays page HTML',()=>{
 assert.deepEqual(findArtArtveeSearch(searchHtml([1,2,3])),[seed(1),seed(2),seed(3)]);
 assert.deepEqual(findArtArtveeSearch('<script>'+searchHtml([99])+'</script><!--'+searchHtml([88])+'-->'+searchHtml([1])),[seed(1)]);
 assert.equal(findArtArtveeSearch(searchHtml(Array.from({length:30},(_,i)=>i+1))).length,8);
 const record=findArtArtveeRecord(detail(),seed());assert.equal(record.title,'Art & Flowers');assert.equal(record.rights,'Public domain (Artvee)');assert.equal(record.thumbnail,'https://mdl.artvee.com/ft/123fg.jpg');
 assert.equal(findArtArtveeRecord(detail(2),seed()),null);
 assert.equal(findArtArtveeRecord(detail().replace('All public domain files','All restricted files'),seed()),null);
 assert.equal(findArtArtveeRecord(detail().replace('/sdl/','/hdl/'),seed()),null);
 assert.equal(findArtArtveeRecord(detail().replace('1800 x 1400','9000 x 9000'),seed()),null);
});
test('text extraction preserves entities, credits and unmatched text without exposing HTML',()=>{
 const item=nga();item.imageinfo[0].extmetadata.ObjectName=meta('A &amp; B &lt;study&gt; &#x1F338; &#39;');
 item.imageinfo[0].extmetadata.Artist=meta('<span>Artist</span> &amp; studio <unfinished');
 const record=findArtRecord('nga',item);
 assert.equal(record.title,"A & B <study> 🌸 '");assert.equal(record.artist,'Artist & studio <unfinished');
 const long=nga();long.imageinfo[0].extmetadata.Artist=meta('<b>Artist</b>'+' '.repeat(480000));
 assert.equal(findArtRecord('nga',long).artist,'Artist');
});
test('Artvee ignores inert and unterminated blocks while preserving ordinary markup variations',()=>{
 const valid=searchHtml([1]);
 for(const prefix of ['<!--','<script>','<STYLE type="text/css">']){
  assert.deepEqual(findArtArtveeSearch(prefix+valid),[]);
  assert.equal(findArtArtveeRecord(prefix+detail(),seed()),null);
 }
 assert.deepEqual(findArtArtveeSearch('<STYLE>ignored</STYLE><!--ignored-->'+valid),[seed()]);
 assert.deepEqual(findArtArtveeSearch(valid.replace('rel="bookmark"',"rel='bookmark external'")),[seed()]);
 const html=detail().replace('class="w3eden dl_med"',"class='dl_med w3eden'").replace('id="product-1"',"id='product-1'").replace('Art &amp; Flowers','Art &amp; <em>Flowers</em>');
 assert.equal(findArtArtveeRecord(html,seed()).title,'Art & Flowers');
 assert.throws(()=>findArtArtveeSearch(' '.repeat(512*1024+1)),/too large/);
 assert.throws(()=>findArtArtveeSearch('<div></div>'.repeat(10001)),/too complex/);
});
test('malformed art responses near the byte limit complete within a bounded worker deadline',async()=>{
 const worker=new Worker(`
  const {parentPort,workerData}=require('node:worker_threads');
  (async()=>{
   const {FindArtCatalog,findArtArtveeSearch,findArtArtveeRecord}=await import(workerData.module);
   const field=value=>({value}),record={pageid:1,imageinfo:[{mime:'image/jpeg',size:100,width:1,height:1,url:'https://upload.wikimedia.org/a.jpg',thumburl:'https://upload.wikimedia.org/a.jpg',thumbwidth:1,thumbheight:1,extmetadata:{ObjectName:field('Title'),Artist:field('<'.repeat(480000)),LicenseShortName:field('Public domain'),Copyrighted:field('False')}}]};
   const catalog=new FindArtCatalog(async()=>new Response(JSON.stringify({batchcomplete:'',query:{pages:{1:record}}})));
   if((await catalog.search('nga','test')).items.length!==1)throw Error('Metadata record lost');
   for(const opener of ['<!--','<script>','<style>','<article id="post-1">','<h1 class="product_title">']){
    const text=opener.repeat(Math.floor(480000/opener.length));
    try{if(findArtArtveeSearch(text).length||findArtArtveeRecord(text,{id:1,source:'https://artvee.com/dl/art-1/'}))throw Error('Malformed block produced an artwork');}
    catch(error){if(error.message!=='This art page is too complex for the TV.')throw error;}
   }
   parentPort.postMessage(true);
  })().catch(error=>{throw error});
 `,{eval:true,execArgv:[],workerData:{module:new URL('../app/find-art.mjs',import.meta.url).href}});
 let timer;
 try{await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Art response parsing exceeded three seconds')),3000);worker.once('message',value=>value?resolve():reject(new Error('No result')));worker.once('error',reject);});}
 finally{clearTimeout(timer);await worker.terminate();}
});
test('recent searches retain five unique terms in order with the most recent provider',()=>{
 let history=[];for(const query of ['One','Two','Three','Four','Five','Six'])history=rememberFindArtSearch(history,'nga',query);
 assert.deepEqual(history.map(x=>x.query),['Six','Five','Four','Three','Two']);
 history=rememberFindArtSearch(history,'artvee',' four ');assert.equal(history.length,5);assert.deepEqual(history[0],{query:'four',source:'artvee'});
 assert.deepEqual(normaliseFindArtHistory([{source:'cleveland',query:'old'},{source:'constructor',query:'bad'},{source:'nga',query:' '},{source:'met',query:'<b>Monet</b>'}]),[{source:'met',query:'Monet'}]);
 assert.deepEqual(normaliseFindArtHistory(null),[]);assert.equal(rememberFindArtSearch([],'nga','a'.repeat(200))[0].query.length,100);
});
test('JPEG dimensions are checked before decoding',()=>{
 assert.deepEqual(findArtJpegSize(jpeg()),{width:1920,height:1080});assert.throws(()=>findArtJpegSize(jpeg(8000,8000)),/too large/);assert.throws(()=>findArtJpegSize(new Uint8Array([1,2,3])),/JPEG/);
});
test('NGA requests only its Commons category, paginates and keeps four metadata pages',async()=>{
 const calls=[];const catalog=new FindArtCatalog(async(url,options)=>{calls.push({url:new URL(url),options});return json({batchcomplete:'',query:{pages:{1:nga()}},continue:{gsroffset:8}});});
 assert.equal(calls.length,0);for(let page=0;page<5;page++)await catalog.search('nga','flowers',page);
 assert.equal(catalog.cache.size,4);await catalog.search('nga','flowers',4);assert.equal(calls.length,5);await catalog.search('nga','flowers',0);assert.equal(calls.length,6);
 assert.equal(calls[0].url.searchParams.get('gsrlimit'),String(FIND_ART_PAGE_SIZE));assert.match(calls[0].url.searchParams.get('gsrsearch'),/incategory:"Images from the National Gallery of Art"/);
 assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.cache,'no-store');
 assert.deepEqual((await new FindArtCatalog(async()=>json({batchcomplete:''})).search('nga','no result')).items,[]);
});
test('Artvee searches eight at a time with two bounded detail lookups and partial failure',async()=>{
 let pending=0,peak=0;const urls=[];
 const catalog=new FindArtCatalog(async url=>{urls.push(url);if(new URL(url).pathname==='/')return new Response(searchHtml([1,2,3,4,5,6,7,8]));pending++;peak=Math.max(peak,pending);await new Promise(r=>setTimeout(r,2));pending--;const id=Number(url.match(/art-(\d+)/)[1]);return new Response(id===2?'changed page':detail(id));});
 const result=await catalog.search('artvee','Flowers',2);assert.equal(result.items.length,7);assert.equal(result.more,true);assert.equal(result.partial,true);assert.equal(peak,2);assert.equal(urls.length,9);
 assert.equal(new URL(urls[0]).searchParams.get('posts_per_page'),'8');assert.equal(new URL(urls[0]).searchParams.get('paged'),'3');
 await assert.rejects(new FindArtCatalog(async()=>new Response('<h1>Sign in</h1>')).search('artvee','test'),/changed its search page/);
 assert.equal((await new FindArtCatalog(async()=>new Response('<div class="search-no-results">Nothing Found</div>')).search('artvee','none')).items.length,0);
});
test('Artvee resolves an expiring Standard download again when saving and never requests Pro',async()=>{
 const urls=[],record=findArtArtveeRecord(detail(1,'expired'),seed());
 const catalog=new FindArtCatalog(async url=>{urls.push(url);return new URL(url).hostname==='artvee.com'?new Response(detail()):new Response(jpeg());});
 assert.equal((await catalog.image(record)).type,'image/jpeg');assert.equal(urls.length,2);assert.match(urls[1],/signature=fresh/);assert.ok(!urls.some(u=>u.includes('/hdl/')));
 await assert.rejects(catalog.image({...record,rights:'CC0 1.0'}),/source-confirmed/);
});
test('Met search remains paginated with at most two object lookups',async()=>{
 let pending=0,peak=0;const urls=[];const catalog=new FindArtCatalog(async url=>{urls.push(url);if(url.includes('/v1.1/search'))return json({total:100,objectIDs:[1,2,3,4,5,6,7,8]});pending++;peak=Math.max(peak,pending);await new Promise(r=>setTimeout(r,2));pending--;const id=Number(url.split('/').pop());return json({...met(id),isPublicDomain:id!==2});});
 const result=await catalog.search('met','Monet',2);assert.equal(peak,2);assert.equal(result.items.length,7);assert.equal(result.more,true);assert.match(urls[0],/offset=16/);assert.equal(urls.length,9);
});
test('cancellation aborts pending requests without caching stale results',async()=>{
 let cancelled=false;const catalog=new FindArtCatalog((_url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{cancelled=true;reject(new DOMException('Cancelled','AbortError'));});}));
 const request=catalog.search('nga','landscape');catalog.cancel();await assert.rejects(request);assert.equal(cancelled,true);assert.equal(catalog.cache.size,0);
});
test('oversized metadata and redirected source URLs fail closed',async()=>{
 let catalog=new FindArtCatalog(async()=>new Response('{}',{headers:{'Content-Length':String(1024*1024)}}));await assert.rejects(catalog.search('nga','art'),/too large/);
 catalog=new FindArtCatalog(async()=>{const response=json({batchcomplete:''});Object.defineProperty(response,'url',{value:'https://evil.example/'});return response;});await assert.rejects(catalog.search('nga','art'),/unsupported/);
});
test('streaming byte limit cancels an image without Content-Length and permits smaller fallback',async()=>{
 let cancelled=false;const record=findArtRecord('nga',nga());record.image=record.thumbnail;
 const catalog=new FindArtCatalog(async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(4*1024*1024));},cancel(){cancelled=true;}})));
 await assert.rejects(catalog.image(record),/too large/);assert.equal(cancelled,true);
 let requests=0;const other=new FindArtCatalog(async()=>new Response(++requests===1?jpeg(8000,8000):jpeg()));assert.equal((await other.image(findArtRecord('nga',nga()))).type,'image/jpeg');assert.equal(requests,2);
});
test('query and page bounds prevent accidental empty/unbounded searches',async()=>{
 const catalog=new FindArtCatalog(()=>{throw Error('Must not request');});await assert.rejects(catalog.search('nga',' '),/Enter an artist/);await assert.rejects(catalog.search('nga','art',100),/more specific/);await assert.rejects(catalog.search('cleveland','art'),/Choose an art source/);
});
