// Small, key-free adapters. Nothing is requested until the user searches.
import {FIND_SOURCE_NAMES,normaliseFindSources,validFindSourceId} from './find-art-sources.mjs';
export const FIND_ART_SOURCES=FIND_SOURCE_NAMES;
export const FIND_ART_PAGE_SIZE = 8;
const FIND_ART_JSON_LIMIT=512*1024, FIND_ART_IMAGE_LIMIT=12*1024*1024;
const FIND_ART_HOSTS={nga:{api:['commons.wikimedia.org'],image:['upload.wikimedia.org','thumb.wikimedia.org'],record:['commons.wikimedia.org']},artvee:{api:['artvee.com'],image:['mdl.artvee.com'],record:['artvee.com']},met:{api:['collectionapi.metmuseum.org'],image:['images.metmuseum.org'],record:['www.metmuseum.org','metmuseum.org']}};
FIND_ART_HOSTS.commons=FIND_ART_HOSTS.nga;
// Bound raw metadata before extraction. Advance past each delimiter once;
// repeated unterminated '<' characters must never rescan the remaining input.
const FIND_ART_TEXT_LIMIT=32768;
function findArtText(value,max=200){
 const input=String(value||'').slice(0,FIND_ART_TEXT_LIMIT),parts=[];let cursor=0;
 while(cursor<input.length){
  const open=input.indexOf('<',cursor);
  if(open<0){parts.push(input.slice(cursor));break;}
  const end=input.indexOf('>',open+1);
  if(end<0){parts.push(input.slice(cursor));break;}
  parts.push(input.slice(cursor,open),' ');cursor=end+1;
 }
 return parts.join('').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi,s=>{const names={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '};if(names[s.toLowerCase()])return names[s.toLowerCase()];const n=s[2].toLowerCase()==='x'?parseInt(s.slice(3),16):parseInt(s.slice(2),10);return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):'';}).replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export function normaliseFindArtHistory(value){
  const result=[];
  for(const item of Array.isArray(value)?value:[]){const query=findArtText(item?.query,100),source=item?.source;if(!query||!validFindSourceId(source)||result.some(x=>x.query.toLowerCase()===query.toLowerCase()))continue;result.push({query,source});if(result.length===5)break;}
  return result;
}
export const rememberFindArtSearch=(history,source,query)=>normaliseFindArtHistory([{source,query},...normaliseFindArtHistory(history)]);
export function findArtUrl(value,source,kind='image'){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!FIND_ART_HOSTS[source]?.[kind]?.includes(url.hostname))throw new Error('The art source returned an unsupported address.');
  if(source==='artvee'&&(url.hash||(kind==='image'?!/^\/(?:sdl|sftb|ft)\/[a-z\d_-]+\.jpg$/i.test(url.pathname):!(url.pathname==='/'&&kind==='api'||/^\/dl\/[a-z\d-]+\/$/.test(url.pathname)))))throw new Error('Artvee returned an unsupported artwork address.');
  return url.href;
}
export function findArtRecord(source,item){
  if(source==='nga'||source==='commons'){
    const info=item?.imageinfo?.[0],meta=info?.extmetadata,field=name=>findArtText(meta?.[name]?.value),id=item?.pageid;
    if(!Number.isSafeInteger(id)||id<=0||info?.mime!=='image/jpeg'||!info.thumburl||!info.thumbwidth||!info.thumbheight||info.thumbwidth*info.thumbheight>2000000)return null;
    const name=field('LicenseShortName'),licence=field('LicenseUrl');let rights;
    try{const u=new URL(licence||'https://creativecommons.org/publicdomain/mark/1.0/');if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port||!['creativecommons.org','www.creativecommons.org'].includes(u.hostname))return null;
      if(name==='CC0'&&/^\/publicdomain\/zero\/1\.0(?:\/|$)/.test(u.pathname))rights='CC0 1.0';
      if(name==='Public domain'&&field('Copyrighted').toLowerCase()==='false'&&/^\/publicdomain\/mark\/1\.0(?:\/|$)/.test(u.pathname))rights='Public domain';
    }catch{return null;}if(!rights)return null;
    const original=Number(info.width)*Number(info.height)<=16000000&&Number(info.width)<=8192&&Number(info.height)<=8192&&Number(info.size)<=FIND_ART_IMAGE_LIMIT;
    try{return {id:'museum-nga-'+id,provider:source,providerId:id,title:field('ObjectName').split(/\b(?:title|label) QS:/)[0].trim()||findArtText(item.title).replace(/^File:/,'').replace(/\.jpe?g$/i,'')||'Untitled',artist:field('Artist')||'Artist unknown',date:field('DateTimeOriginal').split('date QS:')[0].trim(),publicDomain:true,rights,source:findArtUrl('https://commons.wikimedia.org/?curid='+id,source,'record'),image:findArtUrl(original?info.url:info.responsiveUrls?.['2']||info.thumburl,source),thumbnail:findArtUrl(info.thumburl,source)};}catch{return null;}
  }
  if(!Number.isSafeInteger(item?.id??item?.objectID))return null;
  if(source==='met'&&item.isPublicDomain===true&&item.primaryImageSmall){
    try{return {id:'museum-met-'+item.objectID,provider:source,providerId:item.objectID,title:findArtText(item.title)||'Untitled',artist:findArtText(item.artistDisplayName||item.culture)||'Artist unknown',date:findArtText(item.objectDate,100),publicDomain:true,rights:'CC0 1.0',source:findArtUrl(item.objectURL,source,'record'),image:findArtUrl(item.primaryImage||item.primaryImageSmall,source),thumbnail:findArtUrl(item.primaryImageSmall,source)};}catch{return null;}
  }
  return null;
}
// Parse only known text/attributes from bounded HTML. Never insert the page,
// execute its scripts, load frames, or use paid/authenticated download links.
function artveeHtml(html){
 const text=String(html);
 if(text.length>FIND_ART_JSON_LIMIT)throw new Error('This art response is too large for the TV.');
 const parts=[];let cursor=0,scan=0;
 while(scan<text.length){
  const open=text.indexOf('<',scan);if(open<0)break;
  if(text.startsWith('<!--',open)){
   parts.push(text.slice(cursor,open));const end=text.indexOf('-->',open+4);
   cursor=scan=end<0?text.length:end+3;
  }else{
   const tag=/^<(script|style)\b/i.exec(text.slice(open,open+9));
   if(!tag){scan=open+1;continue;}
   parts.push(text.slice(cursor,open));const end=text.indexOf('>',open+1);
   const closing=tag[1].toLowerCase()==='script'?/<\/script\s*>/gi:/<\/style\s*>/gi;
   closing.lastIndex=end<0?text.length:end+1;const match=end<0?null:closing.exec(text);
   // An unterminated comment/script/style consumes the remaining document.
   cursor=scan=match?closing.lastIndex:text.length;
  }
 }
 parts.push(text.slice(cursor));return parts.join('');
}
function artveeAttr(tag,name){
 const attrs=/(?:^|\s)([a-z][a-z\d:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
 for(const match of tag.matchAll(attrs))if(match[1].toLowerCase()===name)return findArtText(match[2]??match[3],4096);
 return '';
}
// Token positions and matching container ends are built once. Unclosed article
// or heading blocks cannot make a lazy wildcard retry for every opening tag.
function artveeDocument(html){
 const text=artveeHtml(html),tags=[],stacks={article:[],a:[],h1:[],div:[]};let scan=0;
 while(scan<text.length){
  const start=text.indexOf('<',scan);if(start<0)break;
  const end=text.indexOf('>',start+1);if(end<0)break;scan=end+1;
  if(end-start>8192)continue;
  const raw=text.slice(start,end+1),match=/^<(\/?)([a-z][a-z\d]*)\b[^<>]*>$/i.exec(raw);if(!match)continue;
  const name=match[2].toLowerCase();if(!['article','a','h1','div','meta'].includes(name))continue;
  if(tags.length>=20000)throw new Error('This art page is too complex for the TV.');
  const tag={name,start,end:end+1,raw,closing:!!match[1],close:-1};tags.push(tag);
  const stack=stacks[name];if(!stack)continue;
  if(tag.closing){const index=stack.pop();if(index!==undefined)tags[index].close=tags.length-1;}
  else if(!/\/\s*>$/.test(raw))stack.push(tags.length-1);
 }
 return {text,tags};
}
const artveeClass=(tag,name)=>artveeAttr(tag.raw,'class').split(/\s+/).includes(name);
export function findArtArtveeSearch(html){
  const items=[],{tags}=artveeDocument(html);
  for(let i=0;i<tags.length&&items.length<FIND_ART_PAGE_SIZE;i++){
    const tag=tags[i];if(tag.name!=='article'||tag.closing||tag.close<0)continue;
    const id=Number(/^post-(\d+)$/.exec(artveeAttr(tag.raw,'id'))?.[1]);let link;
    for(let j=i+1;j<tag.close;j++)if(tags[j].name==='a'&&!tags[j].closing&&tags[j].close>=0&&artveeAttr(tags[j].raw,'rel').split(/\s+/).includes('bookmark')){link=tags[j];break;}
    i=tag.close;if(!link||!Number.isSafeInteger(id)||id<=0||items.some(x=>x.id===id))continue;
    try{items.push({id,source:findArtUrl(artveeAttr(link.raw,'href'),'artvee','record')});}catch{}
  }
  return items;
}
export function findArtArtveeRecord(html,seed){
  const {text,tags}=artveeDocument(html),heading=tags.find(t=>t.name==='h1'&&!t.closing&&t.close>=0&&artveeClass(t,'product_title'));
  const downloads=tags.filter(t=>t.name==='div'&&!t.closing&&artveeClass(t,'w3eden')&&artveeClass(t,'dl_med')),block=downloads[0];
  if(!heading||!block||block.close<0||!text.includes('All public domain files can be freely used for personal and commercial projects.')||!tags.some(t=>!t.closing&&artveeAttr(t.raw,'id')==='product-'+seed.id))return null;
  const end=downloads[1]?.start??tags[block.close].start,standard=text.slice(block.end,end);
  const size=standard.match(/Standard,\s*(\d+)\s*x\s*(\d+)px/),bytes=standard.match(/JPG,\s*Size:\s*([\d.]+)\s*(KB|MB)/i);
  const link=tags.find(t=>t.name==='a'&&!t.closing&&t.start>=block.end&&t.start<end&&artveeAttr(t.raw,'href').startsWith('https://mdl.artvee.com/sdl/'));
  const imageTag=tags.find(t=>t.name==='meta'&&!t.closing&&artveeAttr(t.raw,'property')==='og:image');
  if(!size||!bytes||!link||!imageTag||Number(size[1])*Number(size[2])>16000000||Number(size[1])>8192||Number(size[2])>8192||Number(bytes[1])*(bytes[2].toUpperCase()==='MB'?1048576:1024)>FIND_ART_IMAGE_LIMIT)return null;
  try{const source=findArtUrl(seed.source,'artvee','record');
    const headingLink=tags.find(t=>t.name==='a'&&!t.closing&&t.start>=heading.end&&t.start<tags[heading.close].start);
    if(!headingLink||artveeAttr(headingLink.raw,'href')!==source)return null;
    const title=findArtText(text.slice(heading.end,tags[heading.close].start)),artistBlock=tags.find(t=>t.name==='div'&&!t.closing&&t.close>=0&&artveeClass(t,'tartist'));
    const artist=artistBlock&&tags.find(t=>t.name==='a'&&!t.closing&&t.close>=0&&t.start>=artistBlock.end&&t.start<tags[artistBlock.close].start&&artveeAttr(t.raw,'href').startsWith('https://artvee.com/artist/'));
    return {id:'museum-artvee-'+seed.id,provider:'artvee',providerId:seed.id,title:title.replace(/\s*\(\d{4}(?:[–-]\d{4})?\)\s*$/,'')||'Untitled',artist:findArtText(artist?text.slice(artist.end,tags[artist.close].start):'')||'Artist unknown',date:title.match(/\((\d{4}(?:[–-]\d{4})?)\)\s*$/)?.[1]||'',publicDomain:true,rights:'Public domain (Artvee)',source,image:findArtUrl(artveeAttr(link.raw,'href'),'artvee'),thumbnail:findArtUrl(artveeAttr(imageTag.raw,'content'),'artvee').replace('/sftb/','/ft/')};
  }catch{return null;}
}
// Validate encoded dimensions before allocating an image decoder/canvas.
export function findArtJpegSize(bytes){
  if(bytes[0]!==255||bytes[1]!==216)throw new Error('The museum did not return a JPEG image.');
  let i=2;
  while(i+8<bytes.length){
    if(bytes[i++]!==255)break;
    while(bytes[i]===255)i++;
    const marker=bytes[i++];
    if(marker===218||marker===217)break;
    if(marker===1||(marker>=208&&marker<=215))continue;
    const length=bytes[i]*256+bytes[i+1];
    if(length<2||i+length>bytes.length)break;
    if([192,193,194].includes(marker)){
      const height=bytes[i+3]*256+bytes[i+4],width=bytes[i+5]*256+bytes[i+6];
      if(!width||!height||width>8192||height>8192||width*height>16000000)throw new Error('This image is too large for the TV. Choose another artwork.');
      return {width,height};
    }
    i+=length;
  }
  throw new Error('The museum image could not be read. Choose another artwork.');
}
async function findArtRead(response,limit,signal){
  if(!response.ok||Number(response.headers.get('Content-Length'))>limit){
    await response.body?.cancel().catch(()=>{});
    if(!response.ok)throw new Error(response.status===429?'The art source is busy. Please try again shortly.':'The art source could not be reached. Try again or choose another source.');
    throw new Error('This art response is too large for the TV.');
  }
  if(!response.body?.getReader)throw new Error('This TV cannot safely download this image.');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){if(signal.aborted)throw new DOMException('Cancelled','AbortError');const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new Error('This art response is too large for the TV.');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export class FindArtCatalog {
  constructor(fetcher=(...args)=>fetch(...args)){this.fetcher=fetcher;this.cache=new Map();this.controller=null;this.generation=0;this.sources=normaliseFindSources();}
  configure(value){this.cancel();this.cache.clear();this.sources=normaliseFindSources(value);}
  cancel(){this.generation++;this.controller?.abort();this.controller=null;}
  async request(url,source,kind,signal,limit){
    findArtUrl(url,source,kind);
    // The optional loopback browser preview relays Artvee's non-CORS pages.
    // Packaged TVs request Artvee directly; no companion is used on the TV.
    const proxy=source==='artvee'&&globalThis.SART_CONFIG?.artveePreviewProxy===true&&['127.0.0.1','localhost'].includes(globalThis.location?.hostname);
    const response=await this.fetcher(proxy?'/api/manage/artvee?url='+encodeURIComponent(url):url,{signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',redirect:'error'});
    try{if(response.url&&!proxy)findArtUrl(response.url,source,kind);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
    return findArtRead(response,limit,signal);
  }
  async text(url,source,signal){return new TextDecoder().decode(await this.request(url,source,'api',signal,FIND_ART_JSON_LIMIT));}
  async json(url,source,signal){try{return JSON.parse(await this.text(url,source,signal));}catch(error){if(error instanceof SyntaxError)throw new Error('The art source returned an unreadable search. Try again.');throw error;}}
  async search(source,query,page=0){
    const selected=this.sources.sources.find(s=>s.id===source&&s.enabled);if(!selected)throw new Error('Choose an art source. Enable it in Manage sources first.');
    const provider=selected.kind==='commons'?'commons':selected.id;
    query=findArtText(query,100);
    if(!query)throw new Error('Enter an artist or subject.');
    if(!Number.isInteger(page)||page<0||page>=100)throw new Error('Try a more specific search to see more artwork.');
    this.cancel();const generation=this.generation,key=JSON.stringify([source,query,page]),cached=this.cache.get(key);
    if(cached&&Date.now()-cached.at<600000){this.cache.delete(key);this.cache.set(key,cached);return cached.result;}
    const controller=new AbortController();this.controller=controller;const signal=controller.signal,timer=setTimeout(()=>controller.abort(),20000);
    try{
      let result;
      if(source==='nga'||selected.kind==='commons'){
        const url=new URL('https://commons.wikimedia.org/w/api.php');
        url.search=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:'('+query.replace(/["\\|:()]/g,' ')+') incategory:"'+(selected.category||'Images from the National Gallery of Art')+'" filetype:bitmap',gsrnamespace:'6',gsrlimit:String(FIND_ART_PAGE_SIZE),gsroffset:String(page*FIND_ART_PAGE_SIZE),prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'640',iiurlheight:'480',iiextmetadatalanguage:'en',iiextmetadatafilter:'ObjectName|Artist|DateTimeOriginal|LicenseShortName|LicenseUrl|Copyrighted'}).toString();
        const json=await this.json(url.href,provider,signal);
        if(json.error||!Object.prototype.hasOwnProperty.call(json,'batchcomplete')&&!json.query)throw new Error('This Commons category could not be searched. Try another subject.');
        const pages=Object.values(json.query?.pages||{}).sort((a,b)=>a.index-b.index).slice(0,FIND_ART_PAGE_SIZE);
        result={items:pages.map(item=>findArtRecord(provider,item)).filter(Boolean).map(item=>({...item,sourceName:selected.name,catalogSourceId:selected.id})),more:Number.isInteger(json.continue?.gsroffset)&&page<99};
      }else if(source==='artvee'){
        const url=new URL('https://artvee.com/');url.search=new URLSearchParams({s:query,posts_per_page:String(FIND_ART_PAGE_SIZE),paged:String(page+1)}).toString();
        const html=await this.text(url.href,source,signal),seeds=findArtArtveeSearch(html);
        if(!seeds.length&&!/Nothing Found|No (?:results|products)|Sorry, no|search-no-results|class=["'][^"']*no-results/i.test(html))throw new Error('Artvee changed its search page or is unavailable. Try another art source.');
        const records=new Array(seeds.length);let cursor=0,failed=0;
        const worker=async()=>{while(cursor<seeds.length){const index=cursor++;try{records[index]=findArtArtveeRecord(await this.text(seeds[index].source,source,signal),seeds[index]);if(!records[index])failed++;}catch(error){if(signal.aborted)throw error;failed++;}}};
        await Promise.all([worker(),worker()]);
        if(seeds.length&&failed===seeds.length)throw new Error('Artvee could not load free images for these results. Try another search or source.');
        result={items:records.filter(Boolean),more:seeds.length===FIND_ART_PAGE_SIZE&&page<99,partial:failed>0};
      }else{
        const url=new URL('https://collectionapi.metmuseum.org/public/collection/v1.1/search');
        url.search=new URLSearchParams({q:query,hasImages:'true',limit:String(FIND_ART_PAGE_SIZE),offset:String(page*FIND_ART_PAGE_SIZE)}).toString();
        const json=await this.json(url.href,source,signal),ids=(json.objectIDs||[]).slice(0,FIND_ART_PAGE_SIZE);
        if(!Array.isArray(json.objectIDs)&&json.objectIDs!==null)throw new Error('The museum returned an unreadable search.');
        const records=new Array(ids.length);let cursor=0,failed=0;
        const worker=async()=>{while(cursor<ids.length){const index=cursor++,id=ids[index];if(!Number.isSafeInteger(id))continue;try{records[index]=findArtRecord(source,await this.json('https://collectionapi.metmuseum.org/public/collection/v1/objects/'+id,source,signal));}catch(error){if(signal.aborted)throw error;failed++;}}};
        await Promise.all([worker(),worker()]);
        if(ids.length&&failed===ids.length)throw new Error('The museum could not load these artworks. Try again.');
        result={items:records.filter(Boolean),more:(page+1)*FIND_ART_PAGE_SIZE<Number(json.total)&&page<99,partial:failed>0};
      }
      if(generation!==this.generation||signal.aborted)throw new DOMException('Cancelled','AbortError');
      this.cache.set(key,{result,at:Date.now()});while(this.cache.size>4)this.cache.delete(this.cache.keys().next().value);
      return result;
    }catch(error){if(signal.aborted&&generation===this.generation)throw new Error('The art source took too long to reply. Try again.');throw error;}
    finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
  async testSource(draft,signal){
    const catalog=new FindArtCatalog(this.fetcher),abort=()=>catalog.cancel();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(abort,20000);
    try{
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      let sample,category;
      if(draft.kind==='commons'){
        const controller=new AbortController();catalog.controller=controller;const url=new URL('https://commons.wikimedia.org/w/api.php');
        url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',origin:'*',titles:'Category:'+draft.category,prop:'categoryinfo',redirects:'1'}).toString();
        const info=await catalog.json(url.href,'commons',controller.signal),page=info.query?.pages?.[0];
        if(!page||page.ns!==14||!page.categoryinfo)throw new Error('That Commons category was not found. Check its name or category URL.');
        category=page.title.replace(/^Category:/,'');
        if(!page.categoryinfo.files)throw new Error('This category contains no direct images. Choose a more specific image category.');
        let continuation={};
        for(let attempt=0;attempt<3&&!sample;attempt++){
          url.search=new URLSearchParams({action:'query',format:'json',origin:'*',generator:'search',gsrsearch:'incategory:"'+category+'" filetype:bitmap',gsrnamespace:'6',gsrlimit:'8',gsroffset:String(attempt*8),prop:'imageinfo',iiprop:'url|size|mime|extmetadata',iiurlwidth:'640',iiurlheight:'480',iiextmetadatalanguage:'en',iiextmetadatafilter:'ObjectName|Artist|DateTimeOriginal|LicenseShortName|LicenseUrl|Copyrighted',...continuation}).toString();
          const result=await catalog.json(url.href,'commons',controller.signal);sample=Object.values(result.query?.pages||{}).map(p=>findArtRecord('commons',p)).find(Boolean);
          if(!result.continue)break;continuation=result.continue;
        }
        if(!sample)throw new Error('No compatible public-domain JPEG was found in the first 24 files. Try another image category.');
      }else{sample=(await catalog.search(draft.id,'landscape')).items[0];if(!sample)throw new Error('No eligible sample artwork was returned. Try this source again later.');}
      const controller=catalog.controller||new AbortController();catalog.controller=controller;
      const bytes=await catalog.request(sample.thumbnail,sample.provider,'image',controller.signal,2*1024*1024);findArtJpegSize(bytes);
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');return {...sample,category};
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);catalog.cancel();}
  }
  async image(record){
    if(record.publicDomain!==true||!({nga:['CC0 1.0','Public domain'],commons:['CC0 1.0','Public domain'],met:['CC0 1.0'],artvee:['Public domain (Artvee)']}[record.provider]?.includes(record.rights)))throw new Error('Only source-confirmed public-domain artwork can be saved.');
    this.cancel();const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),30000);
    try{
      // Standard Artvee links expire. Resolve the same public record again at
      // save time and require the original identity/rights before downloading.
      if(record.provider==='artvee'){
        const fresh=findArtArtveeRecord(await this.text(record.source,'artvee',controller.signal),{id:record.providerId,source:record.source});
        if(!fresh||fresh.id!==record.id)throw new Error('Artvee no longer offers a free public-domain copy of this artwork.');
        record={...fresh};
      }
      let bytes;
      try{bytes=await this.request(record.image,record.provider,'image',controller.signal,FIND_ART_IMAGE_LIMIT);findArtJpegSize(bytes);}
      catch(error){if(controller.signal.aborted||record.image===record.thumbnail)throw error;bytes=await this.request(record.thumbnail,record.provider,'image',controller.signal,FIND_ART_IMAGE_LIMIT);findArtJpegSize(bytes);}
      return new Blob([bytes],{type:'image/jpeg'});
    }finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
  }
}
