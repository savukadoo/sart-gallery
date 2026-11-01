// Read-only availability probe. Runs hostile responses in disposable workers;
// never contacts a museum, a TV, or a user's stored photo library.
import {Worker} from 'node:worker_threads';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const moduleUrl=new URL('../app/find-art.mjs',import.meta.url).href;
const output=process.argv[2];
const workerSource=`
const {parentPort,workerData}=require('node:worker_threads');
(async()=>{
 const {FindArtCatalog,findArtArtveeSearch}=await import(workerData.moduleUrl);
 const n=workerData.size;
 let responseBytes,run;
 if(workerData.kind==='commons-metadata'){
  const field=value=>({value});
  const record={pageid:7,title:'File:Audit fixture.jpg',imageinfo:[{
   mime:'image/jpeg',width:100,height:100,size:200,
   thumburl:'https://upload.wikimedia.org/audit.jpg',url:'https://upload.wikimedia.org/audit.jpg',thumbwidth:100,thumbheight:100,
   extmetadata:{ObjectName:field('Audit fixture'),Artist:field('<'.repeat(n)),LicenseShortName:field('Public domain'),Copyrighted:field('False')}
  }]};
  const text=JSON.stringify({batchcomplete:'',query:{pages:{7:record}}});responseBytes=Buffer.byteLength(text);
  const catalog=new FindArtCatalog(async()=>new Response(text,{headers:{'Content-Type':'application/json'}}));
  const id='commons-0123456789abcdef';
  catalog.configure({defaultId:id,sources:[{id,kind:'commons',name:'Audit fixture',category:'Audit fixture'}]});
  run=async()=>(await catalog.search(id,'test')).items.length;
 }else{
  const html='<!--'.repeat(Math.floor(n/4));responseBytes=Buffer.byteLength(html);
  run=async()=>findArtArtveeSearch(html).length;
 }
 const start=performance.now(),records=await run();
 parentPort.postMessage({responseBytes,elapsedMs:performance.now()-start,records});
})().catch(error=>parentPort.postMessage({error:String(error.stack||error)}));
`;
const results=[];
for(const kind of ['commons-metadata','artvee-comments']){
 for(const size of [8000,16000,32000,64000,128000,256000]){
  const worker=new Worker(workerSource,{eval:true,execArgv:[],workerData:{kind,size,moduleUrl},resourceLimits:{maxOldGenerationSizeMb:64}});
  let timer;
  const row=await new Promise((resolve,reject)=>{
   timer=setTimeout(()=>resolve({timeoutMs:3000}),3000);
   worker.once('message',resolve);worker.once('error',reject);
  }).finally(()=>clearTimeout(timer));
  await worker.terminate();
  results.push({kind,size,...row});
  if(row.error)throw new Error(row.error);
  if(row.timeoutMs)break;
 }
}
const result={timestamp:new Date().toISOString(),module:fileURLToPath(moduleUrl),metadataLimitBytes:512*1024,cutoffMs:3000,results};
if(output)await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
