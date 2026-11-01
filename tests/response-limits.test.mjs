import test from 'node:test';
import assert from 'node:assert/strict';
import {readLimitedResponse} from '../app/response-limits.mjs';

test('legacy response limits reject headers before reading and stop oversized chunked bodies',async()=>{
 let reads=0,cancelled=false;
 const response=()=>new Response(new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}}));
 await assert.rejects(readLimitedResponse(response(),10),/permitted size/);assert.ok(reads<=3);assert.equal(cancelled,true);
 reads=0;cancelled=false;const declared=response();declared.headers.set('Content-Length','1000000');await assert.rejects(readLimitedResponse(declared,10),/permitted size/);assert.ok(reads<=1);assert.equal(cancelled,true);
});
test('exact downloads accept valid streamed bytes and reject short, mismatched and cancelled replies',async()=>{
 const bytes=new Uint8Array([1,2,3,4]);assert.deepEqual(await readLimitedResponse(new Response(bytes),4,undefined,4),bytes);
 await assert.rejects(readLimitedResponse(new Response(bytes.subarray(0,3)),4,undefined,4),/incomplete/);
 await assert.rejects(readLimitedResponse(new Response(bytes,{headers:{'Content-Length':'3'}}),4,undefined,4),/permitted size/);
 const abort=new AbortController();let cancelled=false;const response=new Response(new ReadableStream({start(){},cancel(){cancelled=true;}}));const reading=readLimitedResponse(response,4,abort.signal);abort.abort();await assert.rejects(reading,{name:'AbortError'});assert.equal(cancelled,true);
});
