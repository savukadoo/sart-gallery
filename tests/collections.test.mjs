import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DEMO_PHOTOS, BUILTIN_COLLECTIONS} from '../app/assets/catalog.mjs';
import {photosInCollection, nextIndex, normaliseLook, normalisePhotoCollections, assignPhotoCollection} from '../app/core.mjs';

test('moving included art changes its collection without changing identity, assets or appearance keys',()=>{
  const photo={...DEMO_PHOTOS[0],demo:true},group={id:'mobile-test',name:'My collection'};
  const assignments=assignPhotoCollection({},photo,group),moved={...photo,...assignments[photo.id]};
  assert.equal(photosInCollection([moved],photo.collectionId).length,0);
  assert.deepEqual(photosInCollection([moved],group.id),[moved]);
  const {collectionId:oldId,collectionName:oldName,...original}=photo;
  const {collectionId:newId,collectionName:newName,...retained}=moved;
  assert.deepEqual(retained,original);
  assert.deepEqual(assignPhotoCollection(assignments,moved,{id:photo.collectionId,name:'Original'})[photo.id],{collectionId:photo.collectionId,collectionName:'Original'});
});

test('moving an uploaded photo preserves its stored bytes and works after reloading assignments',()=>{
  const blob=new Blob(['photo']),photo={id:'upload-1',blob,sha256:'same-hash',collectionId:'my-photos',title:'Original'};
  const stored=JSON.parse(JSON.stringify(assignPhotoCollection({},photo,{id:'shape-colour',name:'Shape & Colour'})));
  const moved={...photo,...normalisePhotoCollections(stored,[photo])[photo.id]};
  assert.equal(moved.blob,blob);assert.equal(moved.sha256,photo.sha256);assert.equal(moved.id,photo.id);
  assert.equal(moved.collectionId,'shape-colour');assert.equal(photo.collectionId,'my-photos');
});

test('collection assignments reject unknown photos and malformed destinations and cap collection names',()=>{
  const photos=[{id:'one'},{id:'two'},{id:'three'},{id:'four'}];
  assert.deepEqual(normalisePhotoCollections({one:{collectionId:'bad/path',collectionName:'Bad'},two:{collectionId:'my-photos',collectionName:' '},three:{collectionId:'museum-example',collectionName:'  New  '},four:{collectionId:'light-water',collectionName:'A'.repeat(120)},unknown:{collectionId:'my-photos',collectionName:'Unknown'}},photos),{three:{collectionId:'museum-example',collectionName:'New'},four:{collectionId:'light-water',collectionName:'A'.repeat(80)}});
  for(const value of [null,[],false,'bad'])assert.deepEqual(normalisePhotoCollections(value,photos),{});
  assert.throws(()=>assignPhotoCollection({},photos[0],{id:'bad',name:'Invalid'}),/Choose a collection/);
});

