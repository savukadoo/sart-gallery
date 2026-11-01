import test from 'node:test';import assert from 'node:assert/strict';
import {FindArtSelection,FindArtBatch,FIND_ART_BATCH_LIMIT,normaliseHiddenArtwork} from '../app/find-art-batch.mjs';
import {DEMO_PHOTOS} from '../app/assets/catalog.mjs';
const item=id=>({id:String(id),title:'Image '+id,publicDomain:true});
test('selection keeps bounded unique metadata across pages without image downloads',()=>{
 const s=new FindArtSelection();for(let i=0;i<50;i++)s.add(item(i));assert.equal(s.size,FIND_ART_BATCH_LIMIT);assert.equal(s.add(item(1)),true);assert.equal(s.size,50);assert.throws(()=>s.add(item(50)),/50 images/);assert.equal(s.add({id:'bad',publicDomain:false}),false);
 s.toggle(item(0));assert.equal(s.has('0'),false);s.add(item(100));s.remove(['1','100']);assert.equal(s.size,48);s.clear();assert.equal(s.size,0);
});
test('batch downloads are sequential, skip existing records and report partial failures',async()=>{
 const b=new FindArtBatch();let pending=0,peak=0;const seen=[];
 const r=await b.run([1,2,3,4].map(item),async record=>{pending++;peak=Math.max(peak,pending);seen.push(record.id);await new Promise(r=>setTimeout(r,1));pending--;if(record.id==='2')throw Error('Source offline');return record.id==='3'?'skipped':'saved';});
 assert.equal(peak,1);assert.deepEqual(seen,['1','2','3','4']);assert.deepEqual(r.saved,['1','4']);assert.deepEqual(r.skipped,['3']);assert.equal(r.failed.length,1);assert.deepEqual(r.remaining.map(x=>x.id),['2']);assert.equal(b.running,false);
});
test('Stop aborts an in-flight image and leaves unattempted images for retry',async()=>{
 const b=new FindArtBatch();let calls=0;const r=await b.run([1,2,3].map(item),async(_record,active)=>{calls++;if(calls===2){b.cancel();assert.equal(active(),false);throw new DOMException('Cancelled','AbortError')}return 'saved'});
 assert.equal(calls,2);assert.deepEqual(r.saved,['1']);assert.equal(r.cancelled,true);assert.deepEqual(r.remaining.map(x=>x.id),['2','3']);assert.equal(r.failed.length,0);
});
test('a commit finishing after Stop is still counted as durably saved',async()=>{
 const b=new FindArtBatch();let calls=0;const r=await b.run([1,2].map(item),async()=>{calls++;b.cancel();return 'saved'});assert.equal(calls,1);assert.deepEqual(r.saved,['1']);assert.equal(r.cancelled,true);assert.deepEqual(r.remaining.map(x=>x.id),['2']);
});
test('storage-full failures stop before downloading the rest of a batch',async()=>{
 const b=new FindArtBatch();let calls=0;const r=await b.run([1,2,3].map(item),async()=>{calls++;throw Error('Your gallery is full. Remove some photos before adding more.')});assert.equal(calls,1);assert.match(r.stoppedReason,/full/);assert.equal(r.remaining.length,3);
});
test('retry downloads only records that were not saved successfully',async()=>{
 const b=new FindArtBatch(),s=new FindArtSelection();[1,2,3].forEach(i=>s.add(item(i)));let first=true;let r=await b.run(s.values(),async record=>{if(record.id==='2'&&first)throw Error('Network failed');return 'saved'});s.remove([...r.saved,...r.skipped]);first=false;const retried=[];r=await b.run(s.values(),async record=>{retried.push(record.id);return 'saved'});assert.deepEqual(retried,['2']);assert.deepEqual(r.saved,['2']);assert.equal(r.remaining.length,0);
});
test('concurrent runs, duplicate IDs and excessive/empty batches are rejected',async()=>{
 const b=new FindArtBatch();let release;const pending=b.run([item(1)],()=>new Promise(r=>release=r));await assert.rejects(b.run([item(2)],async()=> 'saved'),/already/);release('saved');await pending;await assert.rejects(b.run([],async()=> 'saved'),/1 and 50/);await assert.rejects(b.run([item(1),item(1)],async()=> 'saved'),/different/);
});
test('progress UI failure never discards durable-save acknowledgements',async()=>{
 const r=await new FindArtBatch().run([item(1),item(2)],async()=> 'saved',()=>{throw Error('UI unmounted')});assert.deepEqual(r.saved,['1','2']);assert.equal(r.remaining.length,0);
});
test('only included art IDs can be hidden, and all included art can be restored without losing metadata',()=>{
 const ids=DEMO_PHOTOS.map(x=>x.id);assert.equal(ids.length,60);assert.deepEqual(normaliseHiddenArtwork([ids[0],ids[0],'mobile-private','museum-nga-123',null],DEMO_PHOTOS),[ids[0]]);
 const hidden=normaliseHiddenArtwork(ids,DEMO_PHOTOS);assert.equal(DEMO_PHOTOS.filter(x=>!hidden.includes(x.id)).length,0);assert.equal(DEMO_PHOTOS.filter(x=>!normaliseHiddenArtwork([],DEMO_PHOTOS).includes(x.id)).length,60);assert.deepEqual(normaliseHiddenArtwork({},DEMO_PHOTOS),[]);
});
