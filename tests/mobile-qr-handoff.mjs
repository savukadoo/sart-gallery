// Local-only QA handoff: decode the actual TV QR, redirect a test browser to it,
// and never print the ephemeral pairing secret. Not part of the shipped widget.
import http from 'node:http';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {connectTvInspector} from '../tools/tv_cdp.mjs';
const {default:sharp}=await import(process.env.SART_SHARP_MODULE||('file://'+process.env.HOME+'/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp/dist/index.mjs'));
const require=createRequire(import.meta.url),decode=require('/private/tmp/sart-jsqr.cjs');
const sdk=await connectTvInspector();let url;
try{
 const svg=await sdk.read(`document.querySelector('.mobile-qr svg')?.outerHTML||''`);
 if(!svg)throw new Error('Open a fresh QR code on the TV first.');
 const {data,info}=await sharp(Buffer.from(svg)).resize(600,600).ensureAlpha().raw().toBuffer({resolveWithObject:true}),value=decode(new Uint8ClampedArray(data),info.width,info.height);
 if(!value?.data||!/^http:\/\/192\.168\.1\.80:8768\/#([a-f0-9]{48})$/.test(value.data))throw new Error('The TV QR did not decode correctly.');url=value.data;
 await writeFile('.local/qa/mobile-qr-verification.json',JSON.stringify({decoded:true,host:new URL(url).host,secretLogged:false})+'\n');
}finally{sdk.close();}
await sharp(fileURLToPath(new URL('../app/assets/16568.jpg',import.meta.url))).resize(1280,720,{fit:'inside'}).jpeg().toFile('.local/qa/SART-QA-landscape.jpg');
await sharp({create:{width:720,height:1080,channels:3,background:'#697d6d'}}).jpeg().toFile('.local/qa/SART-QA-portrait.jpg');
const server=http.createServer(async(req,res)=>{if(req.url==='/test-code'){try{const code=await readFile('.local/qa/pc-test-code.txt','utf8');res.writeHead(200,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end(code);return;}catch{res.writeHead(404);res.end();return;}}res.writeHead(302,{Location:url,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();});
server.listen(8769,'127.0.0.1',()=>console.log(JSON.stringify({qrDecoded:true,testEntry:'http://127.0.0.1:8769/',photosRelayed:false})));
process.on('SIGTERM',()=>server.close());
