import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileSetupAssets,mobileSetupResponse} from '../app/mobile-setup.mjs';
import {tlsFixture} from './tls-fixture.mjs';
const request=(path='/',method='GET',headers='')=>new TextEncoder().encode(`${method} ${path} HTTP/1.1\r\nHost: 10.20.30.80:8769\r\n${headers}\r\n`);
test('certificate setup binds the public profile to this TV root and exposes no private key',async()=>{
 const f=await tlsFixture();
 try{
  const rootCertificate=Buffer.from(f.ca.toString().replace(/-----[^-]+-----|\s/g,'').trim(),'base64').toString('base64');
  const assets=await mobileSetupAssets({...f.identity,rootCertificate});
  const profile=assets['/SART-TV-Trust.mobileconfig'].body;
  assert.match(profile,/com.apple.security.root/);assert.ok(profile.includes(`<data>${rootCertificate}</data>`));
  assert.ok(!/PRIVATE KEY|VPN|com.apple.mdm|Bearer/.test(profile.replace('No management, VPN, accounts or private keys.','')));
  assert.equal(assets['/SART-TV-Trust.cer'].body.length,Buffer.from(rootCertificate,'base64').length);
  await assert.rejects(mobileSetupAssets({...f.identity,rootCertificate,rootFingerprint:'00:'.repeat(31)+'00'}),/does not match/);
  await assert.rejects(mobileSetupAssets(f.identity),/provisioned/);
 }finally{f.cleanup();}
});
test('HTTP setup only serves explicit public GET assets; APIs, POST, wrong hosts and origins are denied',()=>{
 const assets={'/':{body:'Setup only',type:'text/html'},'/SART-TV-Trust.mobileconfig':{body:'public profile',type:'application/x-apple-aspen-config'}};
 const text=bytes=>new TextDecoder().decode(bytes);
 assert.match(text(mobileSetupResponse(request(), '10.20.30.80:8769',assets)),/200 OK/);
 assert.match(text(mobileSetupResponse(request('/SART-TV-Trust.mobileconfig'),'10.20.30.80:8769',assets)),/application\/x-apple-aspen-config/);
 for(const path of ['/api/pair','/api/status','/mobile.js','/mobile.css','/photos','/authority-private.key','/../SART-TV-Trust.mobileconfig'])assert.match(text(mobileSetupResponse(request(path),'10.20.30.80:8769',assets)),/404 Not Found/);
 assert.match(text(mobileSetupResponse(request('/','POST'),'10.20.30.80:8769',assets)),/403 Forbidden/);
 assert.match(text(mobileSetupResponse(request(),'10.20.30.80:8768',assets)),/400 Bad Request/);
 assert.match(text(mobileSetupResponse(request('/','GET','Origin: http://evil.example\r\n'),'10.20.30.80:8769',assets)),/403 Forbidden/);
 assert.equal(mobileSetupResponse(new TextEncoder().encode('GET / HTTP/1.1\r\n'),'10.20.30.80:8769',assets),null);
});
