import test from 'node:test';
import assert from 'node:assert/strict';
import {savedPhotoChanges,uploadedPhotoDuplicate} from '../app/core.mjs';
const photos=[{id:'phone',origin:'mobile',blob:new Blob(['photo'])},{id:'museum',origin:'museum'},{id:'pc',source:'https://10.20.30.2:8767'},{id:'other',origin:'mobile'}];

test('upload duplicates match normalized names or content within the same effective collection',()=>{
 const existing={id:'old',title:'  Café    Sunset ',collectionId:'my-photos',sha256:'stored',transferSha256:'received'};
 assert.equal(uploadedPhotoDuplicate([existing],{title:'CAFE\u0301 SUNSET',collectionId:'my-photos'})?.reason,'name');
 assert.equal(uploadedPhotoDuplicate([existing],{title:'Renamed',collectionId:'my-photos',transferSha256:'received'})?.reason,'content');
 assert.equal(uploadedPhotoDuplicate([existing],{title:'Renamed',collectionId:'my-photos',sha256:'stored'})?.reason,'content');
 assert.equal(uploadedPhotoDuplicate([existing],{title:'Café Sunset',collectionId:'light-water'}),null);
 const moved={old:{collectionId:'shape-colour',collectionName:'Shape'}};
 assert.equal(uploadedPhotoDuplicate([existing],{title:'Café Sunset',collectionId:'my-photos'},moved),null);
 assert.equal(uploadedPhotoDuplicate([existing],{title:'Café Sunset',collectionId:'shape-colour'},moved)?.photo.id,'old');
 assert.equal(uploadedPhotoDuplicate([{...existing,demo:true}],{title:'Café Sunset',collectionId:'my-photos'}),null);
});

test('bulk moving updates only selected collection assignments and retains included-art assignments',()=>{
 const settings={photoCollectionsV1:{'demo-1':{collectionId:'shape-colour',collectionName:'Shape'},other:{collectionId:'my-photos',collectionName:'My photos'}},ignored:['old'],lastPhoto:'phone'},before=structuredClone(settings);
 const plan=savedPhotoChanges(photos,['phone','museum'],settings,{id:'mobile-new',name:'New collection'});
 assert.deepEqual(plan.remove,[]);assert.deepEqual(plan.deleteSettings,[]);
 assert.deepEqual(plan.settings.photoCollectionsV1,{...settings.photoCollectionsV1,phone:{collectionId:'mobile-new',collectionName:'New collection'},museum:{collectionId:'mobile-new',collectionName:'New collection'}});
 assert.deepEqual(settings,before);assert.equal(photos[0].blob.size,5);assert.deepEqual(Object.keys(plan.settings),['photoCollectionsV1']);
});
test('bulk removal prevents legacy companion reimport and removes only matching membership and last-photo keys',()=>{
 const settings={ignored:['already'],photoCollectionsV1:{phone:{collectionId:'my-photos',collectionName:'My photos'},other:{collectionId:'shape-colour',collectionName:'Shape'},'demo-1':{collectionId:'my-photos',collectionName:'My photos'}},lastPhoto:'phone'};
 const plan=savedPhotoChanges(photos,['phone','museum','pc'],settings);
 assert.deepEqual(plan.remove,['phone','museum','pc']);assert.deepEqual(plan.settings.ignored,['already','pc']);
 assert.deepEqual(plan.settings.photoCollectionsV1,{other:settings.photoCollectionsV1.other,'demo-1':settings.photoCollectionsV1['demo-1']});
 assert.deepEqual(plan.deleteSettings,['lastPhoto']);assert.ok(settings.photoCollectionsV1.phone);
});
test('removing mobile or museum images does not create unrelated settings or reset the last artwork',()=>{
 assert.deepEqual(savedPhotoChanges(photos,['phone','museum'],{lastPhoto:'other'}),{remove:['phone','museum'],settings:{},deleteSettings:[]});
});
test('a stale, duplicate, empty or bundled selection is rejected before any mutation plan is produced',()=>{
 for(const ids of [[],['phone','phone'],['phone','missing'],[null],null,Array.from({length:201},(_,i)=>String(i))])assert.throws(()=>savedPhotoChanges(photos,ids),/Select|no longer/);
 assert.throws(()=>savedPhotoChanges([...photos,{id:'demo',demo:true}],['phone','demo']),/no longer/);
 assert.throws(()=>savedPhotoChanges(photos,['phone'],{}, {id:'bad/path',name:'Invalid'}),/Choose a collection/);
});
test('selecting all 200 stored images produces an exact bounded plan without touching native or bundled IDs',()=>{
 const images=Array.from({length:200},(_,i)=>({id:'upload-'+i,origin:'mobile'})),ids=images.map(p=>p.id);
 const plan=savedPhotoChanges(images,ids);assert.deepEqual(plan.remove,ids);assert.deepEqual(plan.settings,{});assert.equal(images.length,200);
});
