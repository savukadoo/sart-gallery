import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export async function tlsFixture(){
 const directory=mkdtempSync(path.join(tmpdir(),'sart-tls-test-'));
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['wrapKey','unwrapKey']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),wrapped=await crypto.subtle.wrapKey('pkcs8',pair.privateKey,wrappingKey,{name:'AES-GCM',iv});
 const request={id:crypto.randomUUID(),spki:Buffer.from(await crypto.subtle.exportKey('spki',pair.publicKey)).toString('base64')};
 writeFileSync(path.join(directory,'request.json'),JSON.stringify(request));
 const result=JSON.parse(execFileSync((process.env.SART_PYTHON||path.resolve(import.meta.dirname,'../.venv/bin/python')),[
  'tools/https_certificate.py','--request',path.join(directory,'request.json'),'--ip','10.20.30.80','--directory',directory],{cwd:new URL('..',import.meta.url),encoding:'utf8'}));
 const identity={...JSON.parse(readFileSync(result.provision,'utf8')),wrappingKey,iv,wrapped};
 return {identity,ca:readFileSync(path.join(path.dirname(result.provision),'SART-TV-Trust.pem')),cleanup:()=>rmSync(directory,{recursive:true,force:true})};
}
