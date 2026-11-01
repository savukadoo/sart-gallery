// Bound untrusted legacy companion responses before allocating a complete body.
export const LIBRARY_JSON_LIMIT=512*1024;
export async function readLimitedResponse(response,limit,signal,exactBytes){
 if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Invalid download limit.');
 const declared=response.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))||Number(declared)>limit||(exactBytes!==undefined&&Number(declared)!==exactBytes))){
  await response.body?.cancel().catch(()=>{});throw new Error('The PC response exceeds its permitted size.');
 }
 if(!response.body?.getReader)throw new Error('This TV cannot safely read the PC response.');
 const reader=response.body.getReader(),chunks=[];let length=0;
 const abort=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
 try{
  while(true){
   if(signal?.aborted)throw new DOMException('The download was cancelled.','AbortError');
   const {done,value}=await reader.read();if(signal?.aborted)throw new DOMException('The download was cancelled.','AbortError');if(done)break;
   length+=value.byteLength;if(length>limit)throw new Error('The PC response exceeds its permitted size.');chunks.push(value);
  }
  if(exactBytes!==undefined&&length!==exactBytes)throw new Error('A photo download was incomplete. Try syncing again.');
  const bytes=new Uint8Array(length);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.byteLength;}return bytes;
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 finally{signal?.removeEventListener('abort',abort);reader.releaseLock();}
}
