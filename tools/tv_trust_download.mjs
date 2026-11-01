// Provision an existing public root only. Never issue keys or change OS trust.
import {readFile} from 'node:fs/promises';
import {connectTvInspector} from './tv_cdp.mjs';
const sdk=await connectTvInspector();
try{
 const certificate=Buffer.from(await readFile('dist/TV-certificate/SART-TV-Trust.cer')).toString('base64');
 const result=await sdk.read(`window.SART_HTTPS_SETUP.provisionTrust(${JSON.stringify(certificate)})`);
 console.log(JSON.stringify(result));
}finally{sdk.close();}
