// Provision only public certificates through the standard Samsung SDK inspector.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {connectTvInspector} from './tv_cdp.mjs';
const root=path.resolve(import.meta.dirname,'..');
const args=process.argv.slice(2),option=(name,fallback)=>{const n=args.indexOf(name);return n<0?fallback:args[n+1];};
const model=option('--model','UA50DU7700WXXY');
const config=await fs.readFile(path.join(root,'.local/developer-targets.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
if(!['UA50DU7700WXXY','QA55LS03BAWXXY'].includes(model))throw new Error('Select a registered TV model.');
const target={ip:option('--tv',process.env.SART_TV_HOST||config.targets?.[model]?.ip),port:Number(option('--port',config.targets?.[model]?.port||9223))};
if(!target.ip)throw new Error('Provide --tv ADDRESS or set SART_TV_HOST.');
const python=process.env.SART_PYTHON||path.join(root,'.venv/bin/python');
const sdk=await connectTvInspector(target.port);
try{
 const info=await sdk.read(`(async()=>{
  if(!window.SART_HTTPS_SETUP)throw new Error('Install the HTTPS build first.');
  const response=await fetch('http://127.0.0.1:8001/api/v2/');
  const identity=(await response.json()).device;
  return {ip:window.webapis.network.getIp(),model:identity.modelName};
 })()`);
 if(info.ip!==target.ip||info.model!==model)throw new Error('TV identity or address changed; verify the target before provisioning.');
 const request=await sdk.read('window.SART_HTTPS_SETUP.request()');
 const requestPath=path.join(root,'.local/https-request-'+model+'.json');await fs.writeFile(requestPath,JSON.stringify(request));
 const result=JSON.parse(execFileSync(python,[
  'tools/https_certificate.py','--request',requestPath,'--ip',info.ip],{cwd:root,encoding:'utf8'}));
 const identity=JSON.parse(await fs.readFile(result.provision,'utf8'));
 const publicRoot=Buffer.from(await fs.readFile(result.publicCertificate)).toString('base64');
 identity.rootCertificate=publicRoot;
 const provisioned=await sdk.read(`window.SART_HTTPS_SETUP.provision(${JSON.stringify(identity)})`);
 const publicDirectory=path.join(root,model==='UA50DU7700WXXY'?'dist/TV-certificate':'dist/TV-certificates/'+model);await fs.mkdir(publicDirectory,{recursive:true});
 await fs.copyFile(result.publicCertificate,path.join(publicDirectory,'SART-TV-Trust.cer'));
 await fs.copyFile(result.publicCertificate.replace(/\.cer$/,'.pem'),path.join(publicDirectory,'SART-TV-Trust.pem'));
 const report={...provisioned,certificate:path.join(publicDirectory,'SART-TV-Trust.cer'),url:'https://'+info.ip+':8768/',
  authorityKeyLocation:'Mac only; .local/https-v2; excluded from packages',tvKeyStorage:'AES-GCM wrapped; non-extractable app-origin wrapping key',manualTrustRequired:true};
 await fs.writeFile(path.join(publicDirectory,'certificate-info.json'),JSON.stringify(report,null,2)+'\n');
 execFileSync(python,['tools/https_trust_files.py','--directory',publicDirectory],{cwd:root});
 console.log(JSON.stringify(report,null,2));
}finally{sdk.close();}
