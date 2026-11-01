import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseSettings, normaliseLook, artworkLook, applyGlobalAppearance, FRAMES, MAT_STYLES, validateLibraryUrl, nextIndex, spatialTarget, validateManifest, safeText } from '../app/core.mjs';

test('a slideshow wraps in both directions and shuffle never repeats the current image',()=>{
  assert.equal(nextIndex(3,4),0);assert.equal(nextIndex(0,4,-1),3);assert.equal(nextIndex(0,0),-1);assert.equal(nextIndex(0,1,1,true),0);
  for(let current=0;current<5;current++)for(let n=0;n<100;n++)assert.notEqual(nextIndex(current,5,1,true,()=>n/100),current);
});
test('remote navigation prefers the neighbouring card over a distant diagonal',()=>{
  const cards=[{id:'hero',x:100,y:200},{id:'top',x:300,y:100},{id:'right',x:300,y:200},{id:'bottom',x:300,y:400}];
  assert.equal(spatialTarget(cards[0],cards,'right'),'right');assert.equal(spatialTarget(cards[1],cards,'down'),'right');assert.equal(spatialTarget(cards[0],cards,'left'),null);
});
test('library connection accepts local origins and rejects credentials, public sites and path tricks',()=>{
  assert.equal(validateLibraryUrl('10.20.30.21:8767'),'https://10.20.30.21:8767');assert.equal(validateLibraryUrl('https://localhost:8767/'),'https://localhost:8767');
  for(const url of ['http://10.20.30.21:8767','https://example.com','http://10.20.30.21.evil.com','http://user:pass@10.20.30.21','file:///etc/passwd','http://10.20.30.21/photos','http://10.20.30.21/?token=secret'])assert.throws(()=>validateLibraryUrl(url));
});
test('corrupt persisted preferences cannot set invalid fit, mat or timing',()=>{
  const p=normaliseSettings({interval:-1,brightness:100,matte:'bad',fit:'stretch',resume:'true'});assert.equal(p.interval,300);assert.equal(p.brightness,1);assert.equal(p.matte,'paper');assert.equal(p.fit,'cover');assert.equal(p.resume,false);
  assert.equal(normaliseSettings().fit,'cover');assert.equal(normaliseSettings({fit:'contain'}).fit,'contain');
  assert.equal(normaliseSettings({contrast:100}).contrast,1.5);assert.equal(normaliseSettings({contrast:-1}).contrast,.5);assert.equal(normaliseSettings({contrast:'bad'}).contrast,1);
});
test('slideshow effect preferences preserve every existing timer and validate saved choices',()=>{
 for(const interval of [30,60,300,900,3600]){
  const legacy=normaliseSettings({interval,order:'shuffle',resume:true});
  assert.equal(legacy.interval,interval);assert.equal(legacy.order,'shuffle');assert.equal(legacy.resume,true);
  assert.equal(legacy.transition,'crossfade');assert.equal(legacy.transitionDuration,1);assert.equal(legacy.motion,'off');
  for(const transition of ['none','crossfade','dark','slide'])for(const transitionDuration of [.5,1,2]){
   const roundtrip=normaliseSettings(JSON.parse(JSON.stringify({...legacy,transition,transitionDuration,motion:'gentle'})));
   assert.equal(roundtrip.interval,interval);assert.equal(roundtrip.transition,transition);assert.equal(roundtrip.transitionDuration,transitionDuration);assert.equal(roundtrip.motion,'gentle');
  }
 }
 const corrupt=normaliseSettings({transition:'<script>',transitionDuration:300,motion:'fast',interval:60});
 assert.equal(corrupt.interval,60);assert.equal(corrupt.transition,'crossfade');assert.equal(corrupt.transitionDuration,1);assert.equal(corrupt.motion,'off');
});
test('untrusted library manifests reject path traversal, duplicate IDs and excessive photo sizes',()=>{
  const photo={id:'12345678-abcd-abcd-abcd-123456789abc',bytes:100,sha256:'a'.repeat(64),title:'My photo'};assert.equal(validateManifest({items:[photo]}).length,1);
  assert.throws(()=>validateManifest({items:[{...photo,id:'../../secret'}]}));assert.throws(()=>validateManifest({items:[photo,photo]}));assert.throws(()=>validateManifest({items:[{...photo,bytes:100_000_000}]}));
});
test('photo titles cannot inject markup into the gallery',()=>{assert.equal(safeText('<img src=x onerror="bad()">'),'&lt;img src=x onerror=&quot;bad()&quot;&gt;');});
test('legacy artwork looks retain fit and mat without forcing a new frame',()=>{
  assert.deepEqual(normaliseLook({matte:'ink',fit:'contain'}),{matte:'ink',fit:'contain',frame:'none',matStyle:'flat'});
  for(const frame of Object.keys(FRAMES))assert.equal(normaliseLook({frame}).frame,frame);
  assert.deepEqual(normaliseLook({matte:'unknown',fit:'stretch',frame:'<invalid>',matStyle:'invalid'}),{matte:'paper',fit:'cover',frame:'none',matStyle:'flat'});
});
test('legacy bevel keeps its thin appearance and thick bevel works per artwork and globally',()=>{
 assert.equal(MAT_STYLES.bevel,'Bevelled thin');assert.equal(MAT_STYLES['bevel-thick'],'Bevelled thick');
 assert.equal(normaliseLook({matStyle:'bevel'}).matStyle,'bevel');
 assert.equal(normaliseSettings({matStyle:'bevel'}).matStyle,'bevel');
 assert.equal(artworkLook(normaliseSettings(),{matStyle:'bevel-thick'}).matStyle,'bevel-thick');
 const result=applyGlobalAppearance(normaliseSettings({interval:60}),{art:{fit:'contain',matStyle:'bevel'}},{matte:'linen',frame:'walnut',matStyle:'bevel-thick'});
 assert.equal(result.settings.interval,60);assert.equal(artworkLook(result.settings,result.looks.art).matStyle,'bevel-thick');
 assert.equal(artworkLook(result.settings,result.looks.art).fit,'contain');assert.equal(artworkLook(result.settings).matStyle,'bevel-thick');
});

test('applying a global appearance reaches existing and future artwork while preserving fit and playback preferences',()=>{
  const settings=normaliseSettings({interval:60,brightness:.65,contrast:1.2,fit:'cover'});
  const looks={landscape:{matte:'ink',frame:'white',fit:'contain'},portrait:{matte:'linen',frame:'shadow',matStyle:'flat',fit:'cover'},futureMetadata:{fit:'contain',custom:'preserve'}};
  const original=JSON.stringify(looks);
  const result=applyGlobalAppearance(settings,looks,{matte:'antique',frame:'walnut',matStyle:'bevel'});
  assert.equal(JSON.stringify(looks),original);
  for(const id of [...Object.keys(looks),'new-upload']){
    const look=artworkLook(result.settings,result.looks[id]);
    assert.equal(look.matte,'antique');assert.equal(look.frame,'walnut');assert.equal(look.matStyle,'bevel');
    assert.equal(look.fit,looks[id]?.fit||'cover');
  }
  assert.equal(result.settings.interval,60);assert.equal(result.settings.brightness,.65);assert.equal(result.settings.contrast,1.2);
  assert.equal(result.looks.futureMetadata.custom,'preserve');
  assert.equal(artworkLook(result.settings,{...result.looks.portrait,frame:'teak'}).frame,'teak');
  assert.equal(artworkLook(result.settings,result.looks.landscape).frame,'walnut');
});