test('four offline collections contain 15 distinct, credited public-domain artworks each',()=>{
  assert.equal(BUILTIN_COLLECTIONS.length,4);
  assert.equal(DEMO_PHOTOS.length,60);
  assert.equal(new Set(DEMO_PHOTOS.map(p=>p.id)).size,60);
  for(const group of BUILTIN_COLLECTIONS){
    const photos=photosInCollection(DEMO_PHOTOS,group.id);
    assert.equal(photos.length,15,group.name);
    assert.ok(photos.some(p=>p.id===group.coverId));
    for(const photo of photos){
      assert.ok(photo.artist && photo.title && photo.date);
      assert.equal(photo.publicDomain,true);
      assert.match(photo.source,/^https:\/\/(www\.artic\.edu\/artworks|clevelandart\.org\/art|artvee\.com\/dl)\//);
      assert.match(photo.url,/^assets\/[a-z0-9-]+\.jpg$/);
      assert.match(photo.thumbnail,/^assets\/[a-z0-9-]+-thumb\.jpg$/);
    }
  }
});

test('Japan & China retains its collection ID and balances eight Japanese with seven Chinese works',()=>{
  assert.equal(BUILTIN_COLLECTIONS.find(c=>c.id==='japan-print').name,'Japan & China');
  const photos=photosInCollection(DEMO_PHOTOS,'japan-print');
  assert.equal(photos.filter(p=>p.country==='Japan').length,8);
  assert.equal(photos.filter(p=>p.country==='China').length,7);
  const provenance=JSON.parse(fs.readFileSync(new URL('../app/assets/provenance.json',import.meta.url),'utf8'));
  for(const photo of photos){
    const record=provenance.artworks.find(p=>p.id===photo.id);
    assert.ok(record.museumCulture.some(c=>c.includes(photo.country)),photo.title);
  }
});

test('collection playback wraps inside the chosen collection in both directions and shuffle',()=>{
  for(const group of BUILTIN_COLLECTIONS){
    const photos=photosInCollection(DEMO_PHOTOS,group.id);
    assert.equal(photos[nextIndex(14,photos.length)].id,photos[0].id);
    assert.equal(photos[nextIndex(0,photos.length,-1)].id,photos[14].id);
    for(let n=0;n<100;n++){
      const next=nextIndex(7,photos.length,1,true,()=>n/100);
      assert.notEqual(next,7);
      assert.equal(photos[next].collectionId,group.id);
    }
  }
  const legacyUpload={id:'user-photo'},legacyDemo={id:'old-demo',demo:true};
  assert.deepEqual(photosInCollection([legacyUpload,...DEMO_PHOTOS],'my-photos'),[legacyUpload]);
  assert.deepEqual(photosInCollection([legacyDemo],'light-water'),[legacyDemo]);
});

test('existing demo IDs keep favourites and saved artwork appearance addressable',()=>{
  for(const id of ['demo-27992','demo-16568','demo-28560','demo-20684']){
    assert.equal(DEMO_PHOTOS.find(p=>p.id===id)?.collectionId,'light-water');
    const looks={[id]:{matte:'antique',fit:'contain',frame:'walnut'}};
    assert.deepEqual(normaliseLook(looks[id]),{...looks[id],matStyle:'flat'});
  }
});

test('all shipped images match the source-rights manifest and stay inside the asset budget',()=>{
  const root=path.resolve(import.meta.dirname,'../app');
  const provenance=JSON.parse(fs.readFileSync(path.join(root,'assets/provenance.json'),'utf8'));
  assert.equal(provenance.artworks.length,60);
  assert.equal(new Set(provenance.artworks.map(p=>p.imageId)).size,60);
  let total=0;
  for(const photo of DEMO_PHOTOS){
    const record=provenance.artworks.find(p=>p.id===photo.id);
    assert.equal(record.source,photo.source);
    assert.equal(record.rights,record.provider==='artvee'?'Public domain (Artvee)':'CC0 public-domain museum image');
    assert.equal(record.policy,record.provider==='artvee'?'https://artvee.com/terms-of-service/':record.provider==='aic'?'https://www.artic.edu/open-access/open-access-images':'https://www.clevelandart.org/open-access');
    assert.ok(Math.max(...record.displayDimensions)<=1920);
    for(const [key,hashKey] of [['url','sha256'],['thumbnail','thumbnailSha256']]){
      const bytes=fs.readFileSync(path.join(root,photo[key]));
      assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),record[hashKey]);
      total+=bytes.length;
    }
  }
  const expected=DEMO_PHOTOS.flatMap(p=>[p.url,p.thumbnail]).map(p=>path.basename(p)).sort();
  assert.deepEqual(fs.readdirSync(path.join(root,'assets')).filter(p=>p.endsWith('.jpg')).sort(),expected,'Replaced images must not remain in the TV package');
  assert.ok(total<65_000_000,`Artwork assets exceed 65 MB: ${total}`);
});
