import {getSetting,setSetting} from './storage.mjs';
import {mobileId} from './mobile-shared.mjs';
import {mobileSetupAssets} from './mobile-setup.mjs';
const HTTPS_KEY='httpsIdentityV1';
export const tlsBase64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const tlsUnbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export function tlsIdentityReady(record,ip,now=Date.now()){
 if(!record?.certificate)throw new Error('HTTPS needs its one-time certificate setup. Complete TV certificate setup on your computer, then trust this TV’s certificate on your phone or PC.');
 if(record.ip!==ip)throw new Error('The TV’s network address changed. Renew its HTTPS certificate on your computer before connecting.');
 if(!Number.isFinite(record.notBefore)||!Number.isFinite(record.notAfter)||record.notAfter<=record.notBefore||now<record.notBefore||now>=record.notAfter)throw new Error('The TV’s HTTPS certificate needs renewal, or the TV’s date and time are incorrect.');
 return record;
}
// The leaf key is wrapped on the TV. Only the public request leaves the TV.
// CryptoKey storage is app-origin protection, not a claim of hardware backing.
export async function tlsCertificateRequest(){
 if(!crypto.subtle)throw new Error('Secure key storage is unavailable on this TV.');
 let record=await getSetting(HTTPS_KEY);
 if(!record){
  const wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['wrapKey','unwrapKey']);
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const wrapped=await crypto.subtle.wrapKey('pkcs8',pair.privateKey,wrappingKey,{name:'AES-GCM',iv});
  record={id:mobileId(),wrappingKey,iv,wrapped,spki:tlsBase64(await crypto.subtle.exportKey('spki',pair.publicKey))};
  await setSetting(HTTPS_KEY,record);
  // Read it back: a browser that cannot persist CryptoKey must fail closed.
  record=await getSetting(HTTPS_KEY);
  const check=await crypto.subtle.unwrapKey('pkcs8',record.wrapped,record.wrappingKey,{name:'AES-GCM',iv:record.iv},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  if(check.extractable)throw new Error('Secure key storage could not be verified.');
 }
 return {id:record.id,spki:record.spki};
}
export async function tlsProvisionCertificate(publicIdentity){
 const record=await getSetting(HTTPS_KEY);
 if(!record||publicIdentity.id!==record.id||publicIdentity.spki!==record.spki)throw new Error('This certificate belongs to a different TV identity.');
 if(!/^[A-Za-z0-9+/=]{200,10000}$/.test(publicIdentity.certificate)||!Number.isFinite(publicIdentity.notAfter)||!Number.isFinite(publicIdentity.notBefore))throw new Error('Invalid TV certificate.');
 tlsIdentityReady(publicIdentity,publicIdentity.ip);
 if(publicIdentity.rootCertificate)await mobileSetupAssets(publicIdentity);
 await setSetting(HTTPS_KEY,{...record,certificate:publicIdentity.certificate,ip:publicIdentity.ip,notBefore:publicIdentity.notBefore,notAfter:publicIdentity.notAfter,rootFingerprint:publicIdentity.rootFingerprint,authorityPolicyVersion:publicIdentity.authorityPolicyVersion||1,...(publicIdentity.rootCertificate?{rootCertificate:publicIdentity.rootCertificate}:{})});
 return {id:record.id,ip:publicIdentity.ip,notAfter:publicIdentity.notAfter,rootFingerprint:publicIdentity.rootFingerprint,authorityPolicyVersion:publicIdentity.authorityPolicyVersion||1};
}
export async function tlsServerIdentity(ip){
 return tlsIdentityReady(await getSetting(HTTPS_KEY),ip);
}
export async function tlsProvisionTrust(rootCertificate){
 const record=await getSetting(HTTPS_KEY);
 if(!record?.certificate)throw new Error('Provision this TV’s HTTPS certificate first.');
 await mobileSetupAssets({...record,rootCertificate});
 await setSetting(HTTPS_KEY,{...record,rootCertificate});
 return {id:record.id,rootFingerprint:record.rootFingerprint,publicDownloadReady:true};
}
// SDK-only local provisioning surface: public material in and out, no key export.
if(typeof window!=='undefined')window.SART_HTTPS_SETUP={request:tlsCertificateRequest,provision:tlsProvisionCertificate,provisionTrust:tlsProvisionTrust};
